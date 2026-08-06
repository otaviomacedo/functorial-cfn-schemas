/**
 * GADGET 3: propagate a PARTIAL labeling to the least consistent classification.
 *
 * Author states a few facts; the engine derives the rest as the least labeling
 * consistent with all flows — the left Kan extension of the partial labeling
 * into Flow, valued in E, computed by JOINS. This is the inversion of RFC 0972:
 * the RFC has authors hand-write per-resource metadata and trusts consumers to
 * infer relationships; here we derive the labeling from the wiring and CERTIFY
 * it with gadget 2's functor.
 *
 * Template: SQS→ESM→Lambda→S3, element level.
 *   Queue orders ──deliver──▶ Function processor ──emit──▶ Bucket invoices
 *
 * Seed only the source: orders originates `secret`. Everything downstream must
 * be forced up to `secret`.
 */

import { Category, CategorySpec } from '../src/category';
import { Instance } from '../src/instance';
import { deriveElementFlow, FlowSpec } from '../src/flow';
import { Lattice, propagateClassification } from '../src/flow-classify';

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

// public ≤ internal ≤ secret
const E = new Lattice({
  levels: ['public', 'internal', 'secret'],
  covers: [
    { lo: 'public', hi: 'internal' },
    { lo: 'internal', hi: 'secret' },
  ],
});

function linearFlow() {
  const C = new Category(C_SPEC);
  const I = new Instance(
    C,
    {
      Queue: ['orders'],
      ESM: ['esm1'],
      Function: ['processor'],
      Bucket: ['invoices'],
    },
    { onQueue: () => 'orders', onFn: () => 'processor', writes: () => 'invoices' },
  );
  return deriveElementFlow(C, I, FLOW_SPEC);
}

describe('lattice join / bottom (gadget 3 primitives)', () => {
  test('bottom is the least element; join is the least upper bound', () => {
    expect(E.bottom()).toBe('public');
    expect(E.join([])).toBe('public'); // empty join = bottom
    expect(E.join(['public', 'secret'])).toBe('secret');
    expect(E.join(['internal', 'internal'])).toBe('internal');
    expect(E.join(['public', 'internal'])).toBe('internal');
  });

  test('a non-join-semilattice (incomparable maxima) is reported, not silently dropped', () => {
    // Diamond WITHOUT a top: a,b below nothing common. public ≤ a, public ≤ b.
    const D = new Lattice({
      levels: ['public', 'a', 'b'],
      covers: [
        { lo: 'public', hi: 'a' },
        { lo: 'public', hi: 'b' },
      ],
    });
    expect(() => D.join(['a', 'b'])).toThrow(/not a join-semilattice/);
  });
});

describe('gadget 3: propagate a partial labeling', () => {
  test('seed only the source; the least labeling forces everything downstream up', () => {
    const flow = linearFlow();
    const report = propagateClassification(flow.flow, E, {
      atLeast: { 'Queue#orders': 'secret' },
    });

    expect(report.ok).toBe(true);
    expect(report.labeling).toEqual({
      'Queue#orders': 'secret',
      'Function#processor': 'secret', // derived
      'Bucket#invoices': 'secret', // derived
    });
    // Certified by the same functor machinery as gadget 2.
    expect(report.functor).not.toBeNull();
    expect(report.functor!.mapObject('Bucket#invoices')).toBe('secret');
  });

  test('unseeded objects rest at bottom; a downstream seed does not flow upstream', () => {
    const flow = linearFlow();
    // Seed the SINK instead: only the bucket is internal. Nothing flows into the
    // upstream nodes, so they stay at ⊥ = public (propagation is directional).
    const report = propagateClassification(flow.flow, E, {
      atLeast: { 'Bucket#invoices': 'internal' },
    });
    expect(report.ok).toBe(true);
    expect(report.labeling).toEqual({
      'Queue#orders': 'public',
      'Function#processor': 'public',
      'Bucket#invoices': 'internal',
    });
  });

  test('atMost clearance turns an unavoidable downstream taint into a reported leak', () => {
    const flow = linearFlow();
    // orders is secret, but the bucket is pinned to hold at most public. No
    // labeling can satisfy both — the derived secret exceeds the clearance.
    const report = propagateClassification(flow.flow, E, {
      atLeast: { 'Queue#orders': 'secret' },
      atMost: { 'Bucket#invoices': 'public' },
    });

    expect(report.ok).toBe(false);
    expect(report.functor).toBeNull();
    expect(report.violations).toEqual([
      { object: 'Bucket#invoices', derived: 'secret', atMost: 'public' },
    ]);
  });

  test('relational fan-out forces a JOIN: a shared queue taints both pipelines', () => {
    // orders is consumed by two ESMs → two functions → two buckets. Seeding the
    // shared queue secret must propagate down BOTH relational deliver edges.
    const C = new Category(C_SPEC);
    const I = new Instance(
      C,
      {
        Queue: ['orders'],
        ESM: ['esm1', 'esm2'],
        Function: ['processor', 'analytics'],
        Bucket: ['invoices', 'reports'],
      },
      {
        onQueue: () => 'orders',
        onFn: (e: string) => ({ esm1: 'processor', esm2: 'analytics' }[e]!),
        writes: (f: string) =>
          ({ processor: 'invoices', analytics: 'reports' }[f]!),
      },
    );
    const flow = deriveElementFlow(C, I, FLOW_SPEC);
    // Confirm this is the relational case (onQueue collides on `orders`).
    expect(flow.monicViolations.length).toBeGreaterThan(0);

    const report = propagateClassification(flow.flow, E, {
      atLeast: { 'Queue#orders': 'secret' },
    });
    expect(report.ok).toBe(true);
    // Both downstream pipelines are tainted secret by the shared source.
    expect(report.labeling['Bucket#invoices']).toBe('secret');
    expect(report.labeling['Bucket#reports']).toBe('secret');
  });

  test('a confluence takes the JOIN of its two upstreams', () => {
    // Two queues feed ONE function (two ESMs onto the same function), which
    // writes one bucket. Seed one queue internal, the other secret: the function
    // and bucket must be their join = secret.
    const C = new Category(C_SPEC);
    const I = new Instance(
      C,
      {
        Queue: ['q-internal', 'q-secret'],
        ESM: ['esm1', 'esm2'],
        Function: ['merger'],
        Bucket: ['sink'],
      },
      {
        onQueue: (e: string) => ({ esm1: 'q-internal', esm2: 'q-secret' }[e]!),
        onFn: () => 'merger',
        writes: () => 'sink',
      },
    );
    const flow = deriveElementFlow(C, I, FLOW_SPEC);
    const report = propagateClassification(flow.flow, E, {
      atLeast: { 'Queue#q-internal': 'internal', 'Queue#q-secret': 'secret' },
    });
    expect(report.ok).toBe(true);
    expect(report.labeling['Function#merger']).toBe('secret'); // internal ⊔ secret
    expect(report.labeling['Bucket#sink']).toBe('secret');
  });
});
