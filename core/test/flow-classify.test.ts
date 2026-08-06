/**
 * GADGET 2: security classification as a functor P: Flow → E.
 *
 * E is a sensitivity lattice as a thin poset: public ≤ internal ≤ secret.
 * A labeling of flow objects extends to a FUNCTOR iff every flow edge A→B is
 * monotone (P(A) ≤ P(B)) — data only moves somewhere at least as sensitive.
 *
 * We run this over the ELEMENT-level flow of the SQS→ESM→Lambda→S3 template so
 * the violations name concrete resources. Two scenarios:
 *
 *   clean : orders(internal) → processor(internal) → invoices(internal)      ✓ functor exists
 *   leak  : orders(secret)   → processor(secret)   → invoices(public)        ✗ secret→public wire
 *
 * The failure is exactly "P is not a functor": the flow edge into `invoices`
 * has no arrow in E to receive it (secret ⋠ public).
 */

import { Category, CategorySpec } from '../src/category';
import { Instance } from '../src/instance';
import { deriveElementFlow, FlowSpec } from '../src/flow';
import { Lattice, checkClassification } from '../src/flow-classify';

const C_SPEC: CategorySpec = {
  objects: ['ESM', 'Queue', 'Function', 'Bucket'],
  morphisms: [
    { name: 'onQueue', source: 'ESM', target: 'Queue' },
    { name: 'onFn', source: 'ESM', target: 'Function' },
    { name: 'writes', source: 'Function', target: 'Bucket' },
  ],
};

const FLOW_SPEC: FlowSpec = {
  monic: ['onQueue'],
  edges: [
    {
      name: 'deliver',
      zigzag: [
        { morphism: 'onQueue', direction: 'backward' },
        { morphism: 'onFn', direction: 'forward' },
      ],
    },
    { name: 'emit', zigzag: [{ morphism: 'writes', direction: 'forward' }] },
  ],
};

function elementFlow() {
  const C = new Category(C_SPEC);
  const I = new Instance(
    C,
    {
      Queue: ['orders'],
      ESM: ['esm1'],
      Function: ['processor'],
      Bucket: ['invoices'],
    },
    {
      onQueue: () => 'orders',
      onFn: () => 'processor',
      writes: () => 'invoices',
    },
  );
  return deriveElementFlow(C, I, FLOW_SPEC);
}

// public ≤ internal ≤ secret
const E = new Lattice({
  levels: ['public', 'internal', 'secret'],
  covers: [
    { lo: 'public', hi: 'internal' },
    { lo: 'internal', hi: 'secret' },
  ],
});

describe('gadget 2: classification is a functor Flow → E', () => {
  test('the lattice order is reflexive + transitive over covers', () => {
    expect(E.leq('public', 'secret')).toBe(true); // transitive
    expect(E.leq('internal', 'internal')).toBe(true); // reflexive
    expect(E.leq('secret', 'public')).toBe(false); // strict direction
  });

  test('a non-partial-order lattice (a cycle) is rejected at construction', () => {
    expect(
      () =>
        new Lattice({
          levels: ['a', 'b'],
          covers: [
            { lo: 'a', hi: 'b' },
            { lo: 'b', hi: 'a' },
          ],
        }),
    ).toThrow(/not a partial order/);
  });

  test('clean labeling extends to a functor — and the functor is materialized', () => {
    const flow = elementFlow();
    const report = checkClassification(flow.flow, E, {
      'Queue#orders': 'internal',
      'Function#processor': 'internal',
      'Bucket#invoices': 'internal',
    });

    expect(report.ok).toBe(true);
    expect(report.violations).toEqual([]);
    // The witness: an actual Functor object, Flow → E. Its construction (in
    // functor.ts) re-validates that every edge lands on a real arrow of E.
    expect(report.functor).not.toBeNull();
    expect(report.functor!.source).toBe(flow.flow.category);
    expect(report.functor!.target).toBe(E.category);
    expect(report.functor!.mapObject('Queue#orders')).toBe('internal');
  });

  test('a secret→public wire fails functoriality and localizes the leak', () => {
    const flow = elementFlow();
    const report = checkClassification(flow.flow, E, {
      'Queue#orders': 'secret',
      'Function#processor': 'secret',
      'Bucket#invoices': 'public', // the leak: secret data written to a public bucket
    });

    expect(report.ok).toBe(false);
    expect(report.functor).toBeNull();

    // Exactly one bad wire: the `emit` edge processor(secret) → invoices(public).
    expect(report.violations).toHaveLength(1);
    const v = report.violations[0];
    expect(v.from).toBe('Function#processor');
    expect(v.to).toBe('Bucket#invoices');
    expect(v.fromLevel).toBe('secret');
    expect(v.toLevel).toBe('public');
  });

  test('"X can read Y": model the read as flow Y→X; a public reader of secret data is a violation', () => {
    // A read edge Store→Reader means the store's data reaches the reader.
    const C = new Category({
      objects: ['Store', 'Reader'],
      morphisms: [{ name: 'readsFrom', source: 'Reader', target: 'Store' }],
    });
    const I = new Instance(
      C,
      { Store: ['secrets-db'], Reader: ['public-api'] },
      { readsFrom: () => 'secrets-db' },
    );
    // Flow follows the data: Store → Reader (reverse the reference `readsFrom`).
    const flow = deriveElementFlow(C, I, {
      monic: ['readsFrom'],
      edges: [
        {
          name: 'read',
          zigzag: [{ morphism: 'readsFrom', direction: 'backward' }],
        },
      ],
    });

    const report = checkClassification(flow.flow, E, {
      'Store#secrets-db': 'secret',
      'Reader#public-api': 'public',
    });
    expect(report.ok).toBe(false);
    expect(report.violations[0]).toMatchObject({
      from: 'Store#secrets-db',
      to: 'Reader#public-api',
      fromLevel: 'secret',
      toLevel: 'public',
    });
  });

  test('relational (fan-out) edges are still checked for monotonicity', () => {
    // Shared queue: `orders` consumed by two ESMs → the deliver edges are
    // relational (non-functional). A leak through one must still be caught.
    const C = new Category(C_SPEC);
    const I = new Instance(
      C,
      {
        Queue: ['orders'],
        ESM: ['esm1', 'esm2'],
        Function: ['processor', 'leaky'],
        Bucket: ['invoices', 'public-logs'],
      },
      {
        onQueue: () => 'orders',
        onFn: (e: string) => ({ esm1: 'processor', esm2: 'leaky' }[e]!),
        writes: (f: string) =>
          ({ processor: 'invoices', leaky: 'public-logs' }[f]!),
      },
    );
    const flow = deriveElementFlow(C, I, FLOW_SPEC);
    // orders is shared → onQueue collides → deliver edges are relational.
    expect(flow.monicViolations.length).toBeGreaterThan(0);

    const report = checkClassification(flow.flow, E, {
      'Queue#orders': 'secret',
      'Function#processor': 'secret',
      'Function#leaky': 'secret',
      'Bucket#invoices': 'secret',
      'Bucket#public-logs': 'public', // leak via the second, relational pipeline
    });
    expect(report.ok).toBe(false);
    const leak = report.violations.find(v => v.to === 'Bucket#public-logs');
    expect(leak).toBeDefined();
    // The violating edge originated from a fan-out (non-functional) delivery,
    // but was checked anyway — provenance is recorded.
    expect(leak!.toLevel).toBe('public');
  });
});