/**
 * RENDER-layer tests for optional references and sum-typed fields.
 *
 * The user authors an optional/sum field exactly like a plain reference
 * (`Target: MyNat`, `Authorizer: LambdaAuth`). The compiler mints apex elements,
 * the Kan extension propagates them, and rendering emits the erased field on the
 * consumer resource as `field: Ref/GetAtt(producer)` — but ONLY where the user
 * set it. These tests compile all the way to CloudFormation and inspect output.
 */

import {
  parseSchemaFile,
  lowerSchemaFile,
  parseSchema,
  parseInstanceFile,
  lowerInstanceFile,
  parseTemplate,
  compile,
} from '../src';

function compileSrc(schemaSrc: string, instanceSrc: string) {
  const { raw } = lowerSchemaFile(parseSchemaFile(schemaSrc));
  const schema = parseSchema(raw);
  const template = parseTemplate(lowerInstanceFile(parseInstanceFile(instanceSrc)));
  const diagnostics: string[] = [];
  const cfn = compile(schema, template, { onDiagnostic: m => diagnostics.push(m) });
  return { cfn, diagnostics };
}

// A route table whose route optionally targets one of two gateway kinds (a sum).
const SUM_SCHEMA = `
  schema Ec2 {
    type AWS::EC2::NatGateway { Name { Value: String } } alias CfnNat
    type AWS::EC2::InternetGateway { Name { Value: String } } alias CfnIgw
    type AWS::EC2::Route {
      Name { Value: String }
      NatGatewayId? { Source: CfnNat, Via: Ref }
      GatewayId?    { Source: CfnIgw, Via: Ref }
    } alias CfnRoute
  }
  schema R {
    type F::Nat { Name { Value: String } } alias Nat
    type F::Igw { Name { Value: String } } alias Igw
    data Target = Nat | Igw
    type F::Route {
      Name { Value: String }
      Target? { Source: Target }
    } alias Route
  }
  map R -> Ec2 {
    Nat -> CfnNat
    Igw -> CfnIgw
    Route -> CfnRoute
  }
`;

describe('render: sum-typed optional field', () => {
  test('field appears only where set, with the right Ref and variant', () => {
    const instance = `
      instance of "./x.schema"
      res MyNat: F::Nat = { Name: "nat" }
      res MyIgw: F::Igw = { Name: "igw" }
      res RNat: F::Route = { Name: "r-nat", Target: MyNat }
      res RIgw: F::Route = { Name: "r-igw", Target: MyIgw }
      res RNone: F::Route = { Name: "r-none" }
    `;
    const { cfn } = compileSrc(SUM_SCHEMA, instance);
    const routes = Object.values(cfn.Resources).filter(r => r.Type === 'AWS::EC2::Route');
    expect(routes).toHaveLength(3);

    const byName = (n: string) =>
      routes.find(r => r.Properties?.Name === n)!;

    // RNat targets a NAT gateway → NatGatewayId Ref, no GatewayId.
    const rNat = byName('r-nat');
    expect(rNat.Properties!.NatGatewayId).toBeDefined();
    expect(rNat.Properties!.GatewayId).toBeUndefined();
    // The Ref points at the NAT resource's logical id.
    const natId = Object.entries(cfn.Resources).find(
      ([, r]) => r.Type === 'AWS::EC2::NatGateway',
    )![0];
    expect(rNat.Properties!.NatGatewayId).toEqual({ Ref: natId });

    // RIgw targets an internet gateway → GatewayId, no NatGatewayId.
    const rIgw = byName('r-igw');
    expect(rIgw.Properties!.GatewayId).toBeDefined();
    expect(rIgw.Properties!.NatGatewayId).toBeUndefined();

    // RNone set no target → neither field present (optionality in the output).
    const rNone = byName('r-none');
    expect(rNone.Properties!.NatGatewayId).toBeUndefined();
    expect(rNone.Properties!.GatewayId).toBeUndefined();
  });

  test('a shared target is referenced by multiple consumers (n:1, no ownership)', () => {
    const instance = `
      instance of "./x.schema"
      res Shared: F::Nat = { Name: "shared" }
      res R1: F::Route = { Name: "r1", Target: Shared }
      res R2: F::Route = { Name: "r2", Target: Shared }
    `;
    const { cfn } = compileSrc(SUM_SCHEMA, instance);
    const nats = Object.entries(cfn.Resources).filter(([, r]) => r.Type === 'AWS::EC2::NatGateway');
    expect(nats).toHaveLength(1); // one shared NAT, not duplicated per consumer
    const natId = nats[0][0];

    const routes = Object.values(cfn.Resources).filter(r => r.Type === 'AWS::EC2::Route');
    for (const r of routes) {
      expect(r.Properties!.NatGatewayId).toEqual({ Ref: natId });
    }
  });
});

// The Authorizer's exact shape: a SHARED optional SINGLE reference (many methods,
// one authorizer, no ownership) — the case the apigw PublicMethod/AuthorizedMethod
// split exists to model. Here it is a single unified Method with `Authorizer?`.
const AUTH_SCHEMA = `
  schema ApiGw {
    type AWS::ApiGateway::Authorizer { Name { Value: String } } alias CfnAuth
    type AWS::ApiGateway::Method {
      HttpMethod    { Value: String }
      AuthorizerId? { Source: CfnAuth, Via: Ref }
    } alias CfnMethod
  }
  schema Api {
    type F::Authorizer { Name { Value: String } } alias Authorizer
    type F::Method {
      HttpMethod  { Value: String }
      Authorizer? { Source: Authorizer }
    } alias Method
  }
  map Api -> ApiGw {
    Authorizer -> CfnAuth
    Method     -> CfnMethod
  }
`;

describe('render: shared optional single reference (the unified authorizer)', () => {
  test('one authorizer shared by authorized methods; public method has none', () => {
    const instance = `
      instance of "./x.schema"
      res Auth: F::Authorizer = { Name: "lambda-auth" }
      res ListItems:  F::Method = { HttpMethod: "GET" }
      res CreateItem: F::Method = { HttpMethod: "POST", Authorizer: Auth }
      res DeleteItem: F::Method = { HttpMethod: "DELETE", Authorizer: Auth }
    `;
    const { cfn } = compileSrc(AUTH_SCHEMA, instance);

    const auths = Object.entries(cfn.Resources).filter(
      ([, r]) => r.Type === 'AWS::ApiGateway::Authorizer',
    );
    expect(auths).toHaveLength(1); // single shared authorizer
    const authId = auths[0][0];

    const methods = Object.values(cfn.Resources).filter(
      r => r.Type === 'AWS::ApiGateway::Method',
    );
    const byVerb = (v: string) => methods.find(m => m.Properties?.HttpMethod === v)!;

    // Public GET: no AuthorizerId (optionality realized).
    expect(byVerb('GET').Properties!.AuthorizerId).toBeUndefined();
    // Authorized POST/DELETE: both Ref the same shared authorizer.
    expect(byVerb('POST').Properties!.AuthorizerId).toEqual({ Ref: authId });
    expect(byVerb('DELETE').Properties!.AuthorizerId).toEqual({ Ref: authId });
  });
});