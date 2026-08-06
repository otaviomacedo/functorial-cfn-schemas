/**
 * GADGET 1, element level: concrete data-flow reachability over a real instance.
 *
 * The type-level Flow (see flow.test.ts) answers "can SOME queue reach SOME
 * bucket in this schema". Here we answer the question the user actually asks:
 *
 *     "data flows from the queue `orders` to the bucket `invoices`,
 *      but NOT to the bucket `financial-reports`."
 *
 * This is NOT a right Kan extension: the flow edge reverses `onQueue`, which on
 * concrete elements is a partial, one-to-many map, and Set-valued Kan can only
 * migrate honest functions. Instead we run the SAME `deriveFlow` construction
 * over the category of elements ∫I — reversal becomes preimage enumeration, and
 * reachability is again just `allPaths`.
 *
 * The instance:
 *   Queues:    orders, telemetry
 *   ESMs:      esm1 (orders→processor), esm2 (telemetry→analytics)
 *   Functions: processor (writes invoices), analytics (writes financial-reports)
 *   Buckets:   invoices, financial-reports
 *
 * So `orders → esm1 → processor → invoices`, and telemetry runs a parallel,
 * disjoint pipeline into financial-reports. The two must not cross.
 */

import { Category, CategorySpec } from '../src/category';
import { Instance } from '../src/instance';
import {
  deriveElementFlow,
  elementReaches,
  reachableFrom,
  isFunctional,
  flowPaths,
  FlowSpec,
} from '../src/flow';

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

function buildInstance(): Instance {
  return new Instance(
    new Category(C_SPEC),
    {
      Queue: ['orders', 'telemetry'],
      ESM: ['esm1', 'esm2'],
      Function: ['processor', 'analytics'],
      Bucket: ['invoices', 'financial-reports'],
    },
    {
      onQueue: (e: string) => ({ esm1: 'orders', esm2: 'telemetry' }[e]!),
      onFn: (e: string) => ({ esm1: 'processor', esm2: 'analytics' }[e]!),
      writes: (f: string) =>
        ({ processor: 'invoices', analytics: 'financial-reports' }[f]!),
    },
  );
}

function buildElementFlow() {
  return deriveElementFlow(new Category(C_SPEC), buildInstance(), FLOW_SPEC);
}

describe('gadget 1 (element level): concrete data-flow reachability', () => {
  test('the headline query: orders → invoices, but NOT financial-reports', () => {
    const ef = buildElementFlow();
    expect(elementReaches(ef, 'Queue', 'orders', 'Bucket', 'invoices')).toBe(true);
    expect(
      elementReaches(ef, 'Queue', 'orders', 'Bucket', 'financial-reports'),
    ).toBe(false);
  });

  test('the parallel pipeline is disjoint: telemetry → financial-reports only', () => {
    const ef = buildElementFlow();
    expect(
      elementReaches(ef, 'Queue', 'telemetry', 'Bucket', 'financial-reports'),
    ).toBe(true);
    expect(elementReaches(ef, 'Queue', 'telemetry', 'Bucket', 'invoices')).toBe(
      false,
    );
  });

  test('reachableFrom yields the full downstream view for one resource', () => {
    const ef = buildElementFlow();
    const buckets = reachableFrom(ef, 'Queue', 'orders', 'Bucket').map(
      n => n.element,
    );
    expect(buckets).toEqual(['invoices']);

    // Without a target filter, we see the whole pipeline (function + bucket).
    const all = reachableFrom(ef, 'Queue', 'orders')
      .map(n => n.id)
      .sort();
    expect(all).toEqual(['Bucket#invoices', 'Function#processor']);
  });

  test('reachability is directional: the bucket does not reach its queue', () => {
    const ef = buildElementFlow();
    expect(elementReaches(ef, 'Bucket', 'invoices', 'Queue', 'orders')).toBe(
      false,
    );
    // Reflexive on a present node.
    expect(elementReaches(ef, 'Queue', 'orders', 'Queue', 'orders')).toBe(true);
  });

  test('a SHARED queue fans out: reversal enumerates every consumer', () => {
    // esm1 and esm3 both consume `orders`; esm3 writes to financial-reports.
    // Now `orders` legitimately reaches BOTH buckets — the relational fan-out
    // the reversed leg makes explicit (and why a raw reversal is not a function).
    const C = new Category(C_SPEC);
    const ef = deriveElementFlow(C, sharedQueueInstance(C), FLOW_SPEC);

    const buckets = reachableFrom(ef, 'Queue', 'orders', 'Bucket')
      .map(n => n.element)
      .sort();
    expect(buckets).toEqual(['financial-reports', 'invoices']);
  });

  test('instance-level monic check: a declared-monic leg that collides is flagged and downgraded', () => {
    // Same shared-queue instance. `onQueue` is DECLARED monic in FLOW_SPEC, but
    // `orders` has two preimages (esm1, esm3) — the declaration is false for
    // THIS instance. The type-level verdict would call `deliver;emit` functional;
    // the instance-level check must contradict it.
    const C = new Category(C_SPEC);
    const ef = deriveElementFlow(C, sharedQueueInstance(C), FLOW_SPEC);

    // The collision is reported, naming the offending leg and the shared target.
    expect(ef.monicViolations).toEqual([
      { morphism: 'onQueue', target: 'orders', preimages: ['esm1', 'esm3'] },
    ]);

    // Reachability is unaffected (fan-out is modelled, not dropped)…
    expect(elementReaches(ef, 'Queue', 'orders', 'Bucket', 'invoices')).toBe(true);
    // …but every realized flow out of `orders` is now NON-functional: label
    // propagation along it is unsafe because the reversed leg actually fans out.
    for (const path of flowPaths(ef.flow, 'Queue#orders', 'Bucket#invoices')) {
      expect(isFunctional(ef.flow, path)).toBe(false);
    }
  });

  test('a genuinely injective monic leg produces no violation and stays functional', () => {
    // The headline instance: onQueue is injective (each queue ↦ one ESM here),
    // so the declaration holds and the verdict stays functional.
    const ef = buildElementFlow();
    expect(ef.monicViolations).toEqual([]);
    for (const path of flowPaths(ef.flow, 'Queue#orders', 'Bucket#invoices')) {
      expect(isFunctional(ef.flow, path)).toBe(true);
    }
  });
});

/** Shared-queue instance: esm1 and esm3 both consume `orders`. */
function sharedQueueInstance(C: Category): Instance {
  return new Instance(
    C,
    {
      Queue: ['orders', 'telemetry'],
      ESM: ['esm1', 'esm2', 'esm3'],
      Function: ['processor', 'analytics'],
      Bucket: ['invoices', 'financial-reports'],
    },
    {
      onQueue: (e: string) =>
        ({ esm1: 'orders', esm2: 'telemetry', esm3: 'orders' }[e]!),
      onFn: (e: string) =>
        ({ esm1: 'processor', esm2: 'analytics', esm3: 'analytics' }[e]!),
      writes: (f: string) =>
        ({ processor: 'invoices', analytics: 'financial-reports' }[f]!),
    },
  );
}