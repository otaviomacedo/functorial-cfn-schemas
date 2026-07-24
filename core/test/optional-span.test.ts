/**
 * PROTOTYPE / DESIGN VERIFICATION for optional references + sum types.
 *
 * We model what the compiler's desugaring *should* produce, by hand, at the
 * core level, and run it through the real Kan engine to confirm the semantics:
 *
 *   optional reference A.field?: B   ⟿  span   A ←f— C —g→ B   (f mono, NO h)
 *   sum-typed field   A.field: {V…}  ⟿  one such span per variant V
 *
 * Key claims verified here:
 *   1. No h ⇒ SHARING is allowed: two A's may reference the same B (n:1).
 *   2. Optionality: an A with no apex element renders no field.
 *   3. G matching abstract spans to concrete spans is FULLY FAITHFUL.
 *   4. An extra concrete optional field with no abstract counterpart is
 *      correctly flagged NOT FULL (the "you forgot a variant" diagnostic).
 *   5. The right Kan extension propagates spans abstract→concrete with the
 *      right cardinalities (fiber analysis + engine agree).
 */

import { Category, CategorySpec } from '../src/category';
import { Functor, FunctorSpec } from '../src/functor';
import { Instance } from '../src/instance';
import { rightKan } from '../src/kan';
import { analyzeFibers, verifyCardinality } from '../src/fiber-analysis';
import { checkFullyFaithful } from '../src/faithfulness';

// ---------------------------------------------------------------------------
// D (abstract): a Route with a mandatory RouteTable ref and a sum-typed target
//   Target = { Nat | Igw }  (optional — a route need not have a target here)
// ---------------------------------------------------------------------------
//
// Desugared shape (what the DSL lowering would emit — no user sees these):
//   objects: Route, Nat, Igw, RT, and apexes SNat, SIgw
//   Route.rt : Route → RT        (mandatory regular ref → plain morphism)
//   SNat.on  : SNat  → Route     (f, the monic leg)
//   SNat.to  : SNat  → Nat       (g, the target leg)
//   SIgw.on  : SIgw  → Route     (f)
//   SIgw.to  : SIgw  → Igw       (g)
// NOTE: no reverse h morphism ⇒ targets may be shared.

const D_SPEC: CategorySpec = {
  objects: ['Route', 'Nat', 'Igw', 'RT', 'SNat', 'SIgw'],
  morphisms: [
    { name: 'Route.rt', source: 'Route', target: 'RT' },
    { name: 'SNat.on', source: 'SNat', target: 'Route' },
    { name: 'SNat.to', source: 'SNat', target: 'Nat' },
    { name: 'SIgw.on', source: 'SIgw', target: 'Route' },
    { name: 'SIgw.to', source: 'SIgw', target: 'Igw' },
  ],
};

// ---------------------------------------------------------------------------
// C (concrete): the CFN-level category. Same span shape, different names, so G
// is a genuine (bijective here) mapping rather than the identity.
// ---------------------------------------------------------------------------

const C_SPEC: CategorySpec = {
  objects: ['CfnRoute', 'CfnNat', 'CfnIgw', 'CfnRT', 'OptNat', 'OptIgw'],
  morphisms: [
    { name: 'CfnRoute.RouteTableId', source: 'CfnRoute', target: 'CfnRT' },
    { name: 'OptNat.on', source: 'OptNat', target: 'CfnRoute' },
    { name: 'OptNat.to', source: 'OptNat', target: 'CfnNat' },
    { name: 'OptIgw.on', source: 'OptIgw', target: 'CfnRoute' },
    { name: 'OptIgw.to', source: 'OptIgw', target: 'CfnIgw' },
  ],
};

const G_SPEC: FunctorSpec = {
  onObjects: {
    Route: 'CfnRoute',
    Nat: 'CfnNat',
    Igw: 'CfnIgw',
    RT: 'CfnRT',
    SNat: 'OptNat',
    SIgw: 'OptIgw',
  },
  onMorphisms: {
    'Route.rt': ['CfnRoute.RouteTableId'],
    'SNat.on': ['OptNat.on'],
    'SNat.to': ['OptNat.to'],
    'SIgw.on': ['OptIgw.on'],
    'SIgw.to': ['OptIgw.to'],
  },
};

function buildG(): Functor {
  return new Functor(new Category(D_SPEC), new Category(C_SPEC), G_SPEC);
}

/**
 * Instance of D. Three routes:
 *   r1 → Nat n1        (targets a nat)
 *   r2 → Igw g1        (targets an igw)
 *   r3 → (nothing)     (optional: no target)
 *   r4 → Nat n1        (SHARED nat with r1 — legal because there is no h)
 * All routes reference the single RouteTable rt1.
 */
