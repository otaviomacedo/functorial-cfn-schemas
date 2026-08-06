/**
 * THE RELATIONAL OBLIGATION (loose thread from the Flow→Rel discussion).
 *
 * `spec.equations` are baked into the Flow *category*, so `pathsEqual` decides
 * them syntactically. But the flow-view is a FUNCTOR Flow→Rel, and for that to
 * be a genuine functor, two paths declared equal must denote the SAME RELATION
 * on the instance. `deriveFlow` cannot see this — the category believes any
 * equation you write. `checkFlowEquations` is the "…but is it TRUE on I?" check.
 *
 * Scenario: a queue delivers to a function that writes a bucket
 * (deliver;emit), and there is ALSO a direct wire `archive: Queue→Bucket`. The
 * author asserts `deliver;emit = archive`. Whether that holds depends on where
 * `archive` actually points in the instance.
 */

import { Category, CategorySpec } from '../src/category';
import { Instance } from '../src/instance';
import { deriveFlow, checkFlowEquations, FlowSpec } from '../src/flow';

const C_SPEC: CategorySpec = {
  objects: ['ESM', 'Queue', 'Function', 'Bucket'],
  morphisms: [
    { name: 'onQueue', source: 'ESM', target: 'Queue' },
    { name: 'onFn', source: 'ESM', target: 'Function' },
    { name: 'writes', source: 'Function', target: 'Bucket' },
    { name: 'archive', source: 'Queue', target: 'Bucket' },
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
    { name: 'archive', zigzag: [{ morphism: 'archive', direction: 'forward' }] },
  ],
  equations: [{ lhs: ['deliver', 'emit'], rhs: ['archive'] }],
};

function buildFlow() {
  return deriveFlow(new Category(C_SPEC), FLOW_SPEC);
}

/**
 * Instance where the equation HOLDS: the direct archive wire points to the same
 * bucket the deliver;emit pipeline reaches.
 *   orders → esm1 → processor → invoices ; archive(orders) = invoices  ✓
 */
function coherentInstance(): Instance {
  return new Instance(
    new Category(C_SPEC),
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
      archive: () => 'invoices', // matches deliver;emit
    },
  );
}

/**
 * Instance where the equation is VIOLATED in Rel: same pipeline, but the archive
 * wire points to a DIFFERENT bucket. The category still "believes" the equation;
 * only the relational check catches the divergence.
 */
function divergentInstance(): Instance {
  return new Instance(
    new Category(C_SPEC),
    {
      Queue: ['orders'],
      ESM: ['esm1'],
      Function: ['processor'],
      Bucket: ['invoices', 'cold-storage'],
    },
    {
      onQueue: () => 'orders',
      onFn: () => 'processor',
      writes: () => 'invoices',
      archive: () => 'cold-storage', // deliver;emit reaches invoices, not this
    },
  );
}

describe('the relational obligation: flow equations must hold in Rel', () => {
  test('the category believes the equation regardless of the instance', () => {
    const flow = buildFlow();
    // Syntactic truth in the Flow category — always, even for divergentInstance.
    expect(flow.category.pathsEqual(['deliver', 'emit'], ['archive'])).toBe(true);
  });

  test('coherent instance: the equation holds as an equality of relations', () => {
    const flow = buildFlow();
    const violations = checkFlowEquations(
      new Category(C_SPEC),
      coherentInstance(),
      flow,
      FLOW_SPEC.equations!,
    );
    expect(violations).toEqual([]);
  });

  test('divergent instance: the same equation FAILS in Rel and is localized', () => {
    const flow = buildFlow();
    const violations = checkFlowEquations(
      new Category(C_SPEC),
      divergentInstance(),
      flow,
      FLOW_SPEC.equations!,
    );

    expect(violations).toHaveLength(1);
    const v = violations[0];
    expect(v.lhs).toEqual(['deliver', 'emit']);
    expect(v.rhs).toEqual(['archive']);
    // deliver;emit relates orders→invoices; archive relates orders→cold-storage.
    expect(v.onlyLhs).toEqual([['orders', 'invoices']]);
    expect(v.onlyRhs).toEqual([['orders', 'cold-storage']]);
  });

  test('no declared equations ⇒ nothing to check', () => {
    const flow = deriveFlow(new Category(C_SPEC), { ...FLOW_SPEC, equations: [] });
    expect(
      checkFlowEquations(new Category(C_SPEC), coherentInstance(), flow, []),
    ).toEqual([]);
  });
});
