import * as path from 'path';
import { compileFile } from '../src';

// Silence full/faithfulness diagnostics here; they have dedicated coverage in
// core/test/faithfulness.test.ts. These end-to-end tests only assert output shape.
const example = (f: string) =>
  compileFile(path.resolve(__dirname, '..', 'examples', f), { onDiagnostic: () => {} });

describe('VPC examples (DSL, end-to-end)', () => {
  it('minimal isolated VPC produces the isolated resource set', () => {
    const cfn = example('vpc-minimal.instance');
    const types = Object.values(cfn.Resources).map(r => r.Type);
    expect(types).toContain('AWS::EC2::VPC');
    expect(types).toContain('AWS::EC2::Subnet');
    // Toggles off → no IGW, NAT, or VPN resources.
    expect(types).not.toContain('AWS::EC2::InternetGateway');
    expect(types).not.toContain('AWS::EC2::NatGateway');
    expect(types).not.toContain('AWS::EC2::VPNGateway');
    expect(Object.keys(cfn.Resources)).toHaveLength(8);
  });

  it('VPC and subnets carry their CIDR/DNS values (Value: lowering)', () => {
    const cfn = example('vpc-minimal.instance');
    const vpc = Object.values(cfn.Resources).find(r => r.Type === 'AWS::EC2::VPC');
    expect(vpc?.Properties).toMatchObject({
      CidrBlock: '10.0.0.0/16',
      EnableDnsHostnames: true,
      EnableDnsSupport: true,
      InstanceTenancy: 'default',
    });
    const subnets = Object.values(cfn.Resources).filter(r => r.Type === 'AWS::EC2::Subnet');
    expect(subnets.map(s => s.Properties?.CidrBlock).sort()).toEqual(['10.0.0.0/24', '10.0.1.0/24']);
    for (const s of subnets) expect(s.Properties?.VpcId).toEqual({ Ref: 'VPC' });
  });

  it('2-AZ + 1 NAT produces internet + NAT resources', () => {
    const cfn = example('vpc-2az-1nat.instance');
    const types = Object.values(cfn.Resources).map(r => r.Type);
    expect(types).toContain('AWS::EC2::InternetGateway');
    expect(types).toContain('AWS::EC2::NatGateway');
    expect(types).not.toContain('AWS::EC2::VPNGateway');
    expect(Object.keys(cfn.Resources)).toHaveLength(21);
  });

  it('3-AZ full VPC includes VPN + endpoints', () => {
    const cfn = example('vpc-3az.instance');
    const types = Object.values(cfn.Resources).map(r => r.Type);
    expect(types).toContain('AWS::EC2::VPNGateway');
    expect(types).toContain('AWS::EC2::VPCEndpoint');
    expect(types).toContain('AWS::EC2::NatGateway');
  });
});

describe('API Gateway examples (DSL, end-to-end)', () => {
  it('items-api generates the full resource set', () => {
    const cfn = example('apigw-items-api.instance');
    const types = Object.values(cfn.Resources).map(r => r.Type);
    expect(types).toContain('AWS::ApiGateway::RestApi');
    expect(types).toContain('AWS::ApiGateway::Resource');
    expect(types).toContain('AWS::ApiGateway::Method');
    expect(types).toContain('AWS::ApiGateway::Integration');
    expect(types).toContain('AWS::ApiGateway::Authorizer');
    expect(types).toContain('AWS::ApiGateway::Deployment');
    expect(types).toContain('AWS::ApiGateway::Stage');
  });

  it('RootResource: RestApiId via Ref, ParentId via GetAtt (SameAs)', () => {
    const cfn = example('apigw-items-api.instance');
    const root = Object.values(cfn.Resources).find(
      r => r.Type === 'AWS::ApiGateway::Resource' && r.Properties?.PathPart === 'items',
    );
    expect(root?.Properties?.RestApiId).toEqual({ Ref: 'RestApi' });
    expect(root?.Properties?.ParentId).toEqual({
      'Fn::GetAtt': ['RestApi', 'RootResourceId'],
    });
  });

  it('EndpointConfiguration nested Default renders as-is', () => {
    const cfn = example('apigw-items-api.instance');
    const api = Object.values(cfn.Resources).find(r => r.Type === 'AWS::ApiGateway::RestApi');
    expect(api?.Properties?.EndpointConfiguration).toEqual({ Types: ['REGIONAL'] });
  });

  it('all resources reference the same RestApi (path equations)', () => {
    const cfn = example('apigw-items-api.instance');
    const refs = new Set<string>();
    for (const r of Object.values(cfn.Resources)) {
      const id = r.Properties?.RestApiId;
      if (id) refs.add(JSON.stringify(id));
    }
    expect(refs.size).toBe(1);
  });

  it('!Sub intrinsic reaches the Integration Uri', () => {
    const cfn = example('apigw-items-api.instance');
    const integrations = Object.values(cfn.Resources).filter(
      r => r.Type === 'AWS::ApiGateway::Integration',
    );
    expect(integrations.length).toBeGreaterThan(0);
    for (const i of integrations) {
      expect(i.Properties?.Uri).toHaveProperty('Fn::Sub');
    }
  });

  it('explicit form (no macros) matches the resource shape', () => {
    const cfn = example('apigw-explicit.instance');
    const methods = Object.values(cfn.Resources).filter(r => r.Type === 'AWS::ApiGateway::Method');
    expect(methods).toHaveLength(4);
    const resources = Object.values(cfn.Resources).filter(r => r.Type === 'AWS::ApiGateway::Resource');
    expect(resources).toHaveLength(2); // /items + /items/{id}
  });
});
