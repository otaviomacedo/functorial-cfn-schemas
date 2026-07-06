import { parseSchema, parseTemplate, compile } from '../src';

// Schema design notes:
//
// In C (CloudFormation), Stage → RestApi and Stage → Deployment → RestApi.
// The user can't collapse Stage into Api in D because there's no path from
// RestApi to StageName in C — the morphism goes the other way. So Stage is
// a separate object in D. This is functoriality enforcing correctness: Stage
// is a real resource the user must acknowledge. Deployment + Stage are still
// auto-created by the Kan extension as defaults (singleton) if the toggle is on.

const apigwSchema = {
  OriginalSchema: {
    Objects: {
      RestApi: {
        CfnType: 'AWS::ApiGateway::RestApi',
        Properties: {
          Name: { Source: 'api_name' },
          Description: { Source: 'api_description' },
          EndpointConfiguration: { Default: { Types: ['REGIONAL'] } },
        },
      },
      Resource: {
        CfnType: 'AWS::ApiGateway::Resource',
        Properties: {
          RestApiId: { Source: 'resource_api' },
          ParentId: { Source: 'resource_api', Via: 'GetAtt.RootResourceId' },
          PathPart: { Source: 'resource_path' },
        },
      },
      Method: {
        CfnType: 'AWS::ApiGateway::Method',
        Properties: {
          RestApiId: { Source: 'method_api' },
          ResourceId: { Source: 'method_resource' },
          HttpMethod: { Source: 'method_verb' },
          AuthorizationType: { Source: 'method_auth' },
        },
      },
      Integration: {
        CfnType: 'AWS::ApiGateway::Integration',
        Properties: {
          Type: { Source: 'integration_type' },
          IntegrationHttpMethod: { Default: 'POST' },
          Uri: { Source: 'integration_uri' },
        },
      },
      Deployment: {
        CfnType: 'AWS::ApiGateway::Deployment',
        Properties: {
          RestApiId: { Source: 'deployment_api' },
        },
      },
      Stage: {
        CfnType: 'AWS::ApiGateway::Stage',
        Properties: {
          RestApiId: { Source: 'stage_api' },
          DeploymentId: { Source: 'stage_deployment' },
          StageName: { Source: 'stage_name' },
        },
      },
      ApiName: { ValueType: 'String' },
      ApiDescription: { ValueType: 'String' },
      PathPart: { ValueType: 'String' },
      HttpVerb: { ValueType: 'String' },
      AuthType: { ValueType: 'String' },
      IntegrationType: { ValueType: 'String' },
      IntegrationUri: { ValueType: 'String' },
      StageName: { ValueType: 'String' },
      DeployToggle: { ValueType: 'Toggle' },
    },
    Morphisms: {
      api_name: 'RestApi -> ApiName',
      api_description: 'RestApi -> ApiDescription',
      resource_api: 'Resource -> RestApi',
      resource_path: 'Resource -> PathPart',
      method_api: 'Method -> RestApi',
      method_resource: 'Method -> Resource',
      method_verb: 'Method -> HttpVerb',
      method_auth: 'Method -> AuthType',
      method_integration: 'Method -> Integration',
      integration_type: 'Integration -> IntegrationType',
      integration_uri: 'Integration -> IntegrationUri',
      deployment_api: 'Deployment -> RestApi',
      deployment_toggle: 'Deployment -> DeployToggle',
      stage_api: 'Stage -> RestApi',
      stage_deployment: 'Stage -> Deployment',
      stage_name: 'Stage -> StageName',
    },
    Equations: [
      'method_api = method_resource . resource_api',
      'stage_api = stage_deployment . deployment_api',
    ],
  },
  SimplifiedSchema: {
    Objects: {
      Api: {
        Type: 'Functorial::APIGW::Api',
        Properties: {
          Name: { Source: 'api_name' },
          Description: { Source: 'api_description' },
        },
      },
      Route: {
        Type: 'Functorial::APIGW::Route',
        Properties: {
          Path: { Source: 'route_path' },
          Api: { Source: 'route_api' },
        },
      },
      Method: {
        Type: 'Functorial::APIGW::Method',
        Properties: {
          HttpMethod: { Source: 'method_verb' },
          Auth: { Source: 'method_auth' },
          Route: { Source: 'method_route' },
          IntegrationType: { Source: 'method_inttype' },
          IntegrationUri: { Source: 'method_inturi' },
        },
      },
      Stage: {
        Type: 'Functorial::APIGW::Stage',
        Properties: {
          StageName: { Source: 'stage_name' },
          Api: { Source: 'stage_api' },
        },
      },
      ApiName: { ValueType: 'String' },
      ApiDescription: { ValueType: 'String' },
      PathPart: { ValueType: 'String' },
      HttpVerb: { ValueType: 'String' },
      AuthType: { ValueType: 'String' },
      IntegrationType: { ValueType: 'String' },
      IntegrationUri: { ValueType: 'String' },
      StageName: { ValueType: 'String' },
      DeployToggle: { ValueType: 'Toggle' },
    },
    Morphisms: {
      api_name: 'Api -> ApiName',
      api_description: 'Api -> ApiDescription',
      route_path: 'Route -> PathPart',
      route_api: 'Route -> Api',
      method_verb: 'Method -> HttpVerb',
      method_auth: 'Method -> AuthType',
      method_route: 'Method -> Route',
      method_inttype: 'Method -> IntegrationType',
      method_inturi: 'Method -> IntegrationUri',
      stage_name: 'Stage -> StageName',
      stage_api: 'Stage -> Api',
    },
    Functor: {
      Objects: {
        Api: 'RestApi',
        Route: 'Resource',
        Method: 'Method',
        Stage: 'Stage',
        ApiName: 'ApiName',
        ApiDescription: 'ApiDescription',
        PathPart: 'PathPart',
        HttpVerb: 'HttpVerb',
        AuthType: 'AuthType',
        IntegrationType: 'IntegrationType',
        IntegrationUri: 'IntegrationUri',
        StageName: 'StageName',
        DeployToggle: 'DeployToggle',
      },
      Morphisms: {
        api_name: 'api_name',
        api_description: 'api_description',
        route_path: 'resource_path',
        route_api: 'resource_api',
        method_verb: 'method_verb',
        method_auth: 'method_auth',
        method_route: 'method_resource',
        method_inttype: 'method_integration . integration_type',
        method_inturi: 'method_integration . integration_uri',
        stage_name: 'stage_name',
        stage_api: 'stage_api',
      },
    },
    Macros: {
      'Functorial::APIGW::Route.Methods': {
        ExpandsTo: 'Functorial::APIGW::Method',
        ElementProperty: 'HttpMethod',
        BackRef: 'Route',
        Forward: ['IntegrationUri'],
      },
    },
  },
};

