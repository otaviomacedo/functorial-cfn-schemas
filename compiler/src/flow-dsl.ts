/**
 * A tiny DSL for authoring a data-flow specification against an existing
 * `.schema` file. Parsed into the core `FlowSpec` (see core/src/flow.ts), so
 * gadgets 1–3 run on real schemas instead of hand-built categories.
 *
 * Grammar (C-style, same lexer as `.schema` / `.instance`):
 *
 *     flow of "./vpc.schema"          // which schema's C-category this is over
 *
 *     monic PrivateRTAssoc.RouteTableId   // legs whose reverse is a function
 *     monic NatGateway.SubnetId
 *
 *     // an edge is a zigzag: forward steps are bare morphisms, backward steps
 *     // are prefixed with `~`, composed left-to-right with `*`.
 *     edge egress: ~NatGateway.SubnetId * NatGateway.AllocationId
 *
 *     // optional: assert two flow paths denote the same flow
 *     eq egress * emit = archive
 *
 * Morphisms are referred to by their category name — `Alias.Property` for a
 * reference/value leg, `Apex.on` / `Apex.to` for span legs, exactly as the
 * schema lowering names them. The parser does no validation against C beyond
 * shape; `deriveFlow` validates the morphism names when the flow is built.
 */

import { tokenize, TokenStream } from './lexer';
import type {
  FlowSpec,
  FlowEdgeSpec,
  ZigzagStep,
  PathEquation,
} from '../../core/src';

export interface FlowFile {
  /** Path to the `.schema` this flow is defined over (from `flow of "..."`). */
  schemaPath: string;
  spec: FlowSpec;
}

/** Parse `.flow` source into a schema reference + a core `FlowSpec`. */
export function parseFlowFile(source: string): FlowFile {
  const ts = new TokenStream(tokenize(source));

  ts.expectKeyword('flow');
  ts.expectKeyword('of');
  const pathTok = ts.peek();
  if (pathTok.type !== 'string') {
    throw ts.error('Expected a quoted schema path after `flow of`');
  }
  ts.next();
  const schemaPath = pathTok.value;

  const monic: string[] = [];
  const edges: FlowEdgeSpec[] = [];
  const equations: PathEquation[] = [];

  while (!ts.atEof()) {
    if (ts.isKeyword('monic')) {
      ts.next();
      monic.push(parseMorphismName(ts));
    } else if (ts.isKeyword('edge')) {
      edges.push(parseEdge(ts));
    } else if (ts.isKeyword('eq')) {
      equations.push(parseEquation(ts));
    } else {
      throw ts.error("Expected 'monic', 'edge', or 'eq'");
    }
  }

  return { schemaPath, spec: { monic, edges, equations } };
}

/** A morphism name is a dotted identifier chain: `Alias.Property`, `Apex.on`. */
function parseMorphismName(ts: TokenStream): string {
  const parts = [ts.expectIdent().value];
  while (ts.isPunct('.')) {
    ts.next();
    parts.push(ts.expectIdent().value);
  }
  return parts.join('.');
}

/** `edge <name>: <step> [* <step>]*` where a step is `[~]<morphismName>`. */
function parseEdge(ts: TokenStream): FlowEdgeSpec {
  ts.expectKeyword('edge');
  const name = ts.expectIdent().value;
  ts.expectPunct(':');

  const zigzag: ZigzagStep[] = [parseStep(ts)];
  while (ts.isPunct('*')) {
    ts.next();
    zigzag.push(parseStep(ts));
  }
  return { name, zigzag };
}

/** A zigzag step: `~M` is a backward traversal of M, bare `M` is forward. */
function parseStep(ts: TokenStream): ZigzagStep {
  let direction: 'forward' | 'backward' = 'forward';
  if (ts.isPunct('~')) {
    ts.next();
    direction = 'backward';
  }
  return { morphism: parseMorphismName(ts), direction };
}

/**
 * `eq <edge> [* <edge>]* = <edge> [* <edge>]*` — an equality between two flow
 * paths (sequences of edge names, referring to edges declared above).
 */
function parseEquation(ts: TokenStream): PathEquation {
  ts.expectKeyword('eq');
  const lhs = parseEdgePath(ts);
  ts.expectPunct('=');
  const rhs = parseEdgePath(ts);
  return { lhs, rhs };
}

function parseEdgePath(ts: TokenStream): string[] {
  const names = [ts.expectIdent().value];
  while (ts.isPunct('*')) {
    ts.next();
    names.push(ts.expectIdent().value);
  }
  return names;
}
