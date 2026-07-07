/**
 * Bridge from a `.schema` file to a static fiber analysis.
 *
 * Parses and lowers the DSL, builds the categories + functor, restricts to the
 * objects that render as CloudFormation resources, and runs `analyzeFibers`.
 * Shared by the CLI (`fiber-cli.ts`) and, later, the visualization web app.
 */

import * as fs from 'fs';
import { Category, Functor, analyzeFibers, FiberAnalysis } from '../../core/src';
import { parseSchema } from './schema-parser';
import { parseSchemaFile, lowerSchemaFile } from './schema-dsl';

export interface SchemaAnalysis {
  /** The functor G: D → C parsed from the file. */
  functor: Functor;
  /** C-objects that render as CFN resources (have a CfnType). */
  resourceObjects: string[];
  /** All C-objects (including value/toggle objects). */
  allObjects: string[];
  /** The static fiber analysis over the resource objects. */
  analysis: FiberAnalysis;
}

export function analyzeSchemaSource(source: string): SchemaAnalysis {
  const { raw, hasImport } = lowerSchemaFile(parseSchemaFile(source));
  if (hasImport) {
    // Multi-hop schemas need parent resolution (file paths); use analyzeSchemaFile.
    throw new Error('analyzeSchemaSource does not resolve imports; use analyzeSchemaFile');
  }
  return analyzeParsed(raw);
}

export function analyzeSchemaFile(schemaPath: string): SchemaAnalysis {
  // For now, single-file schemas (the examples). Import resolution can be added
  // by mirroring compile-file.ts's resolveSchema when multi-hop analysis is needed.
  const source = fs.readFileSync(schemaPath, 'utf8');
  return analyzeSchemaSource(source);
}

function analyzeParsed(raw: any): SchemaAnalysis {
  const schema = parseSchema(raw);
  const D = new Category(schema.simplified.categorySpec);
  const C = new Category(schema.original.categorySpec);
  const functor = new Functor(D, C, schema.functor);

  const resourceObjects = [...schema.original.objects]
    .filter(([, def]) => def.cfnType)
    .map(([name]) => name);
  const allObjects = [...C.objects];

  const analysis = analyzeFibers(functor, resourceObjects);
  return { functor, resourceObjects, allObjects, analysis };
}
