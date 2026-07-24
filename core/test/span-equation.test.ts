/**
 * PRESSURE TEST follow-up: what does a consistency equation through a SPAN mean?
 *
 * Author intent (unified apigw): "an authorized method shares its API with its
 * authorizer", written `Method.Authorizer.Api = Method.Route.Api`. But once the
 * optional `Authorizer` is a span (apex ←on— Method, apex —to→ Authorizer), the
 * path `Method.Authorizer` is not a function from Method — it is partial.
 *
 * Claim: the correct lowering RE-ROOTS the equation at the apex. Every path in
 * the equation is prefixed to start from the apex — the traversed optional field
 * `Method.Authorizer.*` becomes `apex.to * Authorizer.*`, and every *other* path
 * from Method becomes `apex.on * Method.*`. The result is a constraint that only
 * bites on methods that HAVE an authorizer — exactly the partial semantics, and
 * exactly what the old PublicMethod/AuthorizedMethod split expressed by putting
 * the equation on AuthorizedMethod.
 *
 * This test builds the re-rooted category by hand and checks that (a) the
 * category is coherent and (b) the functor is fully faithful — confirming the
 * proposed lowering rule before we implement it.
 */

import { Category, CategorySpec } from '../src/category';
import { Functor, FunctorSpec } from '../src/functor';
import { Instance } from '../src/instance';
import { rightKan } from '../src/kan';
import { checkFullyFaithful } from '../src/faithfulness';

// D, unified: single Method, optional Authorizer as a span, equation re-rooted
// at the apex MA (= Method__Authorizer).
const D_SPEC: CategorySpec = {
  objects: ['Api', 'Route', 'Authorizer', 'Method', 'MA'],
  morphisms: [
    { name: 'Route.Api', source: 'Route', target: 'Api' },
    { name: 'Authorizer.Api', source: 'Authorizer', target: 'Api' },
    { name: 'Method.Route', source: 'Method', target: 'Route' },
    { name: 'MA.on', source: 'MA', target: 'Method' },
    { name: 'MA.to', source: 'MA', target: 'Authorizer' },
  ],
  equations: [
    // apex.on * Method.Route * Route.Api  =  apex.to * Authorizer.Api
    {
      lhs: ['MA.on', 'Method.Route', 'Route.Api'],
      rhs: ['MA.to', 'Authorizer.Api'],
    },
  ],
};

// C, unified CFN side: same shape with the analogous re-rooted equation, plus
// the Method.RestApiId = Method.ResourceId.RestApiId invariant. Names differ so
// G is a genuine mapping.
const C_SPEC: CategorySpec = {
  objects: ['RestApi', 'Resource', 'CfnAuth', 'CfnMethod', 'CMA'],
  morphisms: [
    { name: 'Resource.RestApiId', source: 'Resource', target: 'RestApi' },
    { name: 'CfnAuth.RestApiId', source: 'CfnAuth', target: 'RestApi' },
    { name: 'CfnMethod.RestApiId', source: 'CfnMethod', target: 'RestApi' },
    { name: 'CfnMethod.ResourceId', source: 'CfnMethod', target: 'Resource' },
    { name: 'CMA.on', source: 'CMA', target: 'CfnMethod' },
    { name: 'CMA.to', source: 'CMA', target: 'CfnAuth' },
  ],
  equations: [
    // Method's API matches its Resource's API (the non-optional invariant).
    {
      lhs: ['CfnMethod.RestApiId'],
      rhs: ['CfnMethod.ResourceId', 'Resource.RestApiId'],
    },
    // Re-rooted authorizer-shares-API invariant, through the span apex.
    {
      lhs: ['CMA.on', 'CfnMethod.RestApiId'],
      rhs: ['CMA.to', 'CfnAuth.RestApiId'],
    },
  ],
};

const G_SPEC: FunctorSpec = {
  onObjects: {
    Api: 'RestApi',
    Route: 'Resource',
    Authorizer: 'CfnAuth',
    Method: 'CfnMethod',
    MA: 'CMA',
  },
  onMorphisms: {
    'Route.Api': ['Resource.RestApiId'],
    'Authorizer.Api': ['CfnAuth.RestApiId'],
    // Method.Route ↦ CfnMethod.ResourceId ; Route.Api ↦ Resource.RestApiId, so
    // Method.Route * Route.Api lands on CfnMethod.RestApiId via the C equation.
    'Method.Route': ['CfnMethod.ResourceId'],
    'MA.on': ['CMA.on'],
    'MA.to': ['CMA.to'],
  },
};

function buildG(): Functor {
  return new Functor(new Category(D_SPEC), new Category(C_SPEC), G_SPEC);
}

describe('consistency equation through a span, re-rooted at the apex', () => {
  test('D is coherent and the re-rooted equation is well-formed', () => {
    const D = new Category(D_SPEC);
    // Both sides of the re-rooted equation run MA → Api; they are parallel.
    expect(D.pathTarget(['MA.on', 'Method.Route', 'Route.Api'])).toBe('Api');
    expect(D.pathTarget(['MA.to', 'Authorizer.Api'])).toBe('Api');
    expect(D.pathSource(['MA.on', 'Method.Route', 'Route.Api'])).toBe('MA');
    expect(D.pathSource(['MA.to', 'Authorizer.Api'])).toBe('MA');
  });

  test('G is fully faithful (the re-rooted equations match across D and C)', () => {
    const report = checkFullyFaithful(buildG());
    expect(report.faithful).toBe(true);
    expect(report.full).toBe(true);
  });

  test('the constraint bites only on methods that HAVE an authorizer', () => {
    const G = buildG();
    // Two methods m1,m2; two apis a1,a2; routes r1→a1, r2→a2.
    // Only m1 has an authorizer, and (coherently) that authorizer is on a1.
    const D = new Category(D_SPEC);
    const I = new Instance(D, {
      Api: ['a1', 'a2'],
      Route: ['r1', 'r2'],
      Authorizer: ['auth1'],
      Method: ['m1', 'm2'],
      MA: ['x1'], // one apex element: m1's authorizer
    }, {
      'Route.Api': (r: string) => ({ r1: 'a1', r2: 'a2' } as any)[r],
      'Authorizer.Api': (_: string) => 'a1',
      'Method.Route': (m: string) => ({ m1: 'r1', m2: 'r2' } as any)[m],
      'MA.on': (_: string) => 'm1',
      'MA.to': (_: string) => 'auth1',
    });

    const result = rightKan(G, I);
    // Coherent instance ⇒ nothing filtered: both methods survive, one apex.
    expect(result.getSet('CfnMethod').length).toBe(2);
    expect(result.getSet('CMA').length).toBe(1);
    // m2 has no authorizer and is unconstrained by the authorizer equation —
    // it still renders (optionality preserved).
    expect(result.getSet('CfnAuth').length).toBe(1);
  });
});