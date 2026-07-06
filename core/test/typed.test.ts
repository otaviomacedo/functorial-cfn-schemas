import { defineSchema, definePattern } from '../src';

const realSchema = defineSchema({
  objects: ['VPC', 'Subnet', 'IGW', 'Attach', 'VpcBlock', 'SubnetBlock', 'GatewayToggle'] as const,
  morphisms: [
    { name: 'vpc_cidr', source: 'VPC', target: 'VpcBlock' },
    { name: 'subnet_vpc', source: 'Subnet', target: 'VPC' },
    { name: 'subnet_cidr', source: 'Subnet', target: 'SubnetBlock' },
    { name: 'attach_vpc', source: 'Attach', target: 'VPC' },
    { name: 'attach_igw', source: 'Attach', target: 'IGW' },
    { name: 'igw_toggle', source: 'IGW', target: 'GatewayToggle' },
  ] as const,
});

const simplifiedSchema = defineSchema({
  objects: ['Net', 'VpcBlock', 'SubnetBlock', 'GatewayToggle'] as const,
  morphisms: [
    { name: 'net_vpcblock', source: 'Net', target: 'VpcBlock' },
    { name: 'net_subblock', source: 'Net', target: 'SubnetBlock' },
  ] as const,
});

// Element type declaration: what type lives in each set
type SimplifiedElements = {
  Net: string;
  VpcBlock: string;
  SubnetBlock: string;
  GatewayToggle: '*';
};

type RealElements = {
  VPC: string;
  Subnet: string;
  IGW: '*';
  Attach: string;
  VpcBlock: string;
  SubnetBlock: string;
  GatewayToggle: '*';
};

const pattern = definePattern<
  typeof simplifiedSchema,
  typeof realSchema,
  SimplifiedElements,
  RealElements
>({
  real: realSchema,
  simplified: simplifiedSchema,
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

describe('Typed pattern API', () => {
  it('instantiates with correctly typed sets and functions', () => {
    // TypeScript enforces:
    // - sets must have keys: Net, VpcBlock, SubnetBlock, GatewayToggle
    // - sets['Net'] must be string[]
    // - functions must have keys: net_vpcblock, net_subblock
    // - net_vpcblock must be (x: string) => string (Net → VpcBlock, both string)
    // - net_subblock must be (x: string) => string (Net → SubnetBlock, both string)
    const instance = pattern.instantiate(
      {
        Net: ['my-network'],
        VpcBlock: ['10.0.0.0/16'],
        SubnetBlock: ['10.0.1.0/24'],
        GatewayToggle: ['*'],
      },
      {
        net_vpcblock: (_x) => '10.0.0.0/16',
        net_subblock: (_x) => '10.0.1.0/24',
      },
    );

    const skeleton = instance.expand();
    const counts = skeleton.counts();

    // counts is typed: { VPC: number, Subnet: number, IGW: number, ... }
    expect(counts.VPC).toBe(1);
    expect(counts.Subnet).toBe(1);
    expect(counts.IGW).toBe(1);
    expect(counts.Attach).toBe(1);
  });

  it('works with empty toggle', () => {
    const instance = pattern.instantiate(
      {
        Net: ['my-network'],
        VpcBlock: ['10.0.0.0/16'],
        SubnetBlock: ['10.0.1.0/24'],
        GatewayToggle: [],
      },
      {
        net_vpcblock: (_x) => '10.0.0.0/16',
        net_subblock: (_x) => '10.0.1.0/24',
      },
    );

    const skeleton = instance.expand();
    expect(skeleton.counts().IGW).toBe(0);
    expect(skeleton.counts().Attach).toBe(0);
  });

  it('renders with typed callbacks', () => {
    const instance = pattern.instantiate(
      {
        Net: ['my-network'],
        VpcBlock: ['10.0.0.0/16'],
        SubnetBlock: ['10.0.1.0/24'],
        GatewayToggle: ['*'],
      },
      {
        net_vpcblock: (_x) => '10.0.0.0/16',
        net_subblock: (_x) => '10.0.1.0/24',
      },
    );

    const skeleton = instance.expand();

    // Render callbacks are typed per-object:
    // - VPC callback receives ctx where ctx.object is 'VPC'
    // - refs are keyed by morphisms whose source is that object
    const resources = skeleton.render({
      VPC: (ctx) => {
        // ctx.refs has vpc_cidr (since vpc_cidr has source 'VPC')
        return {
          Type: 'AWS::EC2::VPC',
          Index: ctx.index,
        };
      },
      Subnet: (ctx) => ({
        Type: 'AWS::EC2::Subnet',
        Index: ctx.index,
        // ctx.refs has subnet_vpc and subnet_cidr
      }),
      IGW: (ctx) => ({
        Type: 'AWS::EC2::InternetGateway',
        Index: ctx.index,
      }),
      Attach: (ctx) => ({
        Type: 'AWS::EC2::VPCGatewayAttachment',
        Index: ctx.index,
      }),
    });

    expect(resources).toHaveLength(4);
  });
});

// ============================================================
// Compile-time type safety: the following all produce TS errors.
// These are verified by the separate type-errors.ts file
// (run `npx tsc --noEmit` to confirm).
// ============================================================
