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

1. An **abstraction author** defines a simplified schema (category D), the full CloudFormation pattern (category C), and a functor G: D → C mapping between them — all in a `.schema` file.
2. A **user** writes an **instance** of the simplified schema in a `.instance` file.
3. The **compiler** computes the right Kan extension to mechanically generate the full CloudFormation template with all references wired correctly.

The Kan extension guarantees: if the functor is valid and the user's input is a valid instance of D, then the output is a valid instance of C with all references consistent. Wiring bugs become impossible by construction.

## Architecture

```
User instance (.instance, an instance of D)
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
    fiber-analysis.ts  Static (instance-free) classification of each C-object
    pattern.ts      Pattern abstraction (ties C, D, G together)
    typed.ts        Type-safe API for pattern definition
    cdk-bridge.ts   CDK construct rendering bridge

compiler/           DSL schema compiler
  src/
    lexer.ts           Shared tokenizer for the .schema / .instance DSLs
    dsl-ast.ts         AST node types for both DSLs
    schema-dsl.ts      Parse .schema source and lower to the raw schema shape
                       (functor auto-inference lives here)
    instance-dsl.ts    Parse .instance source and lower to the raw template shape
    schema-parser.ts   Build categories/functor from the raw shape (import/composition)
    template-parser.ts Parse the raw template shape
    macros.ts          Macro preprocessor (array expansion, toggle expansion)
    compiler.ts        End-to-end: schema + instance → CloudFormation
    compile-file.ts    File-based compilation with import resolution
    analyze-schema.ts  Bridge from a .schema file to a fiber analysis
    fiber-cli.ts       CLI: print each C-object's fiber and cardinality class
    graph-model.ts     Turn an analysis into a UI graph (D/C nodes, fibers, edges)
    viz-server.ts      Zero-dep dev server for the visualizer (POST /analyze)
  viz/                 Two-panel web app (editor + interactive Cytoscape graph)

examples/           Example schemas and instances
    vpc.schema
    vpc-minimal.instance
    apigw.schema
    apigw-items-api.instance
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

Macros rewrite user instances before the Kan extension runs. They are purely syntactic (cannot inspect values or make structural decisions based on content). Two kinds:

- **Array expansion**: `Methods: [ ... ]` on a Route becomes separate Method resources
- **Toggle expansion**: `InternetAccess: true` becomes a toggle resource

Macros cannot break functoriality — their output is validated against D normally.

## The DSL

Schemas and instances are written in a small C-style language (`//` and `/* */`
comments, braces, no significant whitespace).

A **schema** file (`.schema`) declares two categories and the functor between them:

```
schema Ec2 {                       // C: the CloudFormation category
    obj AWS::EC2::VPC {
        CidrBlock          { Value: String }   // a terminal value
        EnableDnsHostnames { Value: Boolean }
    } alias VPC

    obj AWS::EC2::Subnet {
        VpcId     { Source: VPC }              // a reference morphism
        CidrBlock { Value: String }
        MapPublicIpOnLaunch { Default: "true" }
    } alias PublicSubnet

    toggle IgwToggle
}

schema Vpc {                       // D: the user-facing category
    obj Functorial::VPC::Network {
        CidrBlock { Value: String }
    } alias Network
    // ...
}

map Vpc -> Ec2 {                   // the functor G: D → C
    Network -> VPC
    // object/value mappings and same-name morphisms are inferred;
    // only list a morphism when D and C names differ or a path is composite:
    PublicTier.Network -> PublicSubnet.VpcId
    Method.IntegrationType -> PublicMethod.Integration * Integration.Type
}
```

Property attributes inside an `obj`: `Value:` (a terminal value type), `Source:`
(a reference to another object), `Default:` (a literal constant), `SameAs:`
(reuse another property's reference, rendered differently), and `Via:` (`Ref` or
`GetAtt.Attr`). A `structure { }` block declares references not rendered as CFN
properties. `value X: T` declares a standalone value object; the `*` operator
composes morphisms in equations and functor paths.

