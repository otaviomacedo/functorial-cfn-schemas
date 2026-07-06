import { Pattern } from '../src';

const natPattern = new Pattern({
  real: {
    objects: ['VPC', 'Subnet', 'NAT', 'EIP', 'RT', 'Route', 'VpcBlock', 'SubnetBlock', 'NatCount'],
    morphisms: [
      { name: 'vpc_cidr', source: 'VPC', target: 'VpcBlock' },
      { name: 'subnet_vpc', source: 'Subnet', target: 'VPC' },
      { name: 'subnet_cidr', source: 'Subnet', target: 'SubnetBlock' },
      { name: 'rt_vpc', source: 'RT', target: 'VPC' },
      { name: 'nat_subnet', source: 'NAT', target: 'Subnet' },
      { name: 'nat_eip', source: 'NAT', target: 'EIP' },
      { name: 'nat_count', source: 'NAT', target: 'NatCount' },
      { name: 'eip_count', source: 'EIP', target: 'NatCount' },
      { name: 'route_rt', source: 'Route', target: 'RT' },
      { name: 'route_nat', source: 'Route', target: 'NAT' },
    ],
    equations: [
      // nat_count = eip_count ∘ nat_eip
      // i.e., path [nat_count] equals path [nat_eip, eip_count]
      { lhs: ['nat_count'], rhs: ['nat_eip', 'eip_count'] },
    ],
  },
  simplified: {
    objects: ['Net', 'VpcBlock', 'SubnetBlock', 'NatCount'],
    morphisms: [
      { name: 'net_vpcblock', source: 'Net', target: 'VpcBlock' },
      { name: 'net_subblock', source: 'Net', target: 'SubnetBlock' },
    ],
  },
  functor: {
    onObjects: {
      Net: 'Subnet',
      VpcBlock: 'VpcBlock',
      SubnetBlock: 'SubnetBlock',
      NatCount: 'NatCount',
    },
    onMorphisms: {
      net_vpcblock: ['subnet_vpc', 'vpc_cidr'],
      net_subblock: ['subnet_cidr'],
    },
  },
});

