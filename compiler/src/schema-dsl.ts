/**
 * Parser + lowering for the schema (`.schema`) DSL.
 *
 * The parser turns source text into a `SchemaFile` AST; the lowerer translates
 * that AST into the plain-object "raw schema" shape that `parseSchema` /
 * `parseSchemaWithImport` (schema-parser.ts) already consume. The categorical
 * core and the compiler are therefore reused unchanged.
 *
 * Two conveniences are added at the lowering layer (the core has neither):
 *   1. `Value: T` properties create a value object named after the property,
 *      shared within the schema. Reference/value morphisms are then produced by
 *      the existing inline desugaring in `parseSchema`.
 *   2. The functor is auto-completed: object mappings for value objects/toggles
 *      default to the same-named codomain object, and any morphism the `map`
 *      block omits is inferred as the unique codomain morphism between the
 *      mapped endpoints (preferring a same-named property morphism).
 */

import {
  SchemaFile,
  SchemaBlock,
  ObjDecl,
  PropDecl,
  ValueDecl,
  EquationDecl,
  MacroDecl,
  MapBlock,
} from './dsl-ast';
import { tokenize, TokenStream } from './lexer';

// ============================================================================
// Parsing
// ============================================================================

export function parseSchemaFile(source: string): SchemaFile {
  const ts = new TokenStream(tokenize(source));
  const imports: string[] = [];
  const schemas: SchemaBlock[] = [];
  const maps: MapBlock[] = [];

  while (!ts.atEof()) {
    if (ts.isKeyword('import')) {
      ts.next();
      const path = ts.peek();
      if (path.type !== 'string') throw ts.error('Expected a quoted import path');
      ts.next();
      imports.push(path.value);
    } else if (ts.isKeyword('schema')) {
      schemas.push(parseSchemaBlock(ts));
    } else if (ts.isKeyword('map')) {
      maps.push(parseMapBlock(ts));
    } else {
      throw ts.error("Expected 'import', 'schema', or 'map'");
    }
  }

  return { kind: 'schema-file', imports, schemas, maps };
}

function parseSchemaBlock(ts: TokenStream): SchemaBlock {
  ts.expectKeyword('schema');
  const name = ts.expectIdent().value;
  ts.expectPunct('{');

  const objects: ObjDecl[] = [];
  const values: ValueDecl[] = [];
  const toggles: string[] = [];
  const equations: EquationDecl[] = [];
  const macros: MacroDecl[] = [];

  while (!ts.isPunct('}')) {
    if (ts.atEof()) throw ts.error("Unterminated 'schema' block");

    if (ts.isKeyword('obj')) {
      objects.push(parseObj(ts));
    } else if (ts.isKeyword('value')) {
      values.push(parseValue(ts));
    } else if (ts.isKeyword('toggle')) {
      ts.next();
      toggles.push(ts.expectIdent().value);
    } else if (ts.isKeyword('macro')) {
      macros.push(parseMacro(ts));
    } else {
      // Otherwise it must be an equation: <path> = <path>
      equations.push(parseEquation(ts));
    }
  }

  ts.expectPunct('}');
  return { kind: 'schema', name, objects, values, toggles, equations, macros };
}

/** Parse a `::`-qualified type name, e.g. `AWS::EC2::VPC` or `Functorial::VPC::Network`. */
function parseTypeName(ts: TokenStream): string {
  let name = ts.expectIdent().value;
  while (ts.isPunct('::')) {
    ts.next();
    name += '::' + ts.expectIdent().value;
  }
  return name;
}

function parseObj(ts: TokenStream): ObjDecl {
  ts.expectKeyword('obj');
  const type = parseTypeName(ts);
  ts.expectPunct('{');

  const properties: PropDecl[] = [];
  const structure: PropDecl[] = [];

  while (!ts.isPunct('}')) {
    if (ts.atEof()) throw ts.error("Unterminated 'obj' block");
    if (ts.isKeyword('structure')) {
      ts.next();
      ts.expectPunct('{');
      while (!ts.isPunct('}')) {
        if (ts.atEof()) throw ts.error("Unterminated 'structure' block");
        structure.push(parseProp(ts));
      }
      ts.expectPunct('}');
    } else {
      properties.push(parseProp(ts));
    }
  }
  ts.expectPunct('}');

  let alias = type;
  if (ts.isKeyword('alias')) {
    ts.next();
    alias = ts.expectIdent().value;
  }

  return { kind: 'obj', type, alias, properties, structure };
}

