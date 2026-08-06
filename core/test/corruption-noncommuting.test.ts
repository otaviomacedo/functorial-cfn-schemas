/**
 * APPLICATION 2: corruption / consistency as a NON-COMMUTING diagram.
 *
 * A store is written by two paths that are SUPPOSED to agree — e.g. a DynamoDB
 * item updated both by a direct writer and by a reconciler that goes through a
 * queue. "They agree" is the assertion that the two flow paths denote the SAME
 * relation into the item. That is exactly `checkFlowEquations`: the flow-view is
 * Rel-valued, and the two write paths commute iff they map to one relation on
 * the instance. When they don't, the same item is reachable by two routes that
 * disagree — last-writer-wins corruption, localized to the divergent pair.
 *
 * This is the relational obligation reframed as a consistency checker: the
 * category happily believes the author's `eq`, and only the instance-level
 * relational check catches that the two writers actually touch different items.
 *
 * Setup (C): ONE service updates the same item two ways — a genuine commuting
 * triangle. The consistency assertion is that the two routes agree.
 *
 *     Service ─direct─────────────────▶ Item
 *     Service ─enqueue─▶ Queue ─drain──▶ Item
 *
 * Both routes run Service → Item, so they are PARALLEL — the equation
 * `direct = enqueue * drain` is a well-formed commuting triangle. It commutes in
 * Rel iff, on the instance, both land on the same item.
 */

import { Category, CategorySpec } from '../src/category';
import { Instance } from '../src/instance';
import { deriveFlow, checkFlowEquations, FlowSpec } from '../src/flow';

// C: one service, one queue, one item. The service references the item both
// directly and through the queue.
const C_SPEC: CategorySpec = {
  objects: ['Service', 'Queue', 'Item'],
  morphisms: [
    { name: 'direct', source: 'Service', target: 'Item' },
    { name: 'enqueue', source: 'Service', target: 'Queue' },
    { name: 'drain', source: 'Queue', target: 'Item' },
  ],
};

// Two parallel flow edges Service → Item, one per write route.
const FLOW_SPEC: FlowSpec = {
  monic: ['direct', 'enqueue', 'drain'],
  edges: [
    { name: 'directUpdate', zigzag: [{ morphism: 'direct', direction: 'forward' }] },
    {
      name: 'viaQueue',
      zigzag: [
        { morphism: 'enqueue', direction: 'forward' },
        { morphism: 'drain', direction: 'forward' },
      ],
    },
  ],
  // The author asserts both write routes hit the same item — a commuting triangle.
  equations: [{ lhs: ['directUpdate'], rhs: ['viaQueue'] }],
};

function buildFlow() {
  return deriveFlow(new Category(C_SPEC), FLOW_SPEC);
}

/**
 * CONSISTENT: the direct writer and the queue both drain to the SAME item.
 *   directWrites(w) = item42 ; queueDrains(q) = item42
 */
function consistentInstance(): Instance {
  return new Instance(
    new Category(C_SPEC),
    {
      Service: ['svc'],
      Queue: ['q'],
      Item: ['item42'],
    },
    {
      direct: () => 'item42',
      enqueue: () => 'q',
      drain: () => 'item42',
    },
  );
}

/**
 * CORRUPTING: the two write paths land on DIFFERENT items. The category still
 * believes the equation; only the relational check catches the split-brain.
 *   directWrites(w) = item42 ; queueDrains(q) = item99
 */
function corruptingInstance(): Instance {
  return new Instance(
    new Category(C_SPEC),
    {
      Service: ['svc'],
      Queue: ['q'],
      Item: ['item42', 'item99'],
    },
    {
      direct: () => 'item42',
      enqueue: () => 'q',
      drain: () => 'item99', // the queue route lands on a different item
    },
  );
}

describe('application 2: corruption as a non-commuting write diagram', () => {
  test('the Flow category believes the two paths agree, instance regardless', () => {
    const flow = buildFlow();
    expect(flow.category.pathsEqual(['directUpdate'], ['viaQueue'])).toBe(true);
  });

  test('consistent instance: the two write paths commute (no corruption)', () => {
    const violations = checkFlowEquations(
      new Category(C_SPEC),
      consistentInstance(),
      buildFlow(),
      FLOW_SPEC.equations!,
    );
    expect(violations).toEqual([]);
  });

  test('corrupting instance: the paths DIVERGE and the split is localized', () => {
    const violations = checkFlowEquations(
      new Category(C_SPEC),
      corruptingInstance(),
      buildFlow(),
      FLOW_SPEC.equations!,
    );

    expect(violations).toHaveLength(1);
    const v = violations[0];
    // Pairs are (source, sink): the service's direct route reaches item42, its
    // queue route reaches item99 — the same actor, two disagreeing destinations.
    expect(v.onlyLhs).toEqual([['svc', 'item42']]);
    expect(v.onlyRhs).toEqual([['svc', 'item99']]);
  });
});
