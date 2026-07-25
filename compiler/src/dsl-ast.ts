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
  sums: SumDecl[]; // sum-type declarations (`data T = A | B | …`)
  equations: EquationDecl[];
  macros: MacroDecl[];
}

/**
 * A sum type `data T = V1 | V2 | …`. `T` is a *compile-time-only* name: it is
 * erased during lowering and never becomes a category object. A property whose
 * `Source` is a sum type desugars to one span per variant (see `PropDecl`).
 */
export interface SumDecl {
  kind: 'sum';
  name: string;
  variants: string[]; // object names (existing resource types)
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
  /**
   * Marked optional (`Name? { … }` or `Name?: T`). An optional reference lowers
   * to a *span* `Source ←on— apex —to→ target` (monic `on`, and deliberately NO
   * reverse morphism, so the target may be shared: an optional ref is n:1, not
   * owned). A mandatory reference stays a plain morphism.
   */
  optional?: boolean;
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
  /**
   * Fullness gaps the author has acknowledged as intended (e.g. an auto-created
   * resource cascade). Each is a `*`-separated C-path; the faithfulness checker
   * reclassifies a matching fullness violation from a warning to an expected,
   * informational note. New, undeclared gaps still warn.
   */
  expectedFullness: Array<{ path: string[]; reason?: string }>;
  /**
   * Cardinality opinions the abstraction imposes on the *codomain* C₀. These are
   * localizations — they invert an existing C-morphism, adding its formal inverse
   * so the right Kan extension re-indexes a fiber (e.g. forcing route tables 1:1
   * with subnets) without a hand-authored structural arrow in C₀. The opinion
   * lives here, in the abstraction, not in the auto-generated ground-truth C₀.
   */
  constraints: ConstrainDecl[];
}

/**
 * A cardinality opinion on the codomain, lowered to a localization of C₀.
 *
 *   - `invert  <Obj.Prop>` — assert the single C-morphism `Obj.Prop` is iso.
 *     Emits a formal inverse generator plus the two identity equations.
 *   - `bijection <Obj>`    — assert an association object's two reference legs
 *     are both iso (a 1:1 pairing). Desugars to an `invert` on each leg.
 *
 * `target` is the morphism `Obj.Prop` (invert) or the object `Obj` (bijection).
 */
export interface ConstrainDecl {
  kind: 'invert' | 'bijection';
  target: string;
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