/**
 * Parse one property: `Name { Attr: val, ... }`.
 * Recognized attributes: Value, Source, Default, SameAs, Via.
 */
function parseProp(ts: TokenStream): PropDecl {
  const name = ts.expectIdent().value;
  ts.expectPunct('{');

  const prop: PropDecl = { name };
  while (!ts.isPunct('}')) {
    if (ts.atEof()) throw ts.error('Unterminated property block');
    const attr = ts.expectIdent().value;
    ts.expectPunct(':');

    switch (attr) {
      case 'Value':
        prop.value = parseTypeName(ts);
        break;
      case 'Source':
        prop.source = ts.expectIdent().value;
        break;
      case 'SameAs':
        prop.sameAs = ts.expectIdent().value;
        break;
      case 'Via':
        prop.via = parseVia(ts);
        break;
      case 'Default':
        prop.default = parseLiteral(ts);
        break;
      default:
        throw ts.error(
          `Unknown property attribute '${attr}' (expected Value, Source, Default, SameAs, or Via)`,
        );
    }

    if (ts.isPunct(',')) ts.next();
  }
  ts.expectPunct('}');
  return prop;
}

/** `Via: Ref` or `Via: GetAtt.Attr` or `Via: GetAtt.Attr1.Attr2`. */
function parseVia(ts: TokenStream): string {
  let via = ts.expectIdent().value;
  while (ts.isPunct('.')) {
    ts.next();
    via += '.' + ts.expectIdent().value;
  }
  return via;
}

function parseValue(ts: TokenStream): ValueDecl {
  ts.expectKeyword('value');
  const name = ts.expectIdent().value;
  ts.expectPunct(':');
  const valueType = parseTypeName(ts);
  return { kind: 'value', name, valueType };
}

function parseMacro(ts: TokenStream): MacroDecl {
  ts.expectKeyword('macro');
  // Key: TypeName '.' Property, e.g. Functorial::APIGW::Route.Methods
  const type = parseTypeName(ts);
  ts.expectPunct('.');
  const property = ts.expectIdent().value;
  const key = `${type}.${property}`;

  ts.expectPunct('{');
  const fields: Record<string, any> = {};
  while (!ts.isPunct('}')) {
    if (ts.atEof()) throw ts.error("Unterminated 'macro' block");
    const field = ts.expectIdent().value;
    ts.expectPunct(':');
    fields[field] = parseLiteral(ts);
    if (ts.isPunct(',')) ts.next();
  }
  ts.expectPunct('}');
  return { kind: 'macro', key, fields };
}

/**
 * Parse an equation `<path> = <path>`, where a path is a `*`-separated list of
 * morphism names and each morphism name is `Object.Property`.
 */
function parseEquation(ts: TokenStream): EquationDecl {
  const lhs = parseMorphismPath(ts);
  ts.expectPunct('=');
  const rhs = parseMorphismPath(ts);
  return { kind: 'equation', lhs, rhs };
}

/** A `*`-separated path of `Object.Property` morphism names. */
function parseMorphismPath(ts: TokenStream): string[] {
  const segments: string[] = [parseMorphismName(ts)];
  while (ts.isPunct('*')) {
    ts.next();
    segments.push(parseMorphismName(ts));
  }
  return segments;
}

/** A single morphism name: `Object.Property`. */
function parseMorphismName(ts: TokenStream): string {
  const obj = ts.expectIdent().value;
  ts.expectPunct('.');
  const prop = ts.expectIdent().value;
  return `${obj}.${prop}`;
}

function parseMapBlock(ts: TokenStream): MapBlock {
  ts.expectKeyword('map');
  const from = ts.expectIdent().value;
  ts.expectPunct('->');
  const to = ts.expectIdent().value;
  ts.expectPunct('{');

  const objectMappings: Array<{ from: string; to: string }> = [];
  const morphismMappings: Array<{ from: string; to: string[] }> = [];

  while (!ts.isPunct('}')) {
    if (ts.atEof()) throw ts.error("Unterminated 'map' block");
    // LHS is either `Ident` (object) or `Ident.Ident` (morphism).
    const lhsObj = ts.expectIdent().value;
    if (ts.isPunct('.')) {
      ts.next();
      const lhsProp = ts.expectIdent().value;
      ts.expectPunct('->');
      const rhs = parseMorphismPath(ts);
      morphismMappings.push({ from: `${lhsObj}.${lhsProp}`, to: rhs });
    } else {
      ts.expectPunct('->');
      const rhs = ts.expectIdent().value;
      objectMappings.push({ from: lhsObj, to: rhs });
    }
  }
  ts.expectPunct('}');
  return { kind: 'map', from, to, objectMappings, morphismMappings };
}

