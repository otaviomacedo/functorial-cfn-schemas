# Functorial CloudFormation Schemas

A framework for defining simplified infrastructure schemas where structural correctness (which resources exist, what references what) is guaranteed by construction using category theory.

## Background: Infrastructure as Code

Cloud providers (AWS, Azure, GCP) let you provision infrastructure — virtual networks, servers, databases, API endpoints — by writing declarative configuration files rather than clicking through a console. AWS calls this service **CloudFormation**: you write a YAML template describing your desired resources, and AWS creates/updates them to match.

A real-world template might declare dozens of resources that cross-reference each other. A subnet belongs to a VPC. A route table is attached to a subnet. A NAT gateway sits in a subnet and uses an elastic IP. An API method belongs to an API resource which belongs to a REST API. These references form a **graph of dependencies** — and getting any edge wrong produces infrastructure that deploys without errors but silently misbehaves at runtime (traffic routes to the wrong network, API calls return 404, etc.).

Tools like AWS CDK (Cloud Development Kit) let you write infrastructure in general-purpose programming languages (TypeScript, Python) with higher-level abstractions. But they address the problem with imperative code — bugs in wiring are still possible, just hidden behind method calls.

## The idea

This framework takes a different approach. Instead of hiding wiring behind code, it makes wiring bugs **structurally impossible** using category theory.

CloudFormation templates are full of "wiring" — resources that reference each other via `Ref` and `Fn::GetAtt`. Getting this wiring wrong produces templates that deploy successfully but fail silently at runtime (wrong VPC, mismatched API Gateway RestApiId, etc.). These bugs are hard to test because they're structural, not computational.

This framework separates structure from computation:

1. An **abstraction author** defines a simplified schema (category D), the full CloudFormation pattern (category C), and a functor G: D → C mapping between them.
2. A **user** writes a template against the simplified schema.
3. The **compiler** computes the right Kan extension to mechanically generate the full CloudFormation template with all references wired correctly.

The Kan extension guarantees: if the functor is valid and the user's input is a valid instance of D, then the output is a valid instance of C with all references consistent. Wiring bugs become impossible by construction.

## Architecture

```
User template (instance of D)
    │
    │  [macro expansion]        ← syntactic sugar, runs first
    │
    ▼
Canonical D-instance
    │
    │  [right Kan extension]    ← the categorical core
    │
    ▼
Full C-instance (skeleton)
    │
    │  [render]                 ← fill in values, defaults, names
    │
    ▼
CloudFormation template
```

## Project structure

```
core/               Category theory engine
  src/
    category.ts     Finitely-presented categories (objects, morphisms, path equations)
    functor.ts      Functors between categories, with composition
    instance.ts     Instances (functors to Set)
    kan.ts          Right Kan extension computation
    pattern.ts      Pattern abstraction (ties C, D, G together)
    typed.ts        Type-safe API for pattern definition
    cdk-bridge.ts   CDK construct rendering bridge

compiler/           YAML schema compiler
  src/
    schema-parser.ts   Parse schema YAML (with import/composition support)
    template-parser.ts Parse user templates
    macros.ts          Macro preprocessor (array expansion, toggle expansion)
    compiler.ts        End-to-end: schema + template → CloudFormation
    compile-file.ts    File-based compilation with import resolution

examples/           Example schemas and templates
    vpc.schema.yaml
    apigw.schema.yaml
    ...
```

## Key concepts

### Categories as schemas

A schema is a small category where:
- **Objects** are resource types and value types
- **Morphisms** are references between them (Subnet → VPC means "a subnet references a VPC")
- **Path equations** enforce consistency constraints (Method.RestApiId = Method.ResourceId.RestApiId)

### Functors as simplifications

A functor G: D → C maps a user-facing schema to the full CloudFormation schema. The user works with D (simple, few objects); the framework generates C (complex, many objects).

### Right Kan extension as compilation

Given G: D → C and a user instance I: D → Set, the right Kan extension Pi_G(I): C → Set produces the full template:
- Objects disconnected from G's image get a **default singleton** (auto-created resources)
- Objects with paths to user inputs get **correlated copies** (one per user element)
- Path equations **collapse products** (enforce bijective pairing, e.g., NAT #k uses EIP #k)
- Empty sets **cascade** through morphisms (toggle off → kill dependent resources)

### Functor composition as layering

Schemas can import other schemas. A child schema defines D' with a functor H: D' → D into the parent's simplified schema. The compiler composes G ∘ H: D' → C automatically. Each layer is validated independently; composition preserves correctness.

### Macros as syntactic sugar

Macros rewrite user templates before the Kan extension runs. They are purely syntactic (cannot inspect values or make structural decisions based on content). Two kinds:

- **Array expansion**: `Methods: [GET, POST]` on a Route becomes two separate Method resources
- **Toggle expansion**: `InternetAccess: true` becomes a toggle resource

Macros cannot break functoriality — their output is validated against D normally.

## Design patterns

These patterns recur across schemas:

| Pattern | Problem | Solution |
|---------|---------|----------|
| **Resource tree** | Parent reference renders differently at root vs nested | Split into RootResource + NestedResource (same CfnType, different Via) |
| **Optional reference** | Not every Method has an Authorizer | Split into PublicMethod + AuthorizedMethod |
| **Toggle** | Boolean existence control (IGW on/off) | Isolated object with empty-set cascade |
| **Count** | Multiple copies paired bijectively | Path equation collapses product to diagonal |
| **Auto-created** | Resource exists but user doesn't specify it | Object disconnected from G's image → singleton default |

## Example: API Gateway

User writes:
```yaml
Schema: ./apigw.schema.yaml

Resources:
  ItemsApi:
    Type: Functorial::APIGW::Api
    Properties:
      Name: "items-service"
      Description: "Items API"

  Prod:
    Type: Functorial::APIGW::Stage
    Properties:
      StageName: "prod"
      Api: ItemsApi

  ItemsRoute:
    Type: Functorial::APIGW::Route
    Properties:
      Path: "items"
      Api: ItemsApi
      Methods:
        - HttpMethod: "GET"
          Auth: "NONE"
          IntegrationType: "AWS_PROXY"
        - HttpMethod: "POST"
          Auth: "NONE"
          IntegrationType: "AWS_PROXY"
```

The compiler generates: RestApi, Resource, 2 Methods, 2 Integrations, Deployment, Stage — all correctly wired. Path equations guarantee every resource references the same RestApiId.

## Running

```bash
# Install
cd core && npm install && cd ../compiler && npm install

# Test
cd core && npx jest
cd compiler && npx jest
```

## Limitations

The Kan extension is purely structural. It cannot:
- Compute values (CIDR arithmetic, name generation)
- Branch on values (only on existence: empty-set vs non-empty)
- Derive cardinalities from other cardinalities
- Validate global constraints (e.g., "subnet CIDRs fit in VPC")

These remain in the render layer (arbitrary code) or upstream tooling.

## Theory

Based on Chapter 3 of Fong & Spivak's *An Invitation to Applied Category Theory* ("databases as functors"). The core insight: a database schema is a category, an instance is a functor to Set, and data migration along a functor F is computed by the Kan extensions along F. We apply this to infrastructure schemas rather than database schemas.

See `kan-extensions-for-cfn.tex` for the formal development.