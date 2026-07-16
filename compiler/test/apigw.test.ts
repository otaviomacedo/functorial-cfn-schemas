import { parseSchema, parseTemplate, compile as compileRaw } from '../src';

// This suite exercises output shape; the API Gateway functor is intentionally
// not fully faithful (Route/Authorizer diamond, Stage→DeployToggle), so silence
// those diagnostics here — they have dedicated coverage in
// faithfulness-diagnostics.test.ts.
const compile: typeof compileRaw = (schema, template, options) =>
  compileRaw(schema, template, { onDiagnostic: () => {}, ...options });

// Schema design notes:
//
// In C (CloudFormation), Stage → RestApi and Stage → Deployment → RestApi.
// The user can't collapse Stage into Api in D because there's no path from
// RestApi to StageName in C — the morphism goes the other way. So Stage is
// a separate object in D. This is functoriality enforcing correctness: Stage
// is a real resource the user must acknowledge. Deployment + Stage are still
// auto-created by the Kan extension as defaults (singleton) if the toggle is on.

// C has two Resource objects: RootResource (parent is the API's root) and
// NestedResource (parent is another resource). Both emit AWS::ApiGateway::Resource
// but with different ParentId rendering (GetAtt.RootResourceId vs Ref).
//
// D has Route (top-level, points to Api) and SubRoute (nested, points to Route).
// Both map to their respective C-level Resource objects.
//
// Path equations enforce:
//   - method_api = method_resource . root_resource_api  (for methods on root resources)
//   - nested_resource_api = nested_parent . root_resource_api (nested resources inherit API)
//   - stage_api = stage_deployment . deployment_api

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
      RootResource: {
        CfnType: 'AWS::ApiGateway::Resource',
        Properties: {
          RestApiId: { Source: 'root_resource_api' },
          ParentId: { Source: 'root_resource_api', Via: 'GetAtt.RootResourceId' },
          PathPart: { Source: 'root_resource_path' },
        },
      },
      NestedResource: {
        CfnType: 'AWS::ApiGateway::Resource',
        Properties: {
          RestApiId: { Source: 'nested_resource_api' },
          ParentId: { Source: 'nested_parent' },
          PathPart: { Source: 'nested_resource_path' },
        },
      },
      PublicMethod: {
        CfnType: 'AWS::ApiGateway::Method',
        Properties: {
          RestApiId: { Source: 'pub_method_api' },
          ResourceId: { Source: 'pub_method_resource' },
          HttpMethod: { Source: 'pub_method_verb' },
          AuthorizationType: { Source: 'pub_method_auth' },
        },
      },
      AuthorizedMethod: {
        CfnType: 'AWS::ApiGateway::Method',
        Properties: {
          RestApiId: { Source: 'auth_method_api' },
          ResourceId: { Source: 'auth_method_resource' },
          HttpMethod: { Source: 'auth_method_verb' },
          AuthorizationType: { Source: 'auth_method_auth' },
          AuthorizerId: { Source: 'auth_method_authorizer' },
        },
      },
      Authorizer: {
        CfnType: 'AWS::ApiGateway::Authorizer',
        Properties: {
          RestApiId: { Source: 'authorizer_api' },
          Name: { Source: 'authorizer_name' },
          Type: { Source: 'authorizer_type' },
          AuthorizerUri: { Source: 'authorizer_uri' },
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
      AuthIntegration: {
        CfnType: 'AWS::ApiGateway::Integration',
        Properties: {
          Type: { Source: 'auth_integration_type' },
          IntegrationHttpMethod: { Default: 'POST' },
          Uri: { Source: 'auth_integration_uri' },
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
      NestedPathPart: { ValueType: 'String' },
      HttpVerb: { ValueType: 'String' },
      AuthHttpVerb: { ValueType: 'String' },
      AuthType: { ValueType: 'String' },
      AuthAuthType: { ValueType: 'String' },
      IntegrationType: { ValueType: 'String' },
      IntegrationUri: { ValueType: 'String' },
      AuthIntegrationType: { ValueType: 'String' },
      AuthIntegrationUri: { ValueType: 'String' },
      AuthorizerName: { ValueType: 'String' },
      AuthorizerType: { ValueType: 'String' },
      AuthorizerUri: { ValueType: 'String' },
      StageName: { ValueType: 'String' },
      DeployToggle: { ValueType: 'Toggle' },
    },
    Morphisms: {
      api_name: 'RestApi -> ApiName',
      api_description: 'RestApi -> ApiDescription',
      root_resource_api: 'RootResource -> RestApi',
      root_resource_path: 'RootResource -> PathPart',
      nested_resource_api: 'NestedResource -> RestApi',
      nested_resource_path: 'NestedResource -> NestedPathPart',
      nested_parent: 'NestedResource -> RootResource',
      // Public method
      pub_method_api: 'PublicMethod -> RestApi',
      pub_method_resource: 'PublicMethod -> RootResource',
      pub_method_verb: 'PublicMethod -> HttpVerb',
      pub_method_auth: 'PublicMethod -> AuthType',
      pub_method_integration: 'PublicMethod -> Integration',
      // Authorized method
      auth_method_api: 'AuthorizedMethod -> RestApi',
      auth_method_resource: 'AuthorizedMethod -> RootResource',
      auth_method_verb: 'AuthorizedMethod -> AuthHttpVerb',
      auth_method_auth: 'AuthorizedMethod -> AuthAuthType',
      auth_method_authorizer: 'AuthorizedMethod -> Authorizer',
      auth_method_integration: 'AuthorizedMethod -> AuthIntegration',
      // Authorizer
      authorizer_api: 'Authorizer -> RestApi',
      authorizer_name: 'Authorizer -> AuthorizerName',
      authorizer_type: 'Authorizer -> AuthorizerType',
      authorizer_uri: 'Authorizer -> AuthorizerUri',
      // Integration
      integration_type: 'Integration -> IntegrationType',
      integration_uri: 'Integration -> IntegrationUri',
      auth_integration_type: 'AuthIntegration -> AuthIntegrationType',
      auth_integration_uri: 'AuthIntegration -> AuthIntegrationUri',
      // Deployment & Stage
      deployment_api: 'Deployment -> RestApi',
      deployment_toggle: 'Deployment -> DeployToggle',
      stage_api: 'Stage -> RestApi',
      stage_deployment: 'Stage -> Deployment',
      stage_name: 'Stage -> StageName',
    },
    Equations: [
      // Public method's API must match its Resource's API
      'pub_method_api = pub_method_resource . root_resource_api',
      // Authorized method's API must match its Resource's API
      'auth_method_api = auth_method_resource . root_resource_api',
      // Authorizer's API must match the method's API
      'auth_method_api = auth_method_authorizer . authorizer_api',
      // Nested resource's API must match its parent's API
      'nested_resource_api = nested_parent . root_resource_api',
      // Stage's API must match its Deployment's API
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
      SubRoute: {
        Type: 'Functorial::APIGW::SubRoute',
        Properties: {
          Path: { Source: 'subroute_path' },
          Parent: { Source: 'subroute_parent' },
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
      AuthMethod: {
        Type: 'Functorial::APIGW::AuthMethod',
        Properties: {
          HttpMethod: { Source: 'amethod_verb' },
          Auth: { Source: 'amethod_auth' },
          Route: { Source: 'amethod_route' },
          Authorizer: { Source: 'amethod_authorizer' },
          IntegrationType: { Source: 'amethod_inttype' },
          IntegrationUri: { Source: 'amethod_inturi' },
        },
      },
      Authorizer: {
        Type: 'Functorial::APIGW::Authorizer',
        Properties: {
          Name: { Source: 'authorizer_name' },
          Type: { Source: 'authorizer_type' },
          Uri: { Source: 'authorizer_uri' },
          Api: { Source: 'authorizer_api' },
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
      NestedPathPart: { ValueType: 'String' },
      HttpVerb: { ValueType: 'String' },
      AuthHttpVerb: { ValueType: 'String' },
      AuthType: { ValueType: 'String' },
      AuthAuthType: { ValueType: 'String' },
      IntegrationType: { ValueType: 'String' },
      IntegrationUri: { ValueType: 'String' },
      AuthIntegrationType: { ValueType: 'String' },
      AuthIntegrationUri: { ValueType: 'String' },
      AuthorizerName: { ValueType: 'String' },
      AuthorizerType: { ValueType: 'String' },
      AuthorizerUri: { ValueType: 'String' },
      StageName: { ValueType: 'String' },
      DeployToggle: { ValueType: 'Toggle' },
    },
    Morphisms: {
      api_name: 'Api -> ApiName',
      api_description: 'Api -> ApiDescription',
      route_path: 'Route -> PathPart',
      route_api: 'Route -> Api',
      subroute_path: 'SubRoute -> NestedPathPart',
      subroute_parent: 'SubRoute -> Route',
      // Public method
      method_verb: 'Method -> HttpVerb',
      method_auth: 'Method -> AuthType',
      method_route: 'Method -> Route',
      method_inttype: 'Method -> IntegrationType',
      method_inturi: 'Method -> IntegrationUri',
      // Authorized method
      amethod_verb: 'AuthMethod -> AuthHttpVerb',
      amethod_auth: 'AuthMethod -> AuthAuthType',
      amethod_route: 'AuthMethod -> Route',
      amethod_authorizer: 'AuthMethod -> Authorizer',
      amethod_inttype: 'AuthMethod -> AuthIntegrationType',
      amethod_inturi: 'AuthMethod -> AuthIntegrationUri',
      // Authorizer
      authorizer_name: 'Authorizer -> AuthorizerName',
      authorizer_type: 'Authorizer -> AuthorizerType',
      authorizer_uri: 'Authorizer -> AuthorizerUri',
      authorizer_api: 'Authorizer -> Api',
      // Stage
      stage_name: 'Stage -> StageName',
      stage_api: 'Stage -> Api',
    },
    Functor: {
      Objects: {
        Api: 'RestApi',
        Route: 'RootResource',
        SubRoute: 'NestedResource',
        Method: 'PublicMethod',
        AuthMethod: 'AuthorizedMethod',
        Authorizer: 'Authorizer',
        Stage: 'Stage',
        ApiName: 'ApiName',
        ApiDescription: 'ApiDescription',
        PathPart: 'PathPart',
        NestedPathPart: 'NestedPathPart',
        HttpVerb: 'HttpVerb',
        AuthHttpVerb: 'AuthHttpVerb',
        AuthType: 'AuthType',
        AuthAuthType: 'AuthAuthType',
        IntegrationType: 'IntegrationType',
        IntegrationUri: 'IntegrationUri',
        AuthIntegrationType: 'AuthIntegrationType',
        AuthIntegrationUri: 'AuthIntegrationUri',
        AuthorizerName: 'AuthorizerName',
        AuthorizerType: 'AuthorizerType',
        AuthorizerUri: 'AuthorizerUri',
        StageName: 'StageName',
        DeployToggle: 'DeployToggle',
      },
      Morphisms: {
        api_name: 'api_name',
        api_description: 'api_description',
        route_path: 'root_resource_path',
        route_api: 'root_resource_api',
        subroute_path: 'nested_resource_path',
        subroute_parent: 'nested_parent',
        method_verb: 'pub_method_verb',
        method_auth: 'pub_method_auth',
        method_route: 'pub_method_resource',
        method_inttype: 'pub_method_integration . integration_type',
        method_inturi: 'pub_method_integration . integration_uri',
        amethod_verb: 'auth_method_verb',
        amethod_auth: 'auth_method_auth',
        amethod_route: 'auth_method_resource',
        amethod_authorizer: 'auth_method_authorizer',
        amethod_inttype: 'auth_method_integration . auth_integration_type',
        amethod_inturi: 'auth_method_integration . auth_integration_uri',
        authorizer_name: 'authorizer_name',
        authorizer_type: 'authorizer_type',
        authorizer_uri: 'authorizer_uri',
        authorizer_api: 'authorizer_api',
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
    expect(types).toContain('AWS::ApiGateway::Resource'); // RootResource
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

  it('nested SubRoute: ParentId references the parent Resource via Ref', () => {
    const schema = parseSchema(apigwSchema);
    const template = parseTemplate({
      Schema: './apigw.schema.yaml',
      Resources: {
        MyApi: {
          Type: 'Functorial::APIGW::Api',
          Properties: { Name: 'nested-api', Description: 'Nested routes' },
        },
        Prod: {
          Type: 'Functorial::APIGW::Stage',
          Properties: { StageName: 'prod', Api: 'MyApi' },
        },
        ItemsRoute: {
          Type: 'Functorial::APIGW::Route',
          Properties: { Path: 'items', Api: 'MyApi' },
        },
        ItemRoute: {
          Type: 'Functorial::APIGW::SubRoute',
          Properties: { Path: '{id}', Parent: 'ItemsRoute' },
        },
        GetItem: {
          Type: 'Functorial::APIGW::Method',
          Properties: {
            HttpMethod: 'GET',
            Auth: 'NONE',
            Route: 'ItemsRoute',
            IntegrationType: 'AWS_PROXY',
            IntegrationUri: 'arn:lambda:GetItem',
          },
        },
      },
    });

    const cfn = compile(schema, template);

    // Should produce two AWS::ApiGateway::Resource instances
    const resources = Object.entries(cfn.Resources).filter(
      ([_, r]) => r.Type === 'AWS::ApiGateway::Resource'
    );
    expect(resources).toHaveLength(2);

    // The root resource gets ParentId via GetAtt.RootResourceId
    const rootResource = resources.find(
      ([_, r]) => r.Properties?.PathPart === 'items'
    );
    expect(rootResource).toBeDefined();
    expect(rootResource![1].Properties?.ParentId).toHaveProperty('Fn::GetAtt');

    // The nested resource gets ParentId via Ref to the root resource
    const nestedResource = resources.find(
      ([_, r]) => r.Properties?.PathPart === '{id}'
    );
    expect(nestedResource).toBeDefined();
    expect(nestedResource![1].Properties?.ParentId).toHaveProperty('Ref');
  });

  it('path equation: nested resource inherits API from parent', () => {
    const schema = parseSchema(apigwSchema);
    const template = parseTemplate({
      Schema: './apigw.schema.yaml',
      Resources: {
        MyApi: {
          Type: 'Functorial::APIGW::Api',
          Properties: { Name: 'test', Description: 'Test' },
        },
        Prod: {
          Type: 'Functorial::APIGW::Stage',
          Properties: { StageName: 'prod', Api: 'MyApi' },
        },
        UsersRoute: {
          Type: 'Functorial::APIGW::Route',
          Properties: { Path: 'users', Api: 'MyApi' },
        },
        UserRoute: {
          Type: 'Functorial::APIGW::SubRoute',
          Properties: { Path: '{userId}', Parent: 'UsersRoute' },
        },
        GetUser: {
          Type: 'Functorial::APIGW::Method',
          Properties: {
            HttpMethod: 'GET',
            Auth: 'NONE',
            Route: 'UsersRoute',
            IntegrationType: 'AWS_PROXY',
            IntegrationUri: 'arn:lambda:GetUser',
          },
        },
      },
    });

    const cfn = compile(schema, template);

    // Both resources should have the same RestApiId
    const resources = Object.entries(cfn.Resources).filter(
      ([_, r]) => r.Type === 'AWS::ApiGateway::Resource'
    );
    const apiRefs = resources.map(([_, r]) => JSON.stringify(r.Properties?.RestApiId));
    expect(new Set(apiRefs).size).toBe(1);
  });

  it('AuthMethod generates Authorizer resource and AuthorizerId reference', () => {
    const schema = parseSchema(apigwSchema);
    const template = parseTemplate({
      Schema: './apigw.schema.yaml',
      Resources: {
        MyApi: {
          Type: 'Functorial::APIGW::Api',
          Properties: { Name: 'auth-api', Description: 'With authorizer' },
        },
        Prod: {
          Type: 'Functorial::APIGW::Stage',
          Properties: { StageName: 'prod', Api: 'MyApi' },
        },
        LambdaAuth: {
          Type: 'Functorial::APIGW::Authorizer',
          Properties: {
            Name: 'lambda-auth',
            Type: 'REQUEST',
            Uri: 'arn:apigateway:lambda:AuthFn',
            Api: 'MyApi',
          },
        },
        SecureRoute: {
          Type: 'Functorial::APIGW::Route',
          Properties: { Path: 'secure', Api: 'MyApi' },
        },
        GetSecure: {
          Type: 'Functorial::APIGW::AuthMethod',
          Properties: {
            HttpMethod: 'GET',
            Auth: 'CUSTOM',
            Route: 'SecureRoute',
            Authorizer: 'LambdaAuth',
            IntegrationType: 'AWS_PROXY',
            IntegrationUri: 'arn:lambda:GetSecure',
          },
        },
      },
    });

    const cfn = compile(schema, template);

    const types = Object.values(cfn.Resources).map(r => r.Type);
    expect(types).toContain('AWS::ApiGateway::Authorizer');

    // The authorized method should reference the authorizer
    const methods = Object.entries(cfn.Resources).filter(
      ([_, r]) => r.Type === 'AWS::ApiGateway::Method'
    );
    const authMethod = methods.find(([_, r]) => r.Properties?.AuthorizerId);
    expect(authMethod).toBeDefined();
    expect(authMethod![1].Properties?.AuthorizerId).toHaveProperty('Ref');
  });

  it('path equation: authorizer API must match method API', () => {
    const schema = parseSchema(apigwSchema);
    const template = parseTemplate({
      Schema: './apigw.schema.yaml',
      Resources: {
        MyApi: {
          Type: 'Functorial::APIGW::Api',
          Properties: { Name: 'test', Description: 'Test' },
        },
        Prod: {
          Type: 'Functorial::APIGW::Stage',
          Properties: { StageName: 'prod', Api: 'MyApi' },
        },
        MyAuth: {
          Type: 'Functorial::APIGW::Authorizer',
          Properties: {
            Name: 'my-auth',
            Type: 'TOKEN',
            Uri: 'arn:apigateway:lambda:AuthFn',
            Api: 'MyApi',
          },
        },
        Route1: {
          Type: 'Functorial::APIGW::Route',
          Properties: { Path: 'protected', Api: 'MyApi' },
        },
        AuthedMethod: {
          Type: 'Functorial::APIGW::AuthMethod',
          Properties: {
            HttpMethod: 'POST',
            Auth: 'CUSTOM',
            Route: 'Route1',
            Authorizer: 'MyAuth',
            IntegrationType: 'AWS_PROXY',
            IntegrationUri: 'arn:lambda:Protected',
          },
        },
      },
    });

    const cfn = compile(schema, template);

    // Authorizer's RestApiId should match the method's RestApiId
    const authorizer = Object.entries(cfn.Resources).find(
      ([_, r]) => r.Type === 'AWS::ApiGateway::Authorizer'
    );
    const method = Object.entries(cfn.Resources).find(
      ([_, r]) => r.Type === 'AWS::ApiGateway::Method' && r.Properties?.AuthorizerId
    );

    expect(authorizer).toBeDefined();
    expect(method).toBeDefined();
    expect(authorizer![1].Properties?.RestApiId).toEqual(method![1].Properties?.RestApiId);
  });

  it('public and authorized methods coexist on same API', () => {
    const schema = parseSchema(apigwSchema);
    const template = parseTemplate({
      Schema: './apigw.schema.yaml',
      Resources: {
        MyApi: {
          Type: 'Functorial::APIGW::Api',
          Properties: { Name: 'mixed-api', Description: 'Mixed auth' },
        },
        Prod: {
          Type: 'Functorial::APIGW::Stage',
          Properties: { StageName: 'prod', Api: 'MyApi' },
        },
        MyAuth: {
          Type: 'Functorial::APIGW::Authorizer',
          Properties: {
            Name: 'token-auth',
            Type: 'TOKEN',
            Uri: 'arn:apigateway:lambda:AuthFn',
            Api: 'MyApi',
          },
        },
        PublicRoute: {
          Type: 'Functorial::APIGW::Route',
          Properties: { Path: 'health', Api: 'MyApi' },
        },
        SecureRoute: {
          Type: 'Functorial::APIGW::Route',
          Properties: { Path: 'admin', Api: 'MyApi' },
        },
        HealthCheck: {
          Type: 'Functorial::APIGW::Method',
          Properties: {
            HttpMethod: 'GET',
            Auth: 'NONE',
            Route: 'PublicRoute',
            IntegrationType: 'AWS_PROXY',
            IntegrationUri: 'arn:lambda:Health',
          },
        },
        AdminAction: {
          Type: 'Functorial::APIGW::AuthMethod',
          Properties: {
            HttpMethod: 'POST',
            Auth: 'CUSTOM',
            Route: 'SecureRoute',
            Authorizer: 'MyAuth',
            IntegrationType: 'AWS_PROXY',
            IntegrationUri: 'arn:lambda:Admin',
          },
        },
      },
    });

    const cfn = compile(schema, template);

    const methods = Object.entries(cfn.Resources).filter(
      ([_, r]) => r.Type === 'AWS::ApiGateway::Method'
    );
    expect(methods).toHaveLength(2);

    // One has AuthorizerId, one doesn't
    const withAuth = methods.filter(([_, r]) => r.Properties?.AuthorizerId);
    const withoutAuth = methods.filter(([_, r]) => !r.Properties?.AuthorizerId);
    expect(withAuth).toHaveLength(1);
    expect(withoutAuth).toHaveLength(1);

    // Both reference the same RestApi
    const apiRefs = methods.map(([_, r]) => JSON.stringify(r.Properties?.RestApiId));
    expect(new Set(apiRefs).size).toBe(1);
  });
});