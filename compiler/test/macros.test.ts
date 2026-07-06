import { parseSchema, parseTemplate, compile } from '../src';
import { applyMacros, parseMacros } from '../src/macros';

describe('Macro preprocessor', () => {
  describe('parseMacros', () => {
    it('parses array expansion macro', () => {
      const raw = {
        'Functorial::APIGW::Route.Methods': {
          ExpandsTo: 'Functorial::APIGW::Method',
          ElementProperty: 'HttpMethod',
          BackRef: 'Route',
        },
      };

      const macros = parseMacros(raw, ['Functorial::APIGW::Route']);

      expect(macros.declarations).toHaveLength(1);
      expect(macros.declarations[0]).toEqual({
        resourceType: 'Functorial::APIGW::Route',
        property: 'Methods',
        rule: {
          kind: 'array',
          targetType: 'Functorial::APIGW::Method',
          elementProperty: 'HttpMethod',
          backRef: 'Route',
          forward: undefined,
        },
      });
    });

    it('parses toggle macro', () => {
      const raw = {
        'Functorial::VPC::Network.InternetAccess': {
          Toggle: 'GatewayToggle',
        },
      };

      const macros = parseMacros(raw, ['Functorial::VPC::Network']);

      expect(macros.declarations).toHaveLength(1);
      expect(macros.declarations[0]).toEqual({
        resourceType: 'Functorial::VPC::Network',
        property: 'InternetAccess',
        rule: {
          kind: 'toggle',
          toggleName: 'GatewayToggle',
        },
      });
    });

    it('rejects macro for unknown resource type', () => {
      const raw = {
        'Functorial::Unknown.Prop': { Toggle: 'X' },
      };

      expect(() => parseMacros(raw, ['Functorial::Net'])).toThrow(/unknown resource type/);
    });

    it('parses forward property list', () => {
      const raw = {
        'Functorial::APIGW::Route.Methods': {
          ExpandsTo: 'Functorial::APIGW::Method',
          ElementProperty: 'HttpMethod',
          BackRef: 'Route',
          Forward: ['Function', 'Api'],
        },
      };

      const macros = parseMacros(raw, ['Functorial::APIGW::Route']);
      const rule = macros.declarations[0].rule as any;
      expect(rule.forward).toEqual(['Function', 'Api']);
    });
  });

  describe('applyMacros: array expansion', () => {
    const macros = parseMacros(
      {
        'Functorial::APIGW::Route.Methods': {
          ExpandsTo: 'Functorial::APIGW::Method',
          ElementProperty: 'HttpMethod',
          BackRef: 'Route',
        },
      },
      ['Functorial::APIGW::Route'],
    );

    it('expands an array into sibling resources', () => {
      const template = {
        schemaPath: './test.yaml',
        resources: [
          {
            logicalId: 'ItemsRoute',
            type: 'Functorial::APIGW::Route',
            properties: {
              Path: '/items',
              Methods: ['GET', 'POST'],
            },
          },
        ],
        toggles: {},
      };

      const result = applyMacros(macros, template);

      expect(result.resources).toHaveLength(3);

      const methods = result.resources.filter(r => r.type === 'Functorial::APIGW::Method');
      expect(methods).toHaveLength(2);

      expect(methods[0].properties.HttpMethod).toBe('GET');
      expect(methods[0].properties.Route).toBe('ItemsRoute');
      expect(methods[0].logicalId).toBe('ItemsRouteGET');

      expect(methods[1].properties.HttpMethod).toBe('POST');
      expect(methods[1].properties.Route).toBe('ItemsRoute');
      expect(methods[1].logicalId).toBe('ItemsRoutePOST');
    });

    it('removes the macro property from the parent resource', () => {
      const template = {
        schemaPath: './test.yaml',
        resources: [
          {
            logicalId: 'ItemsRoute',
            type: 'Functorial::APIGW::Route',
            properties: {
              Path: '/items',
              Methods: ['GET'],
            },
          },
        ],
        toggles: {},
      };

      const result = applyMacros(macros, template);

      const route = result.resources.find(r => r.type === 'Functorial::APIGW::Route');
      expect(route).toBeDefined();
      expect(route!.properties.Path).toBe('/items');
      expect(route!.properties.Methods).toBeUndefined();
    });

    it('leaves resources without the macro property untouched', () => {
      const template = {
        schemaPath: './test.yaml',
        resources: [
          {
            logicalId: 'ItemsRoute',
            type: 'Functorial::APIGW::Route',
            properties: {
              Path: '/items',
            },
          },
        ],
        toggles: {},
      };

      const result = applyMacros(macros, template);
      expect(result.resources).toHaveLength(1);
      expect(result.resources[0].logicalId).toBe('ItemsRoute');
    });
  });

  describe('applyMacros: array expansion with forwarding', () => {
    const macros = parseMacros(
      {
        'Functorial::APIGW::Route.Methods': {
          ExpandsTo: 'Functorial::APIGW::Method',
          ElementProperty: 'HttpMethod',
          BackRef: 'Route',
          Forward: ['Function'],
        },
      },
      ['Functorial::APIGW::Route'],
    );

    it('forwards specified properties to children', () => {
      const template = {
        schemaPath: './test.yaml',
        resources: [
          {
            logicalId: 'ItemsRoute',
            type: 'Functorial::APIGW::Route',
            properties: {
              Path: '/items',
              Methods: ['GET', 'POST'],
              Function: 'ItemHandler',
            },
          },
        ],
        toggles: {},
      };

      const result = applyMacros(macros, template);

      const methods = result.resources.filter(r => r.type === 'Functorial::APIGW::Method');
      expect(methods[0].properties.Function).toBe('ItemHandler');
      expect(methods[1].properties.Function).toBe('ItemHandler');
    });
  });

  describe('applyMacros: toggle expansion', () => {
    const macros = parseMacros(
      {
        'Functorial::VPC::Network.InternetAccess': {
          Toggle: 'GatewayToggle',
        },
      },
      ['Functorial::VPC::Network'],
    );

    it('expands a boolean into a toggle', () => {
      const template = {
        schemaPath: './test.yaml',
        resources: [
          {
            logicalId: 'MyVpc',
            type: 'Functorial::VPC::Network',
            properties: {
              CidrBlock: '10.0.0.0/16',
              InternetAccess: true,
            },
          },
        ],
        toggles: {},
      };

      const result = applyMacros(macros, template);

      expect(result.toggles.GatewayToggle).toBe(true);
      const vpc = result.resources.find(r => r.type === 'Functorial::VPC::Network');
      expect(vpc!.properties.InternetAccess).toBeUndefined();
      expect(vpc!.properties.CidrBlock).toBe('10.0.0.0/16');
    });

    it('expands false into toggle off', () => {
      const template = {
        schemaPath: './test.yaml',
        resources: [
          {
            logicalId: 'MyVpc',
            type: 'Functorial::VPC::Network',
            properties: {
              CidrBlock: '10.0.0.0/16',
              InternetAccess: false,
            },
          },
        ],
        toggles: {},
      };

      const result = applyMacros(macros, template);

      expect(result.toggles.GatewayToggle).toBe(false);
    });
  });

  describe('applyMacros: array of objects', () => {
    const macros = parseMacros(
      {
        'Functorial::APIGW::Route.Methods': {
          ExpandsTo: 'Functorial::APIGW::Method',
          ElementProperty: 'HttpMethod',
          BackRef: 'Route',
        },
      },
      ['Functorial::APIGW::Route'],
    );

    it('expands objects with multiple properties', () => {
      const template = {
        schemaPath: './test.yaml',
        resources: [
          {
            logicalId: 'ItemsRoute',
            type: 'Functorial::APIGW::Route',
            properties: {
              Path: '/items',
              Methods: [
                { HttpMethod: 'GET', Auth: 'IAM' },
                { HttpMethod: 'POST', Auth: 'NONE' },
              ],
            },
          },
        ],
        toggles: {},
      };

      const result = applyMacros(macros, template);

      const methods = result.resources.filter(r => r.type === 'Functorial::APIGW::Method');
      expect(methods).toHaveLength(2);

      expect(methods[0].properties.HttpMethod).toBe('GET');
      expect(methods[0].properties.Auth).toBe('IAM');
      expect(methods[0].properties.Route).toBe('ItemsRoute');
      expect(methods[0].logicalId).toBe('ItemsRouteGET');

      expect(methods[1].properties.HttpMethod).toBe('POST');
      expect(methods[1].properties.Auth).toBe('NONE');
      expect(methods[1].properties.Route).toBe('ItemsRoute');
      expect(methods[1].logicalId).toBe('ItemsRoutePOST');
    });
  });
});

