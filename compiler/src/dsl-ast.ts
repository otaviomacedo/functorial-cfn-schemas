/**
 * AST node types for the schema (`.schema`) and instance (`.instance`) DSLs.
 *
 * These are the parser's output. A separate lowering step (in `schema-dsl.ts`
 * and `instance-dsl.ts`) translates them into the plain-object "raw" shapes
 * that `schema-parser.ts` / `template-parser.ts` already consume, so the
 * categorical core and compiler are reused unchanged.
 */

// ============================================================================
// Schema DSL
// ============================================================================

export interface SchemaFile {
  kind: 'schema-file';
  imports: string[];
  schemas: SchemaBlock[];
  maps: MapBlock[];
}

export interface SchemaBlock {
  kind: 'schema';
  name: string;
  objects: ObjDecl[];
  values: ValueDecl[];
  toggles: string[]; // toggle object names
  equations: EquationDecl[];
  macros: MacroDecl[];
}

export interface ObjDecl {
  kind: 'obj';
  /** The CloudFormation/Functorial type string, e.g. "AWS::EC2::VPC". */
  type: string;
  /** The category-internal name (from `alias`), e.g. "VPC". Defaults to `type` if absent. */
  alias: string;
  properties: PropDecl[];
  /** Non-rendered structural morphisms (from a `structure { }` block). */
  structure: PropDecl[];
}

/**
 * A single property inside an `obj` block. Exactly one of `value` / `source` /
 * `default` / `sameAs` is the primary attribute; `via` is an optional
 * rendering annotation.
 */
export interface PropDecl {
  name: string;
  value?: string; // `Value: String`  → a value morphism to an inferred value object
  source?: string; // `Source: X`      → a reference morphism to object X
  default?: any; // `Default: <lit>`   → a literal constant rendered as-is
  sameAs?: string; // `SameAs: Sibling` → shares another property's morphism
  via?: string; // `Via: Ref` | `Via: GetAtt.Attr`
}

export interface ValueDecl {
  kind: 'value';
  name: string;
  valueType: string; // e.g. "String"
}

export interface EquationDecl {
  kind: 'equation';
  lhs: string[]; // path segments (morphism names), composition order left→right
  rhs: string[];
}

export interface MacroDecl {
  kind: 'macro';
  /** "ResourceType.Property", e.g. "Functorial::APIGW::Route.Methods". */
  key: string;
  fields: Record<string, any>; // expandsTo / elementProperty / backRef / forward / toggle
}

export interface MapBlock {
  kind: 'map';
  from: string; // domain schema name (D)
  to: string; // codomain schema name (C)
  objectMappings: Array<{ from: string; to: string }>;
  morphismMappings: Array<{ from: string; to: string[] }>; // to = path segments
}

// ============================================================================
// Instance DSL
// ============================================================================

export interface InstanceFile {
  kind: 'instance-file';
  schemaPath: string;
  resources: ResDecl[];
  toggles: Array<{ name: string; value: boolean }>;
}

export interface ResDecl {
  kind: 'res';
  logicalId: string;
  type: string;
  properties: Record<string, any>;
}