/**
 * Parse a literal value (used by `Default:` and macro fields): string, number,
 * boolean, identifier (bareword), array, or nested object.
 */
function parseLiteral(ts: TokenStream): any {
  const t = ts.peek();

  if (t.type === 'string') {
    ts.next();
    return t.value;
  }
  if (t.type === 'number') {
    ts.next();
    return Number(t.value);
  }
  if (ts.isPunct('[')) {
    ts.next();
    const arr: any[] = [];
    while (!ts.isPunct(']')) {
      if (ts.atEof()) throw ts.error('Unterminated array literal');
      arr.push(parseLiteral(ts));
      if (ts.isPunct(',')) ts.next();
    }
    ts.expectPunct(']');
    return arr;
  }
  if (ts.isPunct('{')) {
    ts.next();
    const obj: Record<string, any> = {};
    while (!ts.isPunct('}')) {
      if (ts.atEof()) throw ts.error('Unterminated object literal');
      const key = ts.expectIdent().value;
      ts.expectPunct(':');
      obj[key] = parseLiteral(ts);
      if (ts.isPunct(',')) ts.next();
    }
    ts.expectPunct('}');
    return obj;
  }
  if (t.type === 'ident') {
    ts.next();
    if (t.value === 'true') return true;
    if (t.value === 'false') return false;
    return t.value; // bareword (e.g. a value-object name in a Forward list)
  }

  throw ts.error('Expected a literal value');
}

// ============================================================================
// Lowering to the raw schema shape consumed by schema-parser.ts
// ============================================================================

/** A lightweight morphism record used during functor inference. */
interface Morph {
  name: string; // Object.Property
  source: string; // object alias
  target: string; // object alias (may be a value object)
}

/**
 * Lower a parsed schema file into the raw object consumed by `parseSchema`
 * (single file, no import) or `parseSchemaWithImport` (with an import).
 *
 * Returns `{ raw, hasImport, importPath }`. When `hasImport` is true, `raw` has
 * the `{ SimplifiedSchema, Imports }` shape; otherwise the full
 * `{ OriginalSchema, SimplifiedSchema }` shape.
 */
export function lowerSchemaFile(
  file: SchemaFile,
): { raw: any; hasImport: boolean; importPath?: string } {
  if (file.maps.length === 0) {
    throw new Error("A schema file must contain at least one 'map' declaration");
  }

  const schemaByName = new Map(file.schemas.map(s => [s.name, s]));

  // For now we support one map per file (single-hop within the file, or one
  // hop into an imported parent). This matches the YAML model.
  const map = file.maps[0];
  const domain = schemaByName.get(map.from);
  if (!domain) {
    throw new Error(`map references unknown domain schema '${map.from}'`);
  }
  const codomainLocal = schemaByName.get(map.to);

  if (!codomainLocal) {
    // Cross-file: the codomain lives in an imported parent.
    if (file.imports.length === 0) {
      throw new Error(
        `map codomain '${map.to}' is not defined in this file and no import provides it`,
      );
    }
    const simplified = lowerSchemaObjects(domain, 'Type');
    const functor = buildFunctor(map, domain, /* codomain */ undefined);
    return {
      raw: {
        SimplifiedSchema: { ...simplified, Functor: functor },
        Imports: file.imports[0],
      },
      hasImport: true,
      importPath: file.imports[0],
    };
  }

  // Single file: codomain (C) → OriginalSchema, domain (D) → SimplifiedSchema.
  const original = lowerSchemaObjects(codomainLocal, 'CfnType');
  const simplified = lowerSchemaObjects(domain, 'Type');
  const functor = buildFunctor(map, domain, codomainLocal);

  return {
    raw: {
      OriginalSchema: original,
      SimplifiedSchema: { ...simplified, Functor: functor },
    },
    hasImport: false,
  };
}

/**
 * Lower a single schema block's objects/values/toggles/equations/macros into
 * the `{ Objects, Equations, Macros }` raw shape. `headerKey` is 'CfnType' for
 * the CloudFormation category and 'Type' for the user-facing category.
 */