describe('API Gateway schema', () => {
  it('generates all resource types from a single Route with one Method', () => {
    const schema = parseSchema(apigwSchema);
    const template = parseTemplate({
      Schema: './apigw.schema.yaml',
      Resources: {
        MyApi: {
          Type: 'Functorial::APIGW::Api',
          Properties: {
            Name: 'test-api',
            Description: 'A test API',
          },
        },
        Prod: {
          Type: 'Functorial::APIGW::Stage',
          Properties: {
            StageName: 'prod',
            Api: 'MyApi',
          },
        },
        BooksRoute: {
          Type: 'Functorial::APIGW::Route',
          Properties: {
            Path: 'books',
            Api: 'MyApi',
          },
        },
        GetBooks: {
          Type: 'Functorial::APIGW::Method',
          Properties: {
            HttpMethod: 'GET',
            Auth: 'NONE',
            Route: 'BooksRoute',
            IntegrationType: 'AWS_PROXY',
            IntegrationUri: 'arn:aws:lambda:us-east-1:123:function:GetBooks',
          },
        },
      },
    });

    const cfn = compile(schema, template);
    const types = Object.values(cfn.Resources).map(r => r.Type);

    expect(types).toContain('AWS::ApiGateway::RestApi');
    expect(types).toContain('AWS::ApiGateway::Resource');
    expect(types).toContain('AWS::ApiGateway::Method');
    expect(types).toContain('AWS::ApiGateway::Integration');
    expect(types).toContain('AWS::ApiGateway::Deployment');
    expect(types).toContain('AWS::ApiGateway::Stage');
  });

  it('path equation: Method.RestApiId equals Resource.RestApiId', () => {
    const schema = parseSchema(apigwSchema);
    const template = parseTemplate({
      Schema: './apigw.schema.yaml',
      Resources: {
        MyApi: {
          Type: 'Functorial::APIGW::Api',
          Properties: {
            Name: 'test-api',
            Description: 'Test',
          },
        },
        Dev: {
          Type: 'Functorial::APIGW::Stage',
          Properties: { StageName: 'dev', Api: 'MyApi' },
        },
        UsersRoute: {
          Type: 'Functorial::APIGW::Route',
          Properties: {
            Path: 'users',
            Api: 'MyApi',
          },
        },
        GetUsers: {
          Type: 'Functorial::APIGW::Method',
          Properties: {
            HttpMethod: 'GET',
            Auth: 'NONE',
            Route: 'UsersRoute',
            IntegrationType: 'AWS_PROXY',
            IntegrationUri: 'arn:aws:lambda:us-east-1:123:function:GetUsers',
          },
        },
      },
    });

    const cfn = compile(schema, template);

    const resource = Object.entries(cfn.Resources).find(
      ([_, r]) => r.Type === 'AWS::ApiGateway::Resource'
    );
    const method = Object.entries(cfn.Resources).find(
      ([_, r]) => r.Type === 'AWS::ApiGateway::Method'
    );

    // Both should reference the same RestApi
    expect(resource![1].Properties?.RestApiId).toEqual(method![1].Properties?.RestApiId);
  });

  it('path equation: Stage.RestApiId equals Deployment.RestApiId', () => {
    const schema = parseSchema(apigwSchema);
    const template = parseTemplate({
      Schema: './apigw.schema.yaml',
      Resources: {
        MyApi: {
          Type: 'Functorial::APIGW::Api',
          Properties: {
            Name: 'test-api',
            Description: 'Test',
          },
        },
        Prod: {
          Type: 'Functorial::APIGW::Stage',
          Properties: { StageName: 'prod', Api: 'MyApi' },
        },
        ItemsRoute: {
          Type: 'Functorial::APIGW::Route',
          Properties: {
            Path: 'items',
            Api: 'MyApi',
          },
        },
        GetItems: {
          Type: 'Functorial::APIGW::Method',
          Properties: {
            HttpMethod: 'GET',
            Auth: 'NONE',
            Route: 'ItemsRoute',
            IntegrationType: 'AWS_PROXY',
            IntegrationUri: 'arn:aws:lambda:us-east-1:123:function:GetItems',
          },
        },
      },
    });

    const cfn = compile(schema, template);

    const deployment = Object.entries(cfn.Resources).find(
      ([_, r]) => r.Type === 'AWS::ApiGateway::Deployment'
    );
    const stage = Object.entries(cfn.Resources).find(
      ([_, r]) => r.Type === 'AWS::ApiGateway::Stage'
    );

    expect(deployment![1].Properties?.RestApiId).toEqual(stage![1].Properties?.RestApiId);
  });

  it('macro: Methods array expands to individual Method resources', () => {
    const schema = parseSchema(apigwSchema);
    const template = parseTemplate({
      Schema: './apigw.schema.yaml',
      Resources: {
        MyApi: {
          Type: 'Functorial::APIGW::Api',
          Properties: {
            Name: 'items-api',
            Description: 'Items service',
          },
        },
        Prod: {
          Type: 'Functorial::APIGW::Stage',
          Properties: { StageName: 'prod', Api: 'MyApi' },
        },
        ItemsRoute: {
          Type: 'Functorial::APIGW::Route',
          Properties: {
            Path: 'items',
            Api: 'MyApi',
            IntegrationUri: 'arn:lambda:ItemsHandler',
            Methods: [
              { HttpMethod: 'GET', Auth: 'NONE', IntegrationType: 'AWS_PROXY' },
              { HttpMethod: 'POST', Auth: 'NONE', IntegrationType: 'AWS_PROXY' },
              { HttpMethod: 'DELETE', Auth: 'IAM', IntegrationType: 'AWS_PROXY' },
            ],
          },
        },
      },
    });

    const cfn = compile(schema, template);

    const methods = Object.entries(cfn.Resources).filter(
      ([_, r]) => r.Type === 'AWS::ApiGateway::Method'
    );
    expect(methods).toHaveLength(3);

    const verbs = methods.map(([_, r]) => r.Properties?.HttpMethod).sort();
    expect(verbs).toEqual(['DELETE', 'GET', 'POST']);
  });

  it('macro: Methods with objects forwards IntegrationUri', () => {
    const schema = parseSchema(apigwSchema);
    const template = parseTemplate({
      Schema: './apigw.schema.yaml',
      Resources: {
        MyApi: {
          Type: 'Functorial::APIGW::Api',
          Properties: {
            Name: 'test-api',
            Description: 'Test',
          },
        },
        Prod: {
          Type: 'Functorial::APIGW::Stage',
          Properties: { StageName: 'prod', Api: 'MyApi' },
        },
        BooksRoute: {
          Type: 'Functorial::APIGW::Route',
          Properties: {
            Path: 'books',
            Api: 'MyApi',
            IntegrationUri: 'arn:aws:lambda:us-east-1:123:function:BooksHandler',
            Methods: [
              { HttpMethod: 'GET', Auth: 'NONE', IntegrationType: 'AWS_PROXY' },
              { HttpMethod: 'POST', Auth: 'NONE', IntegrationType: 'AWS_PROXY' },
            ],
          },
        },
      },
    });

    const cfn = compile(schema, template);

    const integrations = Object.entries(cfn.Resources).filter(
      ([_, r]) => r.Type === 'AWS::ApiGateway::Integration'
    );

    // Each method generates an integration; they all share the forwarded URI
    for (const [_, integ] of integrations) {
      expect(integ.Properties?.Uri).toBe(
        'arn:aws:lambda:us-east-1:123:function:BooksHandler'
      );
    }
  });

  it('multiple routes share one RestApi', () => {
    const schema = parseSchema(apigwSchema);
    const template = parseTemplate({
      Schema: './apigw.schema.yaml',
      Resources: {
        MyApi: {
          Type: 'Functorial::APIGW::Api',
          Properties: {
            Name: 'multi-route-api',
            Description: 'Multiple routes',
          },
        },
        Prod: {
          Type: 'Functorial::APIGW::Stage',
          Properties: { StageName: 'prod', Api: 'MyApi' },
        },
        UsersRoute: {
          Type: 'Functorial::APIGW::Route',
          Properties: { Path: 'users', Api: 'MyApi' },
        },
        OrdersRoute: {
          Type: 'Functorial::APIGW::Route',
          Properties: { Path: 'orders', Api: 'MyApi' },
        },
        GetUsers: {
          Type: 'Functorial::APIGW::Method',
          Properties: {
            HttpMethod: 'GET',
            Auth: 'NONE',
            Route: 'UsersRoute',
            IntegrationType: 'AWS_PROXY',
            IntegrationUri: 'arn:lambda:GetUsers',
          },
        },
        GetOrders: {
          Type: 'Functorial::APIGW::Method',
          Properties: {
            HttpMethod: 'GET',
            Auth: 'NONE',
            Route: 'OrdersRoute',
            IntegrationType: 'AWS_PROXY',
            IntegrationUri: 'arn:lambda:GetOrders',
          },
        },
      },
    });

    const cfn = compile(schema, template);

    // One RestApi
    const apis = Object.entries(cfn.Resources).filter(
      ([_, r]) => r.Type === 'AWS::ApiGateway::RestApi'
    );
    expect(apis).toHaveLength(1);

    // Two Resources
    const resources = Object.entries(cfn.Resources).filter(
      ([_, r]) => r.Type === 'AWS::ApiGateway::Resource'
    );
    expect(resources).toHaveLength(2);

    // Two Methods
    const methods = Object.entries(cfn.Resources).filter(
      ([_, r]) => r.Type === 'AWS::ApiGateway::Method'
    );
    expect(methods).toHaveLength(2);

    // All resources reference the same RestApi
    const apiRef = apis[0][0];
    for (const [_, resource] of resources) {
      expect(resource.Properties?.RestApiId).toEqual({ Ref: apiRef });
    }
  });

  it('toggle off kills Deployment and Stage', () => {
    const schema = parseSchema(apigwSchema);
    const template = parseTemplate({
      Schema: './apigw.schema.yaml',
      Resources: {
        MyApi: {
          Type: 'Functorial::APIGW::Api',
          Properties: {
            Name: 'test-api',
            Description: 'Test',
          },
        },
        Prod: {
          Type: 'Functorial::APIGW::Stage',
          Properties: { StageName: 'prod', Api: 'MyApi' },
        },
        Route1: {
          Type: 'Functorial::APIGW::Route',
          Properties: { Path: 'test', Api: 'MyApi' },
        },
        Method1: {
          Type: 'Functorial::APIGW::Method',
          Properties: {
            HttpMethod: 'GET',
            Auth: 'NONE',
            Route: 'Route1',
            IntegrationType: 'AWS_PROXY',
            IntegrationUri: 'arn:lambda:Test',
          },
        },
      },
      Toggles: { DeployToggle: false },
    });

    const cfn = compile(schema, template);

    const types = Object.values(cfn.Resources).map(r => r.Type);
    expect(types).not.toContain('AWS::ApiGateway::Deployment');
    expect(types).not.toContain('AWS::ApiGateway::Stage');
    // But the API, Resource, and Method still exist
    expect(types).toContain('AWS::ApiGateway::RestApi');
    expect(types).toContain('AWS::ApiGateway::Resource');
    expect(types).toContain('AWS::ApiGateway::Method');
  });
});