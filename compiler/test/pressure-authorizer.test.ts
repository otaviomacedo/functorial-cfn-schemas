/**
 * PRESSURE TEST: the SHARED optional reference with a consistency equation.
 *
 * The apigw schema currently splits Method into PublicMethod / AuthorizedMethod
 * to model the optional authorizer. The span design should collapse that into a
 * single Method with an optional `Authorizer?` reference (shared: many methods,
 * one authorizer — no `h`). The twist: an authorized method must share its API
 * with its authorizer, which the real schema enforces with a path equation.
 *
 * Question under test: can the author still STATE that equation once the
 * `Authorizer` reference has been erased into a synthetic span apex they cannot
 * name?
 */

import { parseSchemaFile, lowerSchemaFile } from '../src/schema-dsl';
import { parseSchema } from '../src/schema-parser';
import { Category, Functor, checkFullyFaithful } from '../../core/src';

function build(src: string) {
  const { raw } = lowerSchemaFile(parseSchemaFile(src));
  const parsed = parseSchema(raw);
  const D = new Category(parsed.simplified.categorySpec);
  const C = new Category(parsed.original.categorySpec);
  const G = new Functor(D, C, {
    onObjects: parsed.functor.onObjects,
    onMorphisms: parsed.functor.onMorphisms,
  });
  return { parsed, D, C, G };
}

// Unified schema: single Method with an OPTIONAL authorizer, on both sides.
// The equation `Method.Authorizer.Api = Method.Route.Api` is the shared-API
// invariant (the apigw faithfulness fix). The author writes it using the
// surface field name `Authorizer`, exactly as if it were a plain reference.
const SRC = `
  schema ApiGw {
    type AWS::ApiGateway::RestApi { } alias RestApi

    type AWS::ApiGateway::Resource {
      RestApiId { Source: RestApi }
      Path      { Value: String }
    } alias Resource

    type AWS::ApiGateway::Authorizer {
      RestApiId { Source: RestApi }
      Name      { Value: String }
    } alias Authorizer

    type AWS::ApiGateway::Method {
      RestApiId    { Source: RestApi }
      ResourceId   { Source: Resource }
      HttpMethod   { Value: String }
      AuthorizerId? { Source: Authorizer }
    } alias Method

    Method.RestApiId = Method.ResourceId.RestApiId
    Method.RestApiId = Method.AuthorizerId.RestApiId
  }

  schema Api {
    type Functorial::Api { } alias Api

    type Functorial::Route {
      Api  { Source: Api }
      Path { Value: String }
    } alias Route

    type Functorial::Authorizer {
      Api  { Source: Api }
      Name { Value: String }
    } alias Authorizer

    type Functorial::Method {
      Route      { Source: Route }
      HttpMethod { Value: String }
      Authorizer? { Source: Authorizer }
    } alias Method

    Method.Route.Api = Method.Authorizer.Api
  }

  map Api -> ApiGw {
    Api        -> RestApi
    Route      -> Resource
    Authorizer -> Authorizer
    Method     -> Method
  }
`;

describe('PRESSURE TEST — shared optional authorizer with a consistency equation', () => {
  test('the author states the equation through the surface field; it re-roots at the apex', () => {
    const { D } = build(SRC);

    // The surface morphism is gone (erased into the span), yet the equation
    // compiled — it was re-rooted at the apex `Method__Authorizer`.
    expect(D.morphisms.has('Method.Authorizer')).toBe(false);
    const apex = 'Method__Authorizer';
    expect(D.objects.has(apex)).toBe(true);

    // The re-rooted equation runs apex → Api on both sides:
    //   apex.on * Method.Route * Route.Api  =  apex.to * Authorizer.Api
    const eqs = D.spec.equations ?? [];
    const rerooted = eqs.find(
      e => e.lhs[0] === `${apex}.on` || e.rhs[0] === `${apex}.on` ||
           e.lhs[0] === `${apex}.to` || e.rhs[0] === `${apex}.to`,
    );
    expect(rerooted).toBeDefined();
    expect(D.pathSource(rerooted!.lhs)).toBe(apex);
    expect(D.pathSource(rerooted!.rhs)).toBe(apex);
    expect(D.pathTarget(rerooted!.lhs)).toBe('Api');
    expect(D.pathTarget(rerooted!.rhs)).toBe('Api');
  });

  test('the unified schema (no Public/Authorized split) is fully faithful', () => {
    const report = checkFullyFaithful(build(SRC).G);
    expect(report.faithful).toBe(true);
    expect(report.full).toBe(true);
  });

  test('an equation traversing two optional fields is rejected (ambiguous root)', () => {
    // Two optional refs on Method, an equation through both → no single apex.
    const twoOptional = `
      schema C {
        type AWS::X { } alias X
        type AWS::Y { } alias Y
        type AWS::M {
          A? { Source: X }
          B? { Source: Y }
        } alias M
      }
      schema D {
        type F::X { } alias X
        type F::Y { } alias Y
        type F::M {
          A? { Source: X }
          B? { Source: Y }
        } alias M
        M.A = M.B
      }
      map D -> C { X -> X  Y -> Y  M -> M }
    `;
    expect(() => build(twoOptional)).toThrow(/more than one optional\/sum field|ambiguous/i);
  });
});