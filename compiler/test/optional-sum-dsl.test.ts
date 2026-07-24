/**
 * End-to-end DSL tests for optional references and sum-typed fields.
 *
 * The abstraction author writes `A.field?: B` (optional) or `data T = …` + a
 * field of that sum type. The compiler desugars each to a span
 * `consumer ←on— apex —to→ producer` (monic `on`, NO reverse morphism, so the
 * producer may be shared), maps only the variant *objects* in the functor, and
 * infers the span pairing. These tests drive the real parse → lower → build
 * pipeline and check the resulting category, functor, and faithfulness.
 */

import { parseSchemaFile, lowerSchemaFile } from '../src/schema-dsl';
import { parseSchema } from '../src/schema-parser';
import { Category, Functor, checkFullyFaithful } from '../../core/src';

/** Parse a single-file schema and build the categories + functor. */
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

// An EC2 route whose target is one of several gateway types (a sum), plus an
// optional single reference (a description-carrying resource) to exercise the
// non-sum optional path. Abstract mirror maps variant objects one-to-one.
const SRC = `
  schema Ec2 {
    type AWS::EC2::RouteTable {
      Vpc { Source: Vpc }
    } alias RouteTable

    type AWS::EC2::NatGateway  { } alias CfnNat
    type AWS::EC2::InternetGateway { } alias CfnIgw
    type AWS::EC2::VpcEndpoint  { } alias CfnEndpoint

    type AWS::EC2::Route {
      RouteTableId { Source: RouteTable }
      NatGatewayId?  { Source: CfnNat,      Via: Ref }
      GatewayId?     { Source: CfnIgw,      Via: Ref }
      VpcEndpointId? { Source: CfnEndpoint, Via: Ref }
    } alias CfnRoute

    type AWS::EC2::VPC { } alias Vpc
  }

  schema Route {
    type Functorial::Route::Table {
      Vpc { Source: Vpc }
    } alias RT

    type Functorial::Route::Nat { } alias Nat
    type Functorial::Route::Igw { } alias Igw
    type Functorial::Route::Endpoint { } alias Endpoint

    data Target = Nat | Igw | Endpoint

    type Functorial::Route::Route {
      Table { Source: RT }
      TargetElement { Source: Target }
    } alias Route

    type Functorial::Route::Vpc { } alias Vpc
  }

  map Route -> Ec2 {
    RT       -> RouteTable
    Nat      -> CfnNat
    Igw      -> CfnIgw
    Endpoint -> CfnEndpoint
    Route    -> CfnRoute
    Vpc      -> Vpc
  }
`;

describe('optional + sum-typed references desugar to spans (DSL end-to-end)', () => {
  test('sum field erases; one span apex per variant, each with on/to legs', () => {
    const { D } = build(SRC);

    // The sum name and the surface field are erased — no such objects/morphisms.
    expect(D.objects.has('Target')).toBe(false);
    expect(D.morphisms.has('Route.TargetElement')).toBe(false);

    // One apex per variant.
    for (const variant of ['Nat', 'Igw', 'Endpoint']) {
      const apex = `Route__TargetElement__${variant}`;
      expect(D.objects.has(apex)).toBe(true);
      // on : apex → Route (the monic leg), to : apex → variant.
      expect(D.morphisms.get(`${apex}.on`)).toMatchObject({ source: apex, target: 'Route' });
      expect(D.morphisms.get(`${apex}.to`)).toMatchObject({ source: apex, target: variant });
    }

    // No reverse morphism Route → apex (ownership deliberately absent).
    for (const m of D.morphisms.values()) {
      expect(m.source === 'Route' && m.target.startsWith('Route__')).toBe(false);
    }

    // The mandatory ref stays a plain morphism.
    expect(D.morphisms.get('Route.Table')).toMatchObject({ source: 'Route', target: 'RT' });
  });

  test('author maps only variant objects; G is inferred, valid, and total', () => {
    const { G } = build(SRC);

    // Object map carries the apexes even though the author never wrote them.
    expect(G.mapObject('Route__TargetElement__Nat')).toBe('CfnRoute__NatGatewayId');
    expect(G.mapObject('Route__TargetElement__Igw')).toBe('CfnRoute__GatewayId');

    // Legs map to their concrete counterparts.
    expect(G.mapMorphism('Route__TargetElement__Nat.on')).toEqual(['CfnRoute__NatGatewayId.on']);
    expect(G.mapMorphism('Route__TargetElement__Nat.to')).toEqual(['CfnRoute__NatGatewayId.to']);
    // (Functor constructor already validated totality/commutativity on build.)
  });

  test('G matching abstract spans to concrete spans is fully faithful', () => {
    const report = checkFullyFaithful(build(SRC).G);
    expect(report.faithful).toBe(true);
    expect(report.full).toBe(true);
  });

  test('span-coverage warns when a concrete optional field has no abstract variant', () => {
    // Drop `Endpoint` from the abstract sum; the concrete VpcEndpointId span is
    // now unexposed. The fullness checker cannot see this (dangling apex outside
    // G's image), so the dedicated span-coverage check must catch it.
    const missing = SRC.replace('data Target = Nat | Igw | Endpoint', 'data Target = Nat | Igw')
      // Remove the now-unused abstract Endpoint object and its mapping so the
      // functor stays valid; the concrete CfnEndpoint/field remain.
      .replace('type Functorial::Route::Endpoint { } alias Endpoint', '')
      .replace('Endpoint -> CfnEndpoint', '');

    const { parsed } = build(missing);
    expect(parsed.spanCoverage).toBeDefined();
    expect(parsed.spanCoverage!.join('\n')).toMatch(/CfnRoute\.VpcEndpointId/);
  });

  test('mapping the erased sum field (Route.TargetElement) is rejected', () => {
    const bad = SRC.replace(
      'Route    -> CfnRoute',
      'Route    -> CfnRoute\n    Route.TargetElement -> CfnRoute.NatGatewayId',
    );
    expect(() => build(bad)).toThrow();
  });
});