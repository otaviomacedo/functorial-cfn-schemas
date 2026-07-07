import { parseInstanceFile, lowerInstanceFile } from '../src/instance-dsl';
import { parseTemplate } from '../src';

describe('instance DSL', () => {
  it('parses schema path, resources, and toggles', () => {
    const src = `
      instance of "./vpc.schema"

      toggle IgwToggle = false
      toggle VpnToggle = true

      res MyVpc: Functorial::VPC::Network = {
        CidrBlock: "10.0.0.0/16"
        DnsHostnames: true
        Tenancy: "default"
      }

      res Sub: Functorial::VPC::PublicTier = {
        AvailabilityZone: "us-east-1a"
        Network: MyVpc
      }
    `;
    const file = parseInstanceFile(src);
    expect(file.schemaPath).toBe('./vpc.schema');
    expect(file.resources).toHaveLength(2);
    expect(file.toggles).toEqual([
      { name: 'IgwToggle', value: false },
      { name: 'VpnToggle', value: true },
    ]);
    expect(file.resources[0]).toMatchObject({
      logicalId: 'MyVpc',
      type: 'Functorial::VPC::Network',
      properties: { CidrBlock: '10.0.0.0/16', DnsHostnames: true, Tenancy: 'default' },
    });
    // A bareword value is preserved (used to reference other resources).
    expect(file.resources[1].properties.Network).toBe('MyVpc');
  });

  it('lowers to the raw shape consumed by parseTemplate', () => {
    const src = `
      instance of "./s.schema"
      toggle T = false
      res R: My::Type = { A: "x", N: 3 }
    `;
    const raw = lowerInstanceFile(parseInstanceFile(src));
    expect(raw).toEqual({
      Schema: './s.schema',
      Resources: { R: { Type: 'My::Type', Properties: { A: 'x', N: 3 } } },
      Toggles: { T: false },
    });

    const template = parseTemplate(raw);
    expect(template.schemaPath).toBe('./s.schema');
    expect(template.resources[0]).toMatchObject({ logicalId: 'R', type: 'My::Type' });
    expect(template.toggles.T).toBe(false);
  });

  it('parses arrays and nested objects (for macros)', () => {
    const src = `
      instance of "./s.schema"
      res Route: T::Route = {
        Path: "items"
        Methods: [
          { HttpMethod: "GET", Auth: "NONE" },
          { HttpMethod: "POST", Auth: "IAM" }
        ]
      }
    `;
    const file = parseInstanceFile(src);
    expect(file.resources[0].properties.Methods).toEqual([
      { HttpMethod: 'GET', Auth: 'NONE' },
      { HttpMethod: 'POST', Auth: 'IAM' },
    ]);
  });

  it('parses CloudFormation intrinsics', () => {
    const src = `
      instance of "./s.schema"
      res R: T = {
        A: !Ref SomeResource
        B: !GetAtt Fn.Arn
        C: !GetAtt Res.Outputs.Value
        D: !Sub "arn:\${AWS::Region}:x"
      }
    `;
    const props = parseInstanceFile(src).resources[0].properties;
    expect(props.A).toEqual({ Ref: 'SomeResource' });
    expect(props.B).toEqual({ 'Fn::GetAtt': ['Fn', 'Arn'] });
    expect(props.C).toEqual({ 'Fn::GetAtt': ['Res', 'Outputs.Value'] });
    expect(props.D).toEqual({ 'Fn::Sub': 'arn:${AWS::Region}:x' });
  });

  it('omits Toggles when none are declared', () => {
    const raw = lowerInstanceFile(parseInstanceFile(`instance of "./s" res R: T = { A: "x" }`));
    expect(raw.Toggles).toBeUndefined();
  });
});
