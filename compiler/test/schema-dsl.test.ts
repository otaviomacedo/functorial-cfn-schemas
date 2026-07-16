import { parseSchemaFile, lowerSchemaFile } from '../src/schema-dsl';
import { parseSchema, parseTemplate, compile } from '../src';

describe('schema DSL parsing', () => {
  it('parses schemas, values, toggles, equations, and a map', () => {
    const src = `
      schema Ec2 {
        obj AWS::EC2::VPC {
          CidrBlock { Value: String }
        } alias VPC
        obj AWS::EC2::Subnet {
          VpcId     { Source: VPC }
          CidrBlock { Value: String }
        } alias Subnet
        toggle IgwToggle
      }
      schema Net {
        obj Functorial::Net {
          Cidr { Value: String }
        } alias Net
        toggle IgwToggle
      }
      map Net -> Ec2 {
        Net -> Subnet
        Net.Cidr -> Subnet.CidrBlock
      }
    `;
    const file = parseSchemaFile(src);
    expect(file.schemas).toHaveLength(2);
    expect(file.maps).toHaveLength(1);
    expect(file.maps[0]).toMatchObject({ from: 'Net', to: 'Ec2' });

    const ec2 = file.schemas.find(s => s.name === 'Ec2')!;
    expect(ec2.objects.map(o => o.alias)).toEqual(['VPC', 'Subnet']);
    expect(ec2.toggles).toEqual(['IgwToggle']);
  });

  it('parses an "expected fullness" declaration in the map block', () => {
    const src = `
      schema C {
        obj AWS::Thing { Ref { Source: Other } } alias Thing
        obj AWS::Other { Tog { Source: Toggle } } alias Other
        toggle Toggle
      }
      schema D {
        obj T::Root {} alias Root
      }
      map D -> C {
        Root -> Thing
        expected fullness Thing.Ref * Other.Tog
          because "auto-created cascade"
      }
    `;
    const file = parseSchemaFile(src);
    expect(file.maps[0].expectedFullness).toEqual([
      { path: ['Thing.Ref', 'Other.Tog'], reason: 'auto-created cascade' },
    ]);

    // Reason is optional.
    const noReason = parseSchemaFile(src.replace(/\s+because "[^"]*"/, ''));
    expect(noReason.maps[0].expectedFullness).toEqual([
      { path: ['Thing.Ref', 'Other.Tog'], reason: undefined },
    ]);

    // It survives lowering onto the raw schema.
    const { raw } = lowerSchemaFile(file);
    expect(raw.ExpectedFullness).toEqual([
      { path: ['Thing.Ref', 'Other.Tog'], reason: 'auto-created cascade' },
    ]);
  });

  it('parses comments and structure blocks', () => {
    const src = `
      // line comment
      schema C {
        /* block comment */
        obj AWS::Thing {
          Ref { Source: Other }
          structure {
            Toggle { Source: Tog }
          }
        } alias Thing
        obj AWS::Other {} alias Other
        toggle Tog
      }
      schema D {
        obj T::D { Link { Source: Other } } alias Root
        obj T::Other {} alias Other
        toggle Tog
      }
      map D -> C {
        Root -> Thing
        Other -> Other
      }
    `;
    const file = parseSchemaFile(src);
    const c = file.schemas.find(s => s.name === 'C')!;
    const thing = c.objects.find(o => o.alias === 'Thing')!;
    expect(thing.structure).toHaveLength(1);
    expect(thing.structure[0]).toMatchObject({ name: 'Toggle', source: 'Tog' });
  });
});

describe('schema DSL lowering → raw shape', () => {
  it('lowers Value properties to value objects + Source references', () => {
    const src = `
      schema C {
        obj AWS::EC2::VPC { CidrBlock { Value: String } } alias VPC
      }
      schema D {
        obj T::Net { CidrBlock { Value: String } } alias Net
      }
      map D -> C { Net -> VPC }
    `;
    const { raw, hasImport } = lowerSchemaFile(parseSchemaFile(src));
    expect(hasImport).toBe(false);

    // C-side: VPC is a CfnType, CidrBlock became a value object.
    expect(raw.OriginalSchema.Objects.VPC).toEqual({
      CfnType: 'AWS::EC2::VPC',
      Properties: { CidrBlock: { Source: 'CidrBlock' } },
    });
    expect(raw.OriginalSchema.Objects.CidrBlock).toEqual({ ValueType: 'String' });

    // Functor object map auto-completes the same-named value object.
    expect(raw.SimplifiedSchema.Functor.Objects).toMatchObject({
      Net: 'VPC',
      CidrBlock: 'CidrBlock',
    });
    // Value morphism inferred by same-name.
    expect(raw.SimplifiedSchema.Functor.Morphisms['Net.CidrBlock']).toBe('VPC.CidrBlock');
  });

  it('lowers SameAs to a shared morphism reference with distinct Via', () => {
    const src = `
      schema C {
        obj AWS::ApiGateway::Resource {
          RestApiId { Source: Api, Via: Ref }
          ParentId  { SameAs: RestApiId, Via: GetAtt.RootResourceId }
          PathPart  { Value: String }
        } alias RootResource
        obj AWS::ApiGateway::RestApi {} alias Api
      }
      schema D {
        obj T::Route { Path { Value: String } Api { Source: Api } } alias Route
        obj T::Api {} alias Api
      }
      map D -> C {
        Route -> RootResource
        Api -> Api
        Route.Api -> RootResource.RestApiId
      }
    `;
    const { raw } = lowerSchemaFile(parseSchemaFile(src));
    const root = raw.OriginalSchema.Objects.RootResource;
    expect(root.Properties.RestApiId).toEqual({ Source: 'Api', Via: 'Ref' });
    // SameAs points at the sibling's inferred morphism name, keeps its own Via.
    expect(root.Properties.ParentId).toEqual({
      Source: 'RootResource.RestApiId',
      Via: 'GetAtt.RootResourceId',
    });
  });

  it('lowers composite * paths in the map to " . " paths', () => {
    const src = `
      schema C {
        obj AWS::Method {
          structure { Integration { Source: Integration } }
        } alias Method
        obj AWS::Integration { Type { Value: String } } alias Integration
      }
      schema D {
        obj T::M { IntegrationType { Value: String } } alias M
      }
      map D -> C {
        M -> Method
        M.IntegrationType -> Method.Integration * Integration.Type
      }
    `;
    const { raw } = lowerSchemaFile(parseSchemaFile(src));
    expect(raw.SimplifiedSchema.Functor.Morphisms['M.IntegrationType']).toBe(
      'Method.Integration . Integration.Type',
    );
  });

  it('lowered schema compiles end-to-end via parseSchema', () => {
    // Mirrors the real VPC pattern: distinct resources own the VPC and subnet
    // CIDRs, and the subnet references the network.
    const src = `
      schema C {
        obj AWS::EC2::VPC { CidrBlock { Value: String } } alias VPC
        obj AWS::EC2::Subnet {
          VpcId     { Source: VPC }
          CidrBlock { Value: String }
        } alias Subnet
      }
      schema D {
        obj T::Net  { CidrBlock { Value: String } } alias Net
        obj T::Tier {
          CidrBlock { Value: String }
          Net       { Source: Net }
        } alias Tier
      }
      map D -> C {
        Net  -> VPC
        Tier -> Subnet
        Tier.Net -> Subnet.VpcId
      }
    `;
    const { raw } = lowerSchemaFile(parseSchemaFile(src));
    const schema = parseSchema(raw);
    const template = parseTemplate({
      Schema: './x',
      Resources: {
        MyNet: { Type: 'T::Net', Properties: { CidrBlock: '10.0.0.0/16' } },
        MyTier: { Type: 'T::Tier', Properties: { CidrBlock: '10.0.1.0/24', Net: 'MyNet' } },
      },
    });
    const cfn = compile(schema, template);
    const vpc = Object.values(cfn.Resources).find(r => r.Type === 'AWS::EC2::VPC');
    const subnet = Object.values(cfn.Resources).find(r => r.Type === 'AWS::EC2::Subnet');
    expect(vpc?.Properties?.CidrBlock).toBe('10.0.0.0/16');
    expect(subnet?.Properties?.CidrBlock).toBe('10.0.1.0/24');
    expect(subnet?.Properties?.VpcId).toEqual({ Ref: 'VPC' });
  });
});
