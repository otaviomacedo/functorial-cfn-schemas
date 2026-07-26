/**
 * Tests for cardinality opinions lowered as localizations of C₀.
 *
 * The abstraction author writes `invert <Obj.Prop>` (or `bijection <Obj>`) in
 * the `map` block. The compiler adds the morphism's formal inverse plus the two
 * identity equations to the codomain, so the right Kan extension re-indexes the
 * relevant fiber — forcing e.g. route tables 1:1 with subnets — WITHOUT a
 * hand-authored structural arrow in the ground-truth C₀.
 *
 * These drive the real parse → lower → build pipeline and check the resulting
 * category and functor. The end-to-end cardinality of the actual vpc.schema is
 * additionally covered by examples.test.ts (resource-count assertions).
 */

import { parseSchemaFile, lowerSchemaFile } from '../src/schema-dsl';
import { parseSchema } from '../src/schema-parser';
import { Category, Functor, Instance, rightKan, checkFullyFaithful } from '../../core/src';

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

// A minimal route-table world: VPC, Subnet, RouteTable, and a
// SubnetRouteTableAssociation span... modeled here as plain references so we can
// invert the RouteTableId leg. The abstraction exposes only Network + Subnet;
// route tables and associations are minted by the Kan extension.
const SRC = `
  schema Ec2 {
    type AWS::EC2::VPC { } alias VPC
    type AWS::EC2::Subnet {
      VpcId { Source: VPC }
    } alias Subnet
    type AWS::EC2::RouteTable {
      VpcId { Source: VPC }
    } alias RouteTable
    type AWS::EC2::SubnetRouteTableAssociation {
      SubnetId     { Source: Subnet }
      RouteTableId { Source: RouteTable }
    } alias Assoc

    Assoc.RouteTableId.VpcId = Assoc.SubnetId.VpcId
  }

  schema Vpc {
    type Functorial::VPC::Network { } alias Network
    type Functorial::VPC::Tier {
      Network { Source: Network }
    } alias Tier
  }

  map Vpc -> Ec2 {
    Network -> VPC
    Tier    -> Subnet
    Tier.Network -> Subnet.VpcId

    invert Assoc.RouteTableId
  }
`;

describe('invert lowers to a localization of C₀', () => {
  test('adds the formal inverse generator and two identity equations', () => {
    const { C } = build(SRC);
    // The inverse morphism exists, running RouteTable → Assoc.
    expect(C.morphisms.has('inv__Assoc__RouteTableId')).toBe(true);
    const inv = C.morphisms.get('inv__Assoc__RouteTableId')!;
    expect(inv.source).toBe('RouteTable');
    expect(inv.target).toBe('Assoc');

    // The two identity equations hold: inv · leg = id and leg · inv = id.
    expect(C.pathsEqual(['Assoc.RouteTableId', 'inv__Assoc__RouteTableId'], [])).toBe(true);
    expect(C.pathsEqual(['inv__Assoc__RouteTableId', 'Assoc.RouteTableId'], [])).toBe(true);
  });

  test('derives a RouteTable → Subnet path (the ex-fake arrow)', () => {
    const { C } = build(SRC);
    // RouteTable → Assoc → Subnet is now a real composite in C.
    const paths = C.allPaths('RouteTable', 'Subnet');
    expect(paths.length).toBeGreaterThan(0);
  });

  test('mints one route table per subnet (the 1:1 opinion)', () => {
    const { D, C, G } = build(SRC);
    // One network, two subnets over it.
    const I = new Instance(
      D,
      { Network: ['net'], Tier: ['s1', 's2'] },
      { 'Tier.Network': () => 'net' },
    );
    const result = rightKan(G, I);
    expect(result.getSet('Subnet').length).toBe(2);
    expect(result.getSet('RouteTable').length).toBe(2);
    expect(result.getSet('Assoc').length).toBe(2);
  });

  test('stays fully faithful (RouteTable is outside G\'s image)', () => {
    const { G } = build(SRC);
    const report = checkFullyFaithful(G);
    expect(report.faithful).toBe(true);
    expect(report.full).toBe(true);
  });
});

describe('bijection is sugar for inverting both reference legs', () => {
  const BIJ = SRC.replace('invert Assoc.RouteTableId', 'bijection Assoc');

  test('inverts both SubnetId and RouteTableId legs', () => {
    const { C } = build(BIJ);
    expect(C.morphisms.has('inv__Assoc__RouteTableId')).toBe(true);
    expect(C.morphisms.has('inv__Assoc__SubnetId')).toBe(true);
  });
});

describe('~ marks an inverted morphism inside a functor path', () => {
  // A D-morphism whose image traverses the inverse: RT → Sub, realized in C as
  // RouteTable → (RouteTableId)⁻¹ → Assoc → SubnetId → Subnet.
  const SRC_PATH = `
    schema Ec2 {
      type AWS::EC2::VPC { } alias VPC
      type AWS::EC2::Subnet { VpcId { Source: VPC } } alias Subnet
      type AWS::EC2::RouteTable { VpcId { Source: VPC } } alias RouteTable
      type AWS::EC2::SubnetRouteTableAssociation {
        SubnetId     { Source: Subnet }
        RouteTableId { Source: RouteTable }
      } alias Assoc
    }

    schema Vpc {
      type Functorial::VPC::Network { } alias Network
      type Functorial::VPC::Tier { Network { Source: Network } } alias Tier
      type Functorial::VPC::RouteTable {
        Network { Source: Network }
        Tier    { Source: Tier }
      } alias RT
    }

    map Vpc -> Ec2 {
      Network -> VPC
      Tier    -> Subnet
      RT      -> RouteTable
      Tier.Network -> Subnet.VpcId
      RT.Network   -> RouteTable.VpcId
      RT.Tier      -> ~Assoc.RouteTableId * Assoc.SubnetId

      invert Assoc.RouteTableId
    }
  `;

  test('~ resolves to the generated inverse name in the functor image', () => {
    const { parsed } = build(SRC_PATH);
    expect(parsed.functor.onMorphisms['RT.Tier']).toEqual([
      'inv__Assoc__RouteTableId',
      'Assoc.SubnetId',
    ]);
  });

  test('the built functor validates (path is composable end to end)', () => {
    // build() constructs the Functor, which validates source/target of every
    // mapped path — so a bad inverse endpoint would throw here.
    expect(() => build(SRC_PATH)).not.toThrow();
  });

  test('~ on a multi-hop chain is rejected', () => {
    const bad = SRC_PATH.replace(
      '~Assoc.RouteTableId',
      '~Assoc.RouteTableId.SubnetId',
    );
    expect(() => build(bad)).toThrow(/single Object.Property morphism/);
  });
});