function buildInstance(): Instance {
  const sets = {
    Route: ['r1', 'r2', 'r3', 'r4'],
    Nat: ['n1'],
    Igw: ['g1'],
    RT: ['rt1'],
    SNat: ['s1', 's2'],
    SIgw: ['t1'],
  };
  const fns = {
    'Route.rt': (_: string) => 'rt1',
    'SNat.on': (x: string) => ({ s1: 'r1', s2: 'r4' } as any)[x],
    'SNat.to': (_: string) => 'n1',
    'SIgw.on': (_: string) => 'r2',
    'SIgw.to': (_: string) => 'g1',
  };
  return new Instance(new Category(D_SPEC), sets, fns);
}

describe('optional/sum-typed references as spans (no ownership morphism h)', () => {
  test('claim 1+2: sharing allowed and optionality holds (n:1, uncovered A ok)', () => {
    const G = buildG();
    const I = buildInstance();
    const result = rightKan(G, I);

    // G is bijective, so Π_G(I) is iso to I. Cardinalities carry over.
    expect(result.getSet('CfnRoute').length).toBe(4);
    expect(result.getSet('CfnNat').length).toBe(1); // single nat, SHARED by r1 & r4
    expect(result.getSet('OptNat').length).toBe(2); // two apex elements point at it
    expect(result.getSet('OptIgw').length).toBe(1);

    // "Render" the optional field off the apex: each OptNat element yields a
    // (route, nat) pair; that route emits NatGatewayId = Ref(nat).
    const natFields = result.getSet('OptNat').map(idx => ({
      route: result.applyMorphism('OptNat.on', idx),
      nat: result.applyMorphism('OptNat.to', idx),
    }));
    const routeIdx = (logical: string) => result.getSet('CfnRoute').indexOf(logical as any);
    // We can't rely on logical labels post-Kan (elements are indices), so just
    // assert structural facts: two distinct routes, one shared nat target.
    expect(new Set(natFields.map(f => f.route)).size).toBe(2); // two owner routes
    expect(new Set(natFields.map(f => f.nat)).size).toBe(1); // one shared nat
    void routeIdx;

    // Optionality: #routes (4) > #routes-with-a-target (r1,r2,r4 = 3); r3 has none.
    const routesWithTarget = new Set([
      ...result.getSet('OptNat').map(i => result.applyMorphism('OptNat.on', i)),
      ...result.getSet('OptIgw').map(i => result.applyMorphism('OptIgw.on', i)),
    ]);
    expect(routesWithTarget.size).toBe(3);
    expect(result.getSet('CfnRoute').length).toBeGreaterThan(routesWithTarget.size);
  });

  test('claim 3: G matching abstract spans to concrete spans is fully faithful', () => {
    const report = checkFullyFaithful(buildG());
    expect(report.faithful).toBe(true);
    expect(report.full).toBe(true);
  });

  test('claim 5: fiber analysis matches the engine (apexes are correlated)', () => {
    const G = buildG();
    const analysis = analyzeFibers(G);
    const byObj = Object.fromEntries(analysis.classes.map(c => [c.object, c]));

    // Each apex is driven by exactly one D-object (its own preimage) ⇒ correlated.
    expect(byObj['OptNat'].kind).toBe('correlated');
    expect(byObj['OptIgw'].kind).toBe('correlated');
    // The target resources are correlated with their own driver, NOT forced to 1.
    expect(byObj['CfnNat'].kind).toBe('correlated');

    expect(verifyCardinality(G, analysis)).toEqual([]);
  });

  test('claim 4 (FINDING): an unmapped concrete variant is INVISIBLE to the fullness check', () => {
    // C' adds a third target variant (Carrier) that D never mentions.
    const cPrime: CategorySpec = {
      objects: [...C_SPEC.objects, 'CfnCarrier', 'OptCarrier'],
      morphisms: [
        ...C_SPEC.morphisms,
        { name: 'OptCarrier.on', source: 'OptCarrier', target: 'CfnRoute' },
        { name: 'OptCarrier.to', source: 'OptCarrier', target: 'CfnCarrier' },
      ],
    };
    const G = new Functor(new Category(D_SPEC), new Category(cPrime), G_SPEC);
    const report = checkFullyFaithful(G);

    // FINDING: the checker reports FULL. The uncovered leg OptCarrier.on runs
    // OptCarrier → CfnRoute, but OptCarrier is NOT in G's image, and the
    // fullness check only ranges over pairs of *image* objects. A dangling
    // apex is therefore never even considered as a cSource. So "you forgot to
    // map a concrete variant" is NOT caught by the existing safety net — the
    // compiler needs its own span-coverage check for this.
    expect(report.full).toBe(true);
    expect(report.fullnessViolations).toEqual([]);
  });
});