function lowerSchemaObjects(schema: SchemaBlock, headerKey: 'CfnType' | 'Type'): any {
  const Objects: Record<string, any> = {};

  // Resource objects.
  for (const obj of schema.objects) {
    const entry: any = { [headerKey]: obj.type };
    const props = lowerProperties(obj);
    if (Object.keys(props.Properties).length > 0) entry.Properties = props.Properties;
    if (Object.keys(props.Structure).length > 0) entry.Structure = props.Structure;

    // Any `Value: T` properties imply value objects named after the property.
    for (const [vName, vType] of props.valueObjects) {
      if (!Objects[vName]) Objects[vName] = { ValueType: vType };
    }

    Objects[obj.alias] = entry;
  }

  // Explicitly declared value objects.
  for (const v of schema.values) {
    Objects[v.name] = { ValueType: v.valueType };
  }

  // Toggle objects.
  for (const t of schema.toggles) {
    Objects[t] = { ValueType: 'Toggle' };
  }

  const result: any = { Objects };

  if (schema.equations.length > 0) {
    result.Equations = schema.equations.map(
      eq => `${eq.lhs.join(' . ')} = ${eq.rhs.join(' . ')}`,
    );
  }

  if (schema.macros.length > 0) {
    result.Macros = {};
    for (const m of schema.macros) {
      result.Macros[m.key] = lowerMacroFields(m.fields);
    }
  }

  return result;
}

/**
 * Lower an object's properties into `{ Properties, Structure, valueObjects }`.
 * `valueObjects` maps generated value-object name → value type.
 */
function lowerProperties(obj: ObjDecl): {
  Properties: Record<string, any>;
  Structure: Record<string, any>;
  valueObjects: Map<string, string>;
} {
  const Properties: Record<string, any> = {};
  const Structure: Record<string, any> = {};
  const valueObjects = new Map<string, string>();

  const lowerOne = (p: PropDecl): any => {
    const entry: any = {};
    if (p.value !== undefined) {
      // `Value: T` → value object named after the property, referenced by Source.
      valueObjects.set(p.name, p.value);
      entry.Source = p.name;
    } else if (p.sameAs !== undefined) {
      // Share the sibling's inferred morphism (name = alias.sibling); no new
      // morphism is created because this Source is not an object name.
      entry.Source = `${obj.alias}.${p.sameAs}`;
    } else if (p.source !== undefined) {
      entry.Source = p.source;
    } else if (p.default !== undefined) {
      entry.Default = p.default;
    }
    if (p.via !== undefined) entry.Via = p.via;
    return entry;
  };

  for (const p of obj.properties) Properties[p.name] = lowerOne(p);
  for (const p of obj.structure) Structure[p.name] = lowerOne(p);

  return { Properties, Structure, valueObjects };
}

/** Map DSL macro fields (camelCase) to the raw macro keys parseMacros expects. */
function lowerMacroFields(fields: Record<string, any>): any {
  const out: any = {};
  const rename: Record<string, string> = {
    expandsTo: 'ExpandsTo',
    elementProperty: 'ElementProperty',
    backRef: 'BackRef',
    forward: 'Forward',
    toggle: 'Toggle',
  };
  for (const [k, v] of Object.entries(fields)) {
    out[rename[k] ?? k] = v;
  }
  return out;
}

/**
 * Build the functor's `{ Objects, Morphisms }` spec from the map block,
 * auto-completing object mappings (same-name for values/toggles) and inferring
 * omitted morphism mappings.
 *
 * When `codomain` is undefined (cross-file import), only explicit mappings are
 * emitted; inference against the imported parent is left to the caller/core.
 */