An **instance** file (`.instance`) names a schema and declares resources/toggles:

```
instance of "./vpc.schema"

toggle IgwToggle = false

res MyVpc: Functorial::VPC::Network = {
    CidrBlock: "10.0.0.0/16"
    DnsHostnames: true
}
```

Property values are strings, numbers, booleans, arrays, nested objects, and
CloudFormation intrinsics (`!Ref X`, `!GetAtt A.B`, `!Sub "..."`).

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
```
instance of "./apigw.schema"

res ItemsApi: Functorial::APIGW::Api = {
    Name: "items-service"
    Description: "Items API"
}

res Prod: Functorial::APIGW::Stage = {
    StageName: "prod"
    Api: ItemsApi
}

res ItemsRoute: Functorial::APIGW::Route = {
    Path: "items"
    Api: ItemsApi
    Methods: [
        { HttpMethod: "GET",  Auth: "NONE", IntegrationType: "AWS_PROXY" },
        { HttpMethod: "POST", Auth: "NONE", IntegrationType: "AWS_PROXY" }
    ]
}
```

The compiler generates: RestApi, Resource, 2 Methods, 2 Integrations, Deployment, Stage — all correctly wired. Path equations guarantee every resource references the same RestApiId.

## Understanding a schema: fiber analysis

Writing a schema means designing `D` and `G` so that the Kan extension produces
the `C` you want. The hard part is that `G` only tells you directly about the
objects in its image — for everything else (route tables, associations,
deployments) you have to compute the Kan extension in your head to see how many
copies you'll get and what drives them.

The **fiber analyzer** (`core/src/fiber-analysis.ts`) does this statically. The
value of the Kan extension at an object `c` is a limit over the comma category
`(c ↓ G)`, and that comma category depends only on `C`, `D`, `G` — never on the
user's instance. So every `C`-object can be classified up front:

- **singleton** — empty comma category ⇒ one auto-created element (e.g. a `Deployment`)
- **1:1 correlated** — one driver ⇒ one copy per element of that `D`-object (e.g. `PublicSubnet` ↔ `PublicTier`)
- **product** — several drivers ⇒ one copy per combination, possibly collapsed by a path equation (e.g. `PublicRT` is `|Network| × |PublicTier|`, *not* a bare copy of `PublicTier`)

Run it on a schema:

```bash
cd compiler
npm run fibers -- examples/vpc.schema           # print fibers + cardinalities
npm run fibers -- examples/apigw.schema --verify # also cross-check vs the Kan engine
```

`--verify` builds coherent probe instances (every object size `k`, identity
morphisms — so all path equations hold) and confirms each predicted cardinality
`k^(#drivers)` against the real engine. This is also what the analyzer's tests
assert, so the classification is guaranteed consistent with actual behavior.

### Visualizer

A local two-panel web app renders the same analysis interactively: edit a schema
on the left, see `D` and `C` as graphs on the right, with `C` clustered into
color-coded fibers and every node badged with its cardinality class. Cross-fiber
references and the `G: d → G(d)` mapping are drawn as distinct edges; hover a
node to highlight its fiber, click one for its drivers and constraining
equations.

```bash
cd compiler
npm run viz            # build + serve on http://localhost:4173
npm run viz -- 8080    # custom port
```

The frontend (`compiler/viz/`) is plain HTML/CSS/JS using Cytoscape (served from
`node_modules`, no build step); the server (`compiler/src/viz-server.ts`)
re-analyzes the edited source on each keystroke via a `POST /analyze` endpoint.

## Running

```bash
# Install
cd core && npm install && cd ../compiler && npm install

# Test
cd core && npx jest
cd compiler && npx jest

# Analyze a schema's fiber structure
cd compiler && npm run fibers -- examples/apigw.schema --verify

# Explore schemas interactively in the browser
cd compiler && npm run viz
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