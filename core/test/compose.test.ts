import { Category, Functor, Instance, inspectKan } from '../src';

/**
 * Test functor composition with a 3-level chain:
 *
 *   D' --H--> D --G--> C
 *
 * C = full CFN-like pattern (VPC, Subnet, IGW, Attach + value types)
 * D = intermediate simplification (Net + value types)
 * D' = ultra-simplified (just a Network name, everything else defaulted)
 */

const C = new Category({
  objects: ['VPC', 'Subnet', 'IGW', 'Attach', 'VpcBlock', 'SubnetBlock', 'GatewayToggle'],
  morphisms: [
    { name: 'vpc_cidr', source: 'VPC', target: 'VpcBlock' },
    { name: 'subnet_vpc', source: 'Subnet', target: 'VPC' },
    { name: 'subnet_cidr', source: 'Subnet', target: 'SubnetBlock' },
    { name: 'attach_vpc', source: 'Attach', target: 'VPC' },
    { name: 'attach_igw', source: 'Attach', target: 'IGW' },
    { name: 'igw_toggle', source: 'IGW', target: 'GatewayToggle' },
  ],
});

const D = new Category({
  objects: ['Net', 'VpcBlock', 'SubnetBlock', 'GatewayToggle'],
  morphisms: [
    { name: 'net_vpcblock', source: 'Net', target: 'VpcBlock' },
    { name: 'net_subblock', source: 'Net', target: 'SubnetBlock' },
  ],
});

const G = new Functor(D, C, {
  onObjects: {
    Net: 'Subnet',
    VpcBlock: 'VpcBlock',
    SubnetBlock: 'SubnetBlock',
    GatewayToggle: 'GatewayToggle',
  },
  onMorphisms: {
    net_vpcblock: ['subnet_vpc', 'vpc_cidr'],
    net_subblock: ['subnet_cidr'],
  },
});

// D' is even simpler: just a Network label, with fixed CIDR defaults
const Dprime = new Category({
  objects: ['Network', 'GatewayToggle'],
  morphisms: [],
});

const H = new Functor(Dprime, D, {
  onObjects: {
    Network: 'Net',
    GatewayToggle: 'GatewayToggle',
  },
  onMorphisms: {},
});

describe('Functor.compose', () => {
  it('produces a valid functor from D\' to C', () => {
    const GH = G.compose(H);

    expect(GH.source).toBe(Dprime);
    expect(GH.target).toBe(C);
    expect(GH.mapObject('Network')).toBe('Subnet');
    expect(GH.mapObject('GatewayToggle')).toBe('GatewayToggle');
  });

  it('maps morphisms through composition (empty case)', () => {
    const GH = G.compose(H);
    // D' has no morphisms, so there's nothing to check on morphisms,
    // but the functor should still be valid
    expect(GH.image()).toEqual(new Set(['Subnet', 'GatewayToggle']));
  });

  it('computes correct Kan extension through composed functor', () => {
    const GH = G.compose(H);

    const I = new Instance(Dprime, {
      Network: ['my-net'],
      GatewayToggle: ['*'],
    }, {});

    const result = inspectKan(GH, I);

    // Subnet gets one element (from Network)
    expect(result.objects['Subnet'].elements).toHaveLength(1);
    // VPC, IGW, Attach all get default singleton (no path from them to Network)
    expect(result.objects['VPC'].elements).toHaveLength(1);
    expect(result.objects['IGW'].elements).toHaveLength(1);
    expect(result.objects['Attach'].elements).toHaveLength(1);
    // GatewayToggle is in the image → gets one element
    expect(result.objects['GatewayToggle'].elements).toHaveLength(1);
    // VpcBlock and SubnetBlock: no path from them to D' image → singleton default
    expect(result.objects['VpcBlock'].elements).toHaveLength(1);
    expect(result.objects['SubnetBlock'].elements).toHaveLength(1);
  });

  it('toggle cascade works through composed functor', () => {
    const GH = G.compose(H);

    const I = new Instance(Dprime, {
      Network: ['my-net'],
      GatewayToggle: [],
    }, {});

    const result = inspectKan(GH, I);

    expect(result.objects['IGW'].elements).toHaveLength(0);
    expect(result.objects['Attach'].elements).toHaveLength(0);
    // Subnet and VPC still exist
    expect(result.objects['Subnet'].elements).toHaveLength(1);
    expect(result.objects['VPC'].elements).toHaveLength(1);
  });
});

describe('Functor.compose with non-trivial morphisms', () => {
  // D' has a morphism that maps through H to a path in D, then G maps to C
  const D2 = new Category({
    objects: ['SimpleNet', 'Cidr'],
    morphisms: [
      { name: 'net_cidr', source: 'SimpleNet', target: 'Cidr' },
    ],
  });

  const H2 = new Functor(D2, D, {
    onObjects: {
      SimpleNet: 'Net',
      Cidr: 'VpcBlock',
    },
    onMorphisms: {
      net_cidr: ['net_vpcblock'],
    },
  });

  it('composes morphism mappings correctly', () => {
    const GH2 = G.compose(H2);

    // H maps net_cidr → [net_vpcblock]
    // G maps net_vpcblock → [subnet_vpc, vpc_cidr]
    // So G∘H maps net_cidr → [subnet_vpc, vpc_cidr]
    expect(GH2.mapMorphism('net_cidr')).toEqual(['subnet_vpc', 'vpc_cidr']);
  });

  it('Kan extension through multi-hop morphism composition', () => {
    const GH2 = G.compose(H2);

    const I = new Instance(D2, {
      SimpleNet: ['my-net'],
      Cidr: ['10.0.0.0/16'],
    }, {
      net_cidr: () => '10.0.0.0/16',
    });

    const result = inspectKan(GH2, I);

    expect(result.objects['Subnet'].elements).toHaveLength(1);
    expect(result.objects['VPC'].elements).toHaveLength(1);
    expect(result.objects['VpcBlock'].elements).toHaveLength(1);
  });

  it('equivalence: Π_{G∘H}(I) = Π_G(Π_H(I))', () => {
    const GH2 = G.compose(H2);

    const I = new Instance(D2, {
      SimpleNet: ['my-net'],
      Cidr: ['10.0.0.0/16'],
    }, {
      net_cidr: () => '10.0.0.0/16',
    });

    // Direct: Π_{G∘H}(I)
    const direct = inspectKan(GH2, I);

    // Staged: first Π_H(I), then Π_G(Π_H(I))
    const intermediate = inspectKan(H2, I);
    const staged = inspectKan(G, intermediate.instance);

    // Both should produce the same cardinalities
    for (const obj of C.objects) {
      expect(direct.objects[obj].elements.length)
        .toBe(staged.objects[obj].elements.length);
    }
  });
});