/**
 * GADGET 1: data-flow reasoning over a template, as a derived category.
 *
 * The template is an ordinary CFN category C wired in the reference direction:
 *
 *     ESM ──onQueue──→ Queue         (event source mapping references its queue)
 *     ESM ──onFn─────→ Function      (…and its function)
 *     Function ──writes──→ Bucket    (function references the bucket it writes)
 *
 * References run referencer → referenced, but *data* flows the other way across
 * the ESM: a message leaves the Queue, the ESM delivers it to the Function, the
 * Function writes to the Bucket. We recover the flow direction by REVERSING the
 * `onQueue` leg (a span apex) and composing:
 *
 *     Queue  ←onQueue─ ESM ─onFn→ Function ─writes→ Bucket
 *     └────────── deliver ──────────┘ └──── emit ────┘
 *
 * `deliver = onQueue⁻¹ ; onFn` and `emit = writes`. The question "can a message
 * in the queue reach the bucket?" is then just `reaches(Queue, Bucket)` in the
 * derived Flow category — nothing but the engine's existing `allPaths`.
 *
 * This test proves the substrate on that one example, and pins the two
 * distinctions that make it categorical rather than "just a graph":
 *   - reversing a MONIC leg yields a FUNCTIONAL flow edge (label-safe);
 *     reversing a non-monic leg is sound for reachability but only RELATIONAL.
 *   - flow-equality (two zigzags denoting the same flow) via `pathsEqual`.
 */

import { Category, CategorySpec } from '../src/category';
import {
  deriveFlow,
  reaches,
  flowPaths,
  isFunctional,
  FlowSpec,
} from '../src/flow';

// The CFN reference category. Every arrow points referencer → referenced.
const C_SPEC: CategorySpec = {
  objects: ['ESM', 'Queue', 'Function', 'Bucket'],
  morphisms: [
    { name: 'onQueue', source: 'ESM', target: 'Queue' },
    { name: 'onFn', source: 'ESM', target: 'Function' },
    { name: 'writes', source: 'Function', target: 'Bucket' },
  ],
};

// Flow derivation: reverse the queue leg of the ESM apex, keep the rest forward.
// `onQueue` is monic — an ESM maps to exactly one queue and (in this template)
// no two ESMs share a queue — so `deliver` is a genuine function Queue→Function.
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
    {
      name: 'emit',
      zigzag: [{ morphism: 'writes', direction: 'forward' }],
    },
  ],
};

function buildFlow() {
  return deriveFlow(new Category(C_SPEC), FLOW_SPEC);
}

describe('gadget 1: data flow as a derived category', () => {
  test('the Flow category has flow-direction arrows over C', () => {
    const flow = buildFlow();
    expect(flow.category.objects.has('Queue')).toBe(true);
    // deliver: Queue → Function (queue leg reversed), emit: Function → Bucket.
    expect(flow.edgeInfo.get('deliver')).toMatchObject({
      from: 'Queue',
      to: 'Function',
    });
    expect(flow.edgeInfo.get('emit')).toMatchObject({
      from: 'Function',
      to: 'Bucket',
    });
  });

  test('reachability: a message in the queue reaches the bucket', () => {
    const flow = buildFlow();
    expect(reaches(flow, 'Queue', 'Bucket')).toBe(true);
    // …and the witnessing flow path is deliver ; emit.
    const paths = flowPaths(flow, 'Queue', 'Bucket');
    expect(paths).toEqual([['deliver', 'emit']]);
  });

  test('reachability respects direction: the bucket does not reach the queue', () => {
    const flow = buildFlow();
    expect(reaches(flow, 'Bucket', 'Queue')).toBe(false);
    // Reflexivity still holds.
    expect(reaches(flow, 'Bucket', 'Bucket')).toBe(true);
  });

  test('reversing a MONIC leg yields a functional (label-safe) flow', () => {
    const flow = buildFlow();
    const [qToBucket] = flowPaths(flow, 'Queue', 'Bucket');
    expect(isFunctional(flow, qToBucket)).toBe(true);
  });

  test('reversing a NON-monic leg is sound for reachability but only relational', () => {
    // Same template, but we do NOT declare onQueue monic — i.e. queues may be
    // shared across ESMs, so onQueue⁻¹ is one-to-many.
    const flow = deriveFlow(new Category(C_SPEC), {
      ...FLOW_SPEC,
      monic: [],
    });
    // Reachability is unaffected: the endpoints are still connected.
    expect(reaches(flow, 'Queue', 'Bucket')).toBe(true);
    // But the deliver hop is now a relation, so the path is not label-safe.
    const [qToBucket] = flowPaths(flow, 'Queue', 'Bucket');
    expect(isFunctional(flow, qToBucket)).toBe(false);
  });

  test('flow-equality: two zigzags to the same sink are recognised as one flow', () => {
    // Add a redundant direct wire Queue→Bucket ("archive") and declare it equal
    // to the deliver;emit route. `pathsEqual` (mod the flow equation) collapses
    // them — same flow, two syntactic presentations.
    const C = new Category({
      objects: ['ESM', 'Queue', 'Function', 'Bucket'],
      morphisms: [
        { name: 'onQueue', source: 'ESM', target: 'Queue' },
        { name: 'onFn', source: 'ESM', target: 'Function' },
        { name: 'writes', source: 'Function', target: 'Bucket' },
        { name: 'archive', source: 'Queue', target: 'Bucket' },
      ],
    });
    const flow = deriveFlow(C, {
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
        { name: 'archive', zigzag: [{ morphism: 'archive', direction: 'forward' }] },
      ],
      equations: [{ lhs: ['deliver', 'emit'], rhs: ['archive'] }],
    });

    expect(flow.category.pathsEqual(['deliver', 'emit'], ['archive'])).toBe(true);
    // Consequently they are one equivalence class: allPaths returns a single rep.
    expect(flowPaths(flow, 'Queue', 'Bucket').length).toBe(1);
  });

  test('non-composable zigzags are rejected at derivation time', () => {
    const C = new Category(C_SPEC);
    expect(() =>
      deriveFlow(C, {
        edges: [
          {
            // writes: Function→Bucket forward exits at Bucket; onFn forward
            // enters at ESM — not composable.
            name: 'bad',
            zigzag: [
              { morphism: 'writes', direction: 'forward' },
              { morphism: 'onFn', direction: 'forward' },
            ],
          },
        ],
      }),
    ).toThrow(/not composable/);
  });
});