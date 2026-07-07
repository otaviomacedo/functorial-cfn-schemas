/**
 * Parser + lowering for the instance (`.instance`) DSL — the user-facing input
 * that names a schema and declares resources and toggles.
 *
 * Lowers to the raw `{ Schema, Resources, Toggles }` object that
 * `parseTemplate` (template-parser.ts) already consumes.
 */

import { InstanceFile, ResDecl } from './dsl-ast';
import { tokenize, TokenStream } from './lexer';

export function parseInstanceFile(source: string): InstanceFile {
  const ts = new TokenStream(tokenize(source));

  ts.expectKeyword('instance');
  ts.expectKeyword('of');
  const pathTok = ts.peek();
  if (pathTok.type !== 'string') throw ts.error('Expected a quoted schema path after "instance of"');
  ts.next();
  const schemaPath = pathTok.value;

  const resources: ResDecl[] = [];
  const toggles: Array<{ name: string; value: boolean }> = [];

  while (!ts.atEof()) {
    if (ts.isKeyword('res')) {
      resources.push(parseRes(ts));
    } else if (ts.isKeyword('toggle')) {
      ts.next();
      const name = ts.expectIdent().value;
      ts.expectPunct('=');
      toggles.push({ name, value: parseBool(ts) });
    } else {
      throw ts.error("Expected 'res' or 'toggle'");
    }
  }

  return { kind: 'instance-file', schemaPath, resources, toggles };
}

function parseRes(ts: TokenStream): ResDecl {
  ts.expectKeyword('res');
  const logicalId = ts.expectIdent().value;
  ts.expectPunct(':');
  const type = parseTypeName(ts);
  ts.expectPunct('=');
  const properties = parseObject(ts);
  return { kind: 'res', logicalId, type, properties };
}

function parseTypeName(ts: TokenStream): string {
  let name = ts.expectIdent().value;
  while (ts.isPunct('::')) {
    ts.next();
    name += '::' + ts.expectIdent().value;
  }
  return name;
}

function parseBool(ts: TokenStream): boolean {
  if (ts.isKeyword('true')) {
    ts.next();
    return true;
  }
  if (ts.isKeyword('false')) {
    ts.next();
    return false;
  }
  throw ts.error("Expected 'true' or 'false'");
}

/** Parse a `{ key: value, ... }` object (used for resource property blocks). */
function parseObject(ts: TokenStream): Record<string, any> {
  ts.expectPunct('{');
  const obj: Record<string, any> = {};
  while (!ts.isPunct('}')) {
    if (ts.atEof()) throw ts.error('Unterminated object');
    const key = ts.expectIdent().value;
    ts.expectPunct(':');
    obj[key] = parseValue(ts);
    if (ts.isPunct(',')) ts.next();
  }
  ts.expectPunct('}');
  return obj;
}

/**
 * Parse a value: string, number, boolean, array, nested object, or a
 * CloudFormation intrinsic (`!Ref`, `!GetAtt`, `!Sub`, etc.).
 */
function parseValue(ts: TokenStream): any {
  const t = ts.peek();

  if (t.type === 'bang') return parseIntrinsic(ts);

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
      if (ts.atEof()) throw ts.error('Unterminated array');
      arr.push(parseValue(ts));
      if (ts.isPunct(',')) ts.next();
    }
    ts.expectPunct(']');
    return arr;
  }
  if (ts.isPunct('{')) {
    return parseObject(ts);
  }
  if (t.type === 'ident') {
    ts.next();
    if (t.value === 'true') return true;
    if (t.value === 'false') return false;
    return t.value; // bareword (e.g. a logical-id reference for a Source property)
  }

  throw ts.error('Expected a value');
}

/**
 * Parse a CloudFormation intrinsic. Supported short forms:
 *   !Ref X                → { "Ref": "X" }
 *   !GetAtt A.B.C         → { "Fn::GetAtt": ["A", "B.C"] }
 *   !Sub "..."            → { "Fn::Sub": "..." }
 *   !<Fn> <value>         → { "Fn::<Fn>": <value> }  (generic fallback)
 */
function parseIntrinsic(ts: TokenStream): any {
  ts.next(); // consume the '!' (bang) token
  const name = ts.expectIdent().value;

  if (name === 'Ref') {
    return { Ref: ts.expectIdent().value };
  }

  if (name === 'GetAtt') {
    // Dotted reference: logicalId.Attr.Sub → ["logicalId", "Attr.Sub"].
    const first = ts.expectIdent().value;
    const rest: string[] = [];
    while (ts.isPunct('.')) {
      ts.next();
      rest.push(ts.expectIdent().value);
    }
    return { 'Fn::GetAtt': [first, rest.join('.')] };
  }

  // Generic fallback: !Fn <value>.
  return { [`Fn::${name}`]: parseValue(ts) };
}

export function lowerInstanceFile(file: InstanceFile): any {
  const Resources: Record<string, any> = {};
  for (const res of file.resources) {
    Resources[res.logicalId] = {
      Type: res.type,
      Properties: res.properties,
    };
  }

  const Toggles: Record<string, boolean> = {};
  for (const t of file.toggles) Toggles[t.name] = t.value;

  return {
    Schema: file.schemaPath,
    Resources,
    ...(Object.keys(Toggles).length > 0 ? { Toggles } : {}),
  };
}