function buildFunctor(
  map: MapBlock,
  domain: SchemaBlock,
  codomain: SchemaBlock | undefined,
): { Objects: Record<string, string>; Morphisms: Record<string, string> } {
  const objectMap: Record<string, string> = {};
  for (const om of map.objectMappings) objectMap[om.from] = om.to;

  const domainObjects = allObjectNames(domain);
  const domainMorphs = inferMorphisms(domain);
  const domainMorphByName = new Map(domainMorphs.map(m => [m.name, m]));

  // Morphism mappings: explicit first.
  const morphismMap: Record<string, string> = {};
  for (const mm of map.morphismMappings) {
    morphismMap[mm.from] = mm.to.join(' . ');
  }

  if (codomain) {
    const codomainMorphsAll = inferMorphisms(codomain);
    const codomainMorphByName = new Map(codomainMorphsAll.map(m => [m.name, m]));
    const codomainObjects = new Set(allObjectNames(codomain));

    // Derive object mappings from the endpoints of explicit morphism mappings.
    // A D-morphism A.p -> C-path maps A→pathSource and target(A.p)→pathTarget.
    // This handles value objects whose D/C names differ (e.g. DnsHostnames vs
    // EnableDnsHostnames): the user maps the morphism, we infer both endpoints.
    for (const mm of map.morphismMappings) {
      const dm = domainMorphByName.get(mm.from);
      if (!dm) continue;
      const first = codomainMorphByName.get(mm.to[0]);
      const last = codomainMorphByName.get(mm.to[mm.to.length - 1]);
      if (first && objectMap[dm.source] === undefined) objectMap[dm.source] = first.source;
      if (last && objectMap[dm.target] === undefined) objectMap[dm.target] = last.target;
    }

    // Same-name completion for any still-unmapped domain object.
    for (const d of domainObjects) {
      if (!(d in objectMap) && codomainObjects.has(d)) {
        objectMap[d] = d;
      }
    }
  }

  if (codomain) {
    const codomainMorphs = inferMorphisms(codomain);
    for (const dm of domainMorphs) {
      if (dm.name in morphismMap) continue;
      const inferred = inferMorphismImage(dm, objectMap, codomainMorphs);
      if (inferred) morphismMap[dm.name] = inferred;
      // If not inferable, leave it out — the Functor constructor will raise a
      // clear error naming the unmapped morphism.
    }
  }

  return { Objects: objectMap, Morphisms: morphismMap };
}

/**
 * Infer the codomain path for a domain morphism `dm: A -> B` given the object
 * map. Prefers a codomain morphism named `G(A).<sameProperty>`, else falls back
 * to the unique codomain generating morphism between the mapped endpoints.
 */
function inferMorphismImage(
  dm: Morph,
  objectMap: Record<string, string>,
  codomainMorphs: Morph[],
): string | undefined {
  const gSource = objectMap[dm.source];
  const gTarget = objectMap[dm.target];
  if (gSource === undefined || gTarget === undefined) return undefined;

  const property = dm.name.slice(dm.name.indexOf('.') + 1);

  // Preferred: a codomain morphism with the same property name on G(source).
  const sameName = codomainMorphs.find(
    m => m.source === gSource && m.name === `${gSource}.${property}`,
  );
  if (sameName && sameName.target === gTarget) return sameName.name;

  // Fallback: the unique codomain morphism between the mapped endpoints.
  const between = codomainMorphs.filter(m => m.source === gSource && m.target === gTarget);
  if (between.length === 1) return between[0].name;

  return undefined;
}

/** All object names declared in a schema block (resources, values, toggles). */
function allObjectNames(schema: SchemaBlock): string[] {
  const names: string[] = [];
  for (const obj of schema.objects) {
    names.push(obj.alias);
    for (const p of obj.properties) if (p.value !== undefined) names.push(p.name);
    for (const p of obj.structure) if (p.value !== undefined) names.push(p.name);
  }
  for (const v of schema.values) names.push(v.name);
  for (const t of schema.toggles) names.push(t);
  return dedupe(names);
}

/**
 * Reconstruct the inline morphisms a schema block generates, matching the
 * naming `desugarInlineMorphisms` (schema-parser.ts) uses: `Alias.Property`
 * for every property whose Source/Value references an object. `SameAs` and
 * `Default` properties do not generate morphisms.
 */
function inferMorphisms(schema: SchemaBlock): Morph[] {
  const objectNames = new Set(allObjectNames(schema));
  const morphs: Morph[] = [];

  for (const obj of schema.objects) {
    const consider = [...obj.properties, ...obj.structure];
    for (const p of consider) {
      let target: string | undefined;
      if (p.value !== undefined) {
        target = p.name; // value object named after the property
      } else if (p.source !== undefined) {
        target = p.source;
      }
      // SameAs / Default → no morphism.
      if (target && objectNames.has(target)) {
        morphs.push({ name: `${obj.alias}.${p.name}`, source: obj.alias, target });
      }
    }
  }
  return morphs;
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}