describe('NAT Gateway pattern', () => {
  it('generates 3 NATs, 3 EIPs, 3 Routes for NatCount=3', () => {
    const instance = natPattern.instantiate(
      {
        Net: ['my-network'],
        VpcBlock: ['10.0.0.0/16'],
        SubnetBlock: ['10.0.1.0/24'],
        NatCount: [1, 2, 3],
      },
      {
        net_vpcblock: () => '10.0.0.0/16',
        net_subblock: () => '10.0.1.0/24',
      },
    );

    const skeleton = instance.expand();
    const counts = skeleton.counts();

    expect(counts['VPC']).toBe(1);
    expect(counts['Subnet']).toBe(1);
    expect(counts['RT']).toBe(1);
    expect(counts['NAT']).toBe(3);
    expect(counts['EIP']).toBe(3);
    expect(counts['Route']).toBe(3);
  });

  it('pairs NAT #k with EIP #k (bijection from path equation)', () => {
    const instance = natPattern.instantiate(
      {
        Net: ['my-network'],
        VpcBlock: ['10.0.0.0/16'],
        SubnetBlock: ['10.0.1.0/24'],
        NatCount: [1, 2, 3],
      },
      {
        net_vpcblock: () => '10.0.0.0/16',
        net_subblock: () => '10.0.1.0/24',
      },
    );

    const skeleton = instance.expand();
    const mappings = skeleton.morphismMappings();

    // nat_eip should be a bijection: NAT #i → EIP #i
    const natToEip = mappings['nat_eip'];
    expect(natToEip).toHaveLength(3);

    // Verify it's a bijection (all targets distinct)
    const targets = natToEip.map(m => m.to);
    expect(new Set(targets).size).toBe(3);

    // nat_count and eip_count should agree through nat_eip
    const natCount = mappings['nat_count'];
    const eipCount = mappings['eip_count'];

    for (const natMapping of natToEip) {
      const natIdx = natMapping.from;
      const eipIdx = natMapping.to;

      const natCountTarget = natCount.find(m => m.from === natIdx)!.to;
      const eipCountTarget = eipCount.find(m => m.from === eipIdx)!.to;

      // The path equation ensures these are equal
      expect(natCountTarget).toBe(eipCountTarget);
    }
  });

  it('all NATs reference the same subnet', () => {
    const instance = natPattern.instantiate(
      {
        Net: ['my-network'],
        VpcBlock: ['10.0.0.0/16'],
        SubnetBlock: ['10.0.1.0/24'],
        NatCount: [1, 2, 3],
      },
      {
        net_vpcblock: () => '10.0.0.0/16',
        net_subblock: () => '10.0.1.0/24',
      },
    );

    const skeleton = instance.expand();
    const mappings = skeleton.morphismMappings();

    const natToSubnet = mappings['nat_subnet'];
    expect(natToSubnet).toHaveLength(3);

    // All NATs point to the same subnet (index 0)
    for (const m of natToSubnet) {
      expect(m.to).toBe(0);
    }
  });

  it('all Routes reference the same RT', () => {
    const instance = natPattern.instantiate(
      {
        Net: ['my-network'],
        VpcBlock: ['10.0.0.0/16'],
        SubnetBlock: ['10.0.1.0/24'],
        NatCount: [1, 2, 3],
      },
      {
        net_vpcblock: () => '10.0.0.0/16',
        net_subblock: () => '10.0.1.0/24',
      },
    );

    const skeleton = instance.expand();
    const mappings = skeleton.morphismMappings();

    const routeToRT = mappings['route_rt'];
    expect(routeToRT).toHaveLength(3);

    for (const m of routeToRT) {
      expect(m.to).toBe(0);
    }
  });

  it('Route #k points to NAT #k', () => {
    const instance = natPattern.instantiate(
      {
        Net: ['my-network'],
        VpcBlock: ['10.0.0.0/16'],
        SubnetBlock: ['10.0.1.0/24'],
        NatCount: [1, 2, 3],
      },
      {
        net_vpcblock: () => '10.0.0.0/16',
        net_subblock: () => '10.0.1.0/24',
      },
    );

    const skeleton = instance.expand();
    const mappings = skeleton.morphismMappings();

    const routeToNat = mappings['route_nat'];
    expect(routeToNat).toHaveLength(3);

    // Should be a bijection
    const targets = routeToNat.map(m => m.to);
    expect(new Set(targets).size).toBe(3);
  });

  it('NatCount=0 kills NAT, EIP, and Route', () => {
    const instance = natPattern.instantiate(
      {
        Net: ['my-network'],
        VpcBlock: ['10.0.0.0/16'],
        SubnetBlock: ['10.0.1.0/24'],
        NatCount: [],
      },
      {
        net_vpcblock: () => '10.0.0.0/16',
        net_subblock: () => '10.0.1.0/24',
      },
    );

    const skeleton = instance.expand();
    const counts = skeleton.counts();

    expect(counts['NAT']).toBe(0);
    expect(counts['EIP']).toBe(0);
    expect(counts['Route']).toBe(0);

    // VPC, Subnet, RT are unaffected
    expect(counts['VPC']).toBe(1);
    expect(counts['Subnet']).toBe(1);
    expect(counts['RT']).toBe(1);
  });

  it('NatCount=1 gives exactly one of each', () => {
    const instance = natPattern.instantiate(
      {
        Net: ['my-network'],
        VpcBlock: ['10.0.0.0/16'],
        SubnetBlock: ['10.0.1.0/24'],
        NatCount: [1],
      },
      {
        net_vpcblock: () => '10.0.0.0/16',
        net_subblock: () => '10.0.1.0/24',
      },
    );

    const skeleton = instance.expand();
    const counts = skeleton.counts();

    expect(counts['NAT']).toBe(1);
    expect(counts['EIP']).toBe(1);
    expect(counts['Route']).toBe(1);
  });
});
