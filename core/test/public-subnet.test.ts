import { Pattern } from '../src';

const publicSubnetPattern = new Pattern({
  real: {
    objects: ['VPC', 'Subnet', 'IGW', 'Attach', 'VpcBlock', 'SubnetBlock', 'GatewayToggle'],
    morphisms: [
      { name: 'vpc_cidr', source: 'VPC', target: 'VpcBlock' },
      { name: 'subnet_vpc', source: 'Subnet', target: 'VPC' },
      { name: 'subnet_cidr', source: 'Subnet', target: 'SubnetBlock' },
      { name: 'attach_vpc', source: 'Attach', target: 'VPC' },
      { name: 'attach_igw', source: 'Attach', target: 'IGW' },
      { name: 'igw_toggle', source: 'IGW', target: 'GatewayToggle' },
    ],
  },
  simplified: {
    objects: ['Net', 'VpcBlock', 'SubnetBlock', 'GatewayToggle'],
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
      GatewayToggle: 'GatewayToggle',
    },
    onMorphisms: {
      net_vpcblock: ['subnet_vpc', 'vpc_cidr'],
      net_subblock: ['subnet_cidr'],
    },
  },
});

describe('Public Subnet pattern', () => {
  it('generates one of each resource with gateway enabled', () => {
    const instance = publicSubnetPattern.instantiate(
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

    const skeleton = instance.expand();
    const counts = skeleton.counts();

    expect(counts['VPC']).toBe(1);
    expect(counts['Subnet']).toBe(1);
    expect(counts['IGW']).toBe(1);
    expect(counts['Attach']).toBe(1);
    expect(counts['VpcBlock']).toBe(1);
    expect(counts['SubnetBlock']).toBe(1);
    expect(counts['GatewayToggle']).toBe(1);
  });

  it('kills IGW and Attach when gateway toggle is empty', () => {
    const instance = publicSubnetPattern.instantiate(
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

    const skeleton = instance.expand();
    const counts = skeleton.counts();

    expect(counts['VPC']).toBe(1);
    expect(counts['Subnet']).toBe(1);
    expect(counts['IGW']).toBe(0);
    expect(counts['Attach']).toBe(0);
    expect(counts['VpcBlock']).toBe(1);
    expect(counts['SubnetBlock']).toBe(1);
    expect(counts['GatewayToggle']).toBe(0);
  });

  it('correctly wires subnet to VPC', () => {
    const instance = publicSubnetPattern.instantiate(
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

    const skeleton = instance.expand();
    const mappings = skeleton.morphismMappings();

    // Subnet -> VPC: element 0 in Subnet maps to element 0 in VPC
    expect(mappings['subnet_vpc']).toEqual([{ from: 0, to: 0 }]);

    // Attach -> VPC: element 0 in Attach maps to element 0 in VPC
    expect(mappings['attach_vpc']).toEqual([{ from: 0, to: 0 }]);

    // Attach -> IGW: element 0 in Attach maps to element 0 in IGW
    expect(mappings['attach_igw']).toEqual([{ from: 0, to: 0 }]);
  });

  it('generates two subnets sharing one VPC', () => {
    const instance = publicSubnetPattern.instantiate(
      {
        Net: ['subnet-a', 'subnet-b'],
        VpcBlock: ['10.0.0.0/16'],
        SubnetBlock: ['10.0.1.0/24', '10.0.2.0/24'],
        GatewayToggle: ['*'],
      },
      {
        net_vpcblock: () => '10.0.0.0/16',
        net_subblock: (x: string) =>
          x === 'subnet-a' ? '10.0.1.0/24' : '10.0.2.0/24',
      },
    );

    const skeleton = instance.expand();
    const counts = skeleton.counts();

    expect(counts['Subnet']).toBe(2);
    expect(counts['VPC']).toBe(1);
    expect(counts['IGW']).toBe(1);
    expect(counts['Attach']).toBe(1);

    // Both subnets point to the same VPC
    const mappings = skeleton.morphismMappings();
    expect(mappings['subnet_vpc']).toEqual([
      { from: 0, to: 0 },
      { from: 1, to: 0 },
    ]);
  });

  it('renders to CloudFormation-like output', () => {
    const instance = publicSubnetPattern.instantiate(
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

    const skeleton = instance.expand();

    const resources = skeleton.render({
      VPC: (ctx) => ({
        Type: 'AWS::EC2::VPC',
        LogicalId: `VPC`,
        Properties: {
          CidrBlock: ctx.family.get('VpcBlock:vpc_cidr'),
        },
      }),
      Subnet: (ctx) => ({
        Type: 'AWS::EC2::Subnet',
        LogicalId: `Subnet`,
        Properties: {
          VpcId: { Ref: 'VPC' },
          CidrBlock: ctx.family.get('SubnetBlock:subnet_cidr'),
        },
      }),
      IGW: (ctx) => ({
        Type: 'AWS::EC2::InternetGateway',
        LogicalId: `IGW`,
        Properties: {},
      }),
      Attach: (ctx) => ({
        Type: 'AWS::EC2::VPCGatewayAttachment',
        LogicalId: `Attach`,
        Properties: {
          VpcId: { Ref: 'VPC' },
          InternetGatewayId: { Ref: 'IGW' },
        },
      }),
    });

    expect(resources).toHaveLength(4);
    expect(resources.find((r: any) => r.Type === 'AWS::EC2::VPC')).toBeDefined();
    expect(resources.find((r: any) => r.Type === 'AWS::EC2::InternetGateway')).toBeDefined();
    expect(resources.find((r: any) => r.Type === 'AWS::EC2::Subnet')).toBeDefined();
    expect(resources.find((r: any) => r.Type === 'AWS::EC2::VPCGatewayAttachment')).toBeDefined();
  });
});
