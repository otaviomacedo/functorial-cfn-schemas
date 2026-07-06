import { Category, Functor, Instance, renderToCdk } from '../src';

/**
 * Simulated CDK constructs. In real CDK, these would be CfnVPC, CfnSubnet, etc.
 * We simulate the key behavior: each construct has a .ref token and properties.
 */
interface MockConstruct {
  logicalId: string;
  type: string;
  properties: Record<string, any>;
  ref: string;
  getAtt: (attr: string) => string;
}

function mockConstruct(logicalId: string, type: string, props: Record<string, any>): MockConstruct {
  return {
    logicalId,
    type,
    properties: props,
    ref: `\${${logicalId}.Ref}`,
    getAtt: (attr) => `\${${logicalId}.${attr}}`,
  };
}

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

describe('CDK Bridge', () => {
  it('creates constructs in topological order with resolved references', () => {
    const I = new Instance(D,
      {
        Net: ['my-network'],
        VpcBlock: ['10.0.0.0/16'],
        SubnetBlock: ['10.0.1.0/24'],
        GatewayToggle: ['*'],
      },
      {
        net_vpcblock: () => '10.0.0.0/16',
        net_subblock: () => '10.0.1.0/24',
      },
    );

    const constructs = renderToCdk<MockConstruct>(G, I, {
      skip: ['VpcBlock', 'SubnetBlock', 'GatewayToggle'],
      callbacks: {
        VPC: (ctx) => mockConstruct('MyVPC', 'AWS::EC2::VPC', {
          CidrBlock: '10.0.0.0/16',
          EnableDnsSupport: true,
        }),
        Subnet: (ctx) => {
          const vpc = ctx.ref('subnet_vpc');
          return mockConstruct('MySubnet', 'AWS::EC2::Subnet', {
            VpcId: vpc.ref,
            CidrBlock: '10.0.1.0/24',
          });
        },
        IGW: (ctx) => mockConstruct('MyIGW', 'AWS::EC2::InternetGateway', {}),
        Attach: (ctx) => {
          const vpc = ctx.ref('attach_vpc');
          const igw = ctx.ref('attach_igw');
          return mockConstruct('MyAttach', 'AWS::EC2::VPCGatewayAttachment', {
            VpcId: vpc.ref,
            InternetGatewayId: igw.ref,
          });
        },
      },
    });

    expect(constructs.size).toBe(4);

    const vpc = constructs.get('VPC')!;
    expect(vpc.type).toBe('AWS::EC2::VPC');
    expect(vpc.properties.CidrBlock).toBe('10.0.0.0/16');

    const subnet = constructs.get('Subnet')!;
    expect(subnet.type).toBe('AWS::EC2::Subnet');
    expect(subnet.properties.VpcId).toBe('${MyVPC.Ref}');

    const attach = constructs.get('Attach')!;
    expect(attach.properties.VpcId).toBe('${MyVPC.Ref}');
    expect(attach.properties.InternetGatewayId).toBe('${MyIGW.Ref}');
  });

  it('skips objects with empty sets (toggle off)', () => {
    const I = new Instance(D,
      {
        Net: ['my-network'],
        VpcBlock: ['10.0.0.0/16'],
        SubnetBlock: ['10.0.1.0/24'],
        GatewayToggle: [],
      },
      {
        net_vpcblock: () => '10.0.0.0/16',
        net_subblock: () => '10.0.1.0/24',
      },
    );

    const constructs = renderToCdk<MockConstruct>(G, I, {
      skip: ['VpcBlock', 'SubnetBlock', 'GatewayToggle'],
      callbacks: {
        VPC: () => mockConstruct('MyVPC', 'AWS::EC2::VPC', {}),
        Subnet: (ctx) => mockConstruct('MySubnet', 'AWS::EC2::Subnet', {
          VpcId: ctx.ref('subnet_vpc').ref,
        }),
        IGW: () => mockConstruct('MyIGW', 'AWS::EC2::InternetGateway', {}),
        Attach: (ctx) => mockConstruct('MyAttach', 'AWS::EC2::VPCGatewayAttachment', {
          VpcId: ctx.ref('attach_vpc').ref,
          InternetGatewayId: ctx.ref('attach_igw').ref,
        }),
      },
    });

    // IGW and Attach have 0 elements, so no constructs created
    expect(constructs.size).toBe(2);
    expect(constructs.has('VPC')).toBe(true);
    expect(constructs.has('Subnet')).toBe(true);
    expect(constructs.has('IGW')).toBe(false);
    expect(constructs.has('Attach')).toBe(false);
  });

  it('handles multiple elements with indexed logical IDs', () => {
    const I = new Instance(D,
      {
        Net: ['web', 'app', 'db'],
        VpcBlock: ['10.0.0.0/16'],
        SubnetBlock: ['10.0.1.0/24', '10.0.2.0/24', '10.0.3.0/24'],
        GatewayToggle: ['*'],
      },
      {
        net_vpcblock: () => '10.0.0.0/16',
        net_subblock: (x: string) => ({
          web: '10.0.1.0/24',
          app: '10.0.2.0/24',
          db: '10.0.3.0/24',
        }[x]),
      },
    );

    const constructs = renderToCdk<MockConstruct>(G, I, {
      skip: ['VpcBlock', 'SubnetBlock', 'GatewayToggle'],
      callbacks: {
        VPC: () => mockConstruct('VPC', 'AWS::EC2::VPC', {}),
        Subnet: (ctx) => mockConstruct(
          `Subnet${ctx.index}`,
          'AWS::EC2::Subnet',
          { VpcId: ctx.ref('subnet_vpc').ref },
        ),
        IGW: () => mockConstruct('IGW', 'AWS::EC2::InternetGateway', {}),
        Attach: (ctx) => mockConstruct('Attach', 'AWS::EC2::VPCGatewayAttachment', {
          VpcId: ctx.ref('attach_vpc').ref,
          InternetGatewayId: ctx.ref('attach_igw').ref,
        }),
      },
    });

    // 1 VPC, 3 Subnets, 1 IGW, 1 Attach = 6 constructs
    expect(constructs.size).toBe(6);

    // Subnets get indexed logical IDs
    expect(constructs.has('Subnet0')).toBe(true);
    expect(constructs.has('Subnet1')).toBe(true);
    expect(constructs.has('Subnet2')).toBe(true);

    // All subnets reference the same VPC
    for (const [id, c] of constructs) {
      if (c.type === 'AWS::EC2::Subnet') {
        expect(c.properties.VpcId).toBe('${VPC.Ref}');
      }
    }
  });

  it('provides allOf for cross-element references', () => {
    const I = new Instance(D,
      {
        Net: ['a', 'b'],
        VpcBlock: ['10.0.0.0/16'],
        SubnetBlock: ['10.0.1.0/24', '10.0.2.0/24'],
        GatewayToggle: ['*'],
      },
      {
        net_vpcblock: () => '10.0.0.0/16',
        net_subblock: (x: string) =>
          x === 'a' ? '10.0.1.0/24' : '10.0.2.0/24',
      },
    );

    let capturedSubnets: MockConstruct[] = [];

    renderToCdk<MockConstruct>(G, I, {
      skip: ['VpcBlock', 'SubnetBlock', 'GatewayToggle'],
      callbacks: {
        VPC: (ctx) => {
          capturedSubnets = ctx.allOf('Subnet');
          return mockConstruct('VPC', 'AWS::EC2::VPC', {});
        },
        Subnet: (ctx) => mockConstruct(`Sub${ctx.index}`, 'AWS::EC2::Subnet', {}),
        IGW: () => mockConstruct('IGW', 'AWS::EC2::InternetGateway', {}),
        Attach: () => mockConstruct('Attach', 'AWS::EC2::VPCGatewayAttachment', {}),
      },
    });

    // VPC is rendered before Subnet (topological order: targets first),
    // so at VPC render time, subnets don't exist yet
    expect(capturedSubnets).toHaveLength(0);

    // But if we call allOf from Attach (which comes after Subnet), it works
    let capturedFromAttach: MockConstruct[] = [];
    renderToCdk<MockConstruct>(G, I, {
      skip: ['VpcBlock', 'SubnetBlock', 'GatewayToggle'],
      callbacks: {
        VPC: () => mockConstruct('VPC', 'AWS::EC2::VPC', {}),
        Subnet: (ctx) => mockConstruct(`Sub${ctx.index}`, 'AWS::EC2::Subnet', {}),
        IGW: () => mockConstruct('IGW', 'AWS::EC2::InternetGateway', {}),
        Attach: (ctx) => {
          capturedFromAttach = ctx.allOf('Subnet');
          return mockConstruct('Attach', 'AWS::EC2::VPCGatewayAttachment', {});
        },
      },
    });

    expect(capturedFromAttach).toHaveLength(2);
  });
});