describe('End-to-end: macros + Kan extension', () => {
  // API Gateway schema where:
  // - D has Route and Method as separate objects
  // - A macro on D's user surface lets the user write Methods inline on Route
  // - G: D → C maps to RestApi, Resource, and Method in C
  const apiGwSchemaWithMacro = {
    OriginalSchema: {
      Objects: {
        RestApi: {
          CfnType: 'AWS::ApiGateway::RestApi',
          Properties: {
            Name: { Default: 'my-api' },
          },
        },
        Resource: {
          CfnType: 'AWS::ApiGateway::Resource',
          Properties: {
            RestApiId: { Source: 'resource_api', Via: 'Ref' },
            PathPart: { Source: 'resource_path' },
          },
        },
        Method: {
          CfnType: 'AWS::ApiGateway::Method',
          Properties: {
            RestApiId: { Source: 'method_api' },
            ResourceId: { Source: 'method_resource', Via: 'GetAtt.ResourceId' },
            HttpMethod: { Source: 'method_verb' },
          },
        },
        PathPart: { ValueType: 'String' },
        HttpVerb: { ValueType: 'String' },
      },
      Morphisms: {
        resource_api: 'Resource -> RestApi',
        resource_path: 'Resource -> PathPart',
        method_api: 'Method -> RestApi',
        method_resource: 'Method -> Resource',
        method_verb: 'Method -> HttpVerb',
      },
    },
    SimplifiedSchema: {
      Objects: {
        Route: {
          Type: 'Functorial::APIGW::Route',
          Properties: {
            Path: { Source: 'route_path' },
          },
        },
        Endpoint: {
          Type: 'Functorial::APIGW::Method',
          Properties: {
            HttpMethod: { Source: 'endpoint_verb' },
            Route: { Source: 'endpoint_route' },
          },
        },
        PathPart: { ValueType: 'String' },
        HttpVerb: { ValueType: 'String' },
      },
      Morphisms: {
        route_path: 'Route -> PathPart',
        endpoint_verb: 'Endpoint -> HttpVerb',
        endpoint_route: 'Endpoint -> Route',
      },
      Functor: {
        Objects: {
          Route: 'Resource',
          Endpoint: 'Method',
          PathPart: 'PathPart',
          HttpVerb: 'HttpVerb',
        },
        Morphisms: {
          route_path: 'resource_path',
          endpoint_verb: 'method_verb',
          endpoint_route: 'method_resource',
        },
      },
      Macros: {
        'Functorial::APIGW::Route.Methods': {
          ExpandsTo: 'Functorial::APIGW::Method',
          ElementProperty: 'HttpMethod',
          BackRef: 'Route',
        },
      },
    },
  };

  it('user writes inline Methods, gets correct CFN output', () => {
    const schema = parseSchema(apiGwSchemaWithMacro);
    const template = parseTemplate({
      Schema: './test.yaml',
      Resources: {
        ItemsRoute: {
          Type: 'Functorial::APIGW::Route',
          Properties: {
            Path: '/items',
            Methods: ['GET', 'POST'],
          },
        },
      },
    });

    const cfn = compile(schema, template);

    const types = Object.values(cfn.Resources).map(r => r.Type);
    expect(types).toContain('AWS::ApiGateway::RestApi');
    expect(types).toContain('AWS::ApiGateway::Resource');
    expect(types).toContain('AWS::ApiGateway::Method');

    // Two methods generated
    const methods = Object.entries(cfn.Resources).filter(
      ([_, r]) => r.Type === 'AWS::ApiGateway::Method'
    );
    expect(methods).toHaveLength(2);

    const verbs = methods.map(([_, r]) => r.Properties?.HttpMethod).sort();
    expect(verbs).toEqual(['GET', 'POST']);

    // Both methods reference the same Resource
    for (const [_, method] of methods) {
      expect(method.Properties?.ResourceId).toEqual({
        'Fn::GetAtt': ['Resource', 'ResourceId'],
      });
    }
  });

  it('user can also write without macro (explicit Method resources)', () => {
    const schema = parseSchema(apiGwSchemaWithMacro);
    const template = parseTemplate({
      Schema: './test.yaml',
      Resources: {
        ItemsRoute: {
          Type: 'Functorial::APIGW::Route',
          Properties: {
            Path: '/items',
          },
        },
        GetItems: {
          Type: 'Functorial::APIGW::Method',
          Properties: {
            HttpMethod: 'GET',
            Route: 'ItemsRoute',
          },
        },
      },
    });

    const cfn = compile(schema, template);

    const methods = Object.entries(cfn.Resources).filter(
      ([_, r]) => r.Type === 'AWS::ApiGateway::Method'
    );
    expect(methods).toHaveLength(1);
    expect(methods[0][1].Properties?.HttpMethod).toBe('GET');
  });
});