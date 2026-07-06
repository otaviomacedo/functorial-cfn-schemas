import { Pattern } from '../src';

const pattern = new Pattern({
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

describe('Render layer', () => {
  it('produces a complete CloudFormation-like template', () => {
    const skeleton = pattern
      .instantiate(
        {
          Net: ['prod'],
          VpcBlock: ['10.0.0.0/16'],
          SubnetBlock: ['10.0.1.0/24'],
          GatewayToggle: ['*'],
        },
        {
          net_vpcblock: () => '10.0.0.0/16',
          net_subblock: () => '10.0.1.0/24',
        },
      )
      .expand();

    const logicalIds: string[] = [];

    const resources = skeleton.render({
      VPC: (ctx) => {
        const id = 'MyVPC';
        logicalIds.push(id);
        return {
          logicalId: id,
          Type: 'AWS::EC2::VPC',
          Properties: {
            CidrBlock: '10.0.0.0/16',
            EnableDnsSupport: true,
            EnableDnsHostnames: true,
          },
        };
      },
      Subnet: (ctx) => {
        const id = `Subnet${ctx.index}`;
        logicalIds.push(id);
        return {
          logicalId: id,
          Type: 'AWS::EC2::Subnet',
          Properties: {
            VpcId: { Ref: 'MyVPC' },
            CidrBlock: '10.0.1.0/24',
            MapPublicIpOnLaunch: true,
          },
        };
      },
      IGW: (ctx) => {
        const id = 'IGW';
        logicalIds.push(id);
        return {
          logicalId: id,
          Type: 'AWS::EC2::InternetGateway',
          Properties: {},
        };
      },
      Attach: (ctx) => {
        const id = 'VPCGatewayAttachment';
        logicalIds.push(id);
        return {
          logicalId: id,
          Type: 'AWS::EC2::VPCGatewayAttachment',
          Properties: {
            VpcId: { Ref: 'MyVPC' },
            InternetGatewayId: { Ref: 'IGW' },
          },
        };
      },
    });

    expect(resources).toHaveLength(4);

    const vpc = resources.find((r: any) => r.Type === 'AWS::EC2::VPC')!;
    expect(vpc.Properties.CidrBlock).toBe('10.0.0.0/16');
    expect(vpc.Properties.EnableDnsSupport).toBe(true);

    const subnet = resources.find((r: any) => r.Type === 'AWS::EC2::Subnet')!;
    expect(subnet.Properties.VpcId).toEqual({ Ref: 'MyVPC' });
    expect(subnet.Properties.MapPublicIpOnLaunch).toBe(true);
  });

  it('skips resources when gateway is disabled', () => {
    const skeleton = pattern
      .instantiate(
        {
          Net: ['prod'],
          VpcBlock: ['10.0.0.0/16'],
          SubnetBlock: ['10.0.1.0/24'],
          GatewayToggle: [],
        },
        {
          net_vpcblock: () => '10.0.0.0/16',
          net_subblock: () => '10.0.1.0/24',
        },
      )
      .expand();

    const resources = skeleton.render({
      VPC: () => ({ Type: 'AWS::EC2::VPC' }),
      Subnet: () => ({ Type: 'AWS::EC2::Subnet' }),
      IGW: () => ({ Type: 'AWS::EC2::InternetGateway' }),
      Attach: () => ({ Type: 'AWS::EC2::VPCGatewayAttachment' }),
    });

    const types = resources.map((r: any) => r.Type);
    expect(types).toContain('AWS::EC2::VPC');
    expect(types).toContain('AWS::EC2::Subnet');
    expect(types).not.toContain('AWS::EC2::InternetGateway');
    expect(types).not.toContain('AWS::EC2::VPCGatewayAttachment');
  });

  it('renders multiple subnets with indexed names', () => {
    const skeleton = pattern
      .instantiate(
        {
          Net: ['web', 'app', 'db'],
          VpcBlock: ['10.0.0.0/16'],
          SubnetBlock: ['10.0.1.0/24', '10.0.2.0/24', '10.0.3.0/24'],
          GatewayToggle: ['*'],
        },
        {
          net_vpcblock: () => '10.0.0.0/16',
          net_subblock: (x: string) => {
            const map: Record<string, string> = {
              web: '10.0.1.0/24',
              app: '10.0.2.0/24',
              db: '10.0.3.0/24',
            };
            return map[x];
          },
        },
      )
      .expand();

    const resources = skeleton.render({
      VPC: () => ({ Type: 'AWS::EC2::VPC' }),
      Subnet: (ctx) => ({
        Type: 'AWS::EC2::Subnet',
        LogicalId: `Subnet${ctx.index}`,
      }),
      IGW: () => ({ Type: 'AWS::EC2::InternetGateway' }),
      Attach: () => ({ Type: 'AWS::EC2::VPCGatewayAttachment' }),
    });

    const subnets = resources.filter((r: any) => r.Type === 'AWS::EC2::Subnet');
    expect(subnets).toHaveLength(3);
    expect(subnets.map((s: any) => s.LogicalId).sort()).toEqual([
      'Subnet0',
      'Subnet1',
      'Subnet2',
    ]);
  });
});
