/**
 * Bridge from a `.flow` file to a derived Flow category over its schema's C.
 *
 * Mirrors `analyze-schema.ts`: read the `.flow`, resolve the `.schema` it points
 * at (relative to the flow file), build C, and run the core `deriveFlow`. The
 * result is everything the CLI needs to answer type-level reachability and to
 * check the relational obligation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Category, deriveFlow, DerivedFlow } from '../../core/src';
import { analyzeSchemaFile } from './analyze-schema';
import { parseFlowFile } from './flow-dsl';

export interface FlowAnalysis {
  /** The CloudFormation-level category C the flow is derived over. */
  C: Category;
  /** The derived Flow category (wide subcategory of C's localization). */
  flow: DerivedFlow;
  /** Resolved absolute path of the `.schema` the flow is defined over. */
  schemaPath: string;
}

export function analyzeFlowFile(flowPath: string): FlowAnalysis {
  const source = fs.readFileSync(flowPath, 'utf8');
  const { schemaPath: rel, spec } = parseFlowFile(source);

  // The schema path in the `.flow` file is relative to the flow file itself.
  const schemaPath = path.resolve(path.dirname(flowPath), rel);
  const { C } = analyzeSchemaFile(schemaPath);

  const flow = deriveFlow(C, spec);
  return { C, flow, schemaPath };
}
