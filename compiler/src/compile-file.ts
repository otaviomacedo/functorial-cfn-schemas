/**
 * High-level entry point: takes an instance file path, resolves its schema
 * reference, and compiles to a CloudFormation template.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseSchema, parseSchemaWithImport, ParsedSchema } from './schema-parser';
import { parseTemplate } from './template-parser';
import { compile, CfnTemplate, CompileOptions } from './compiler';
import { parseSchemaFile, lowerSchemaFile } from './schema-dsl';
import { parseInstanceFile, lowerInstanceFile } from './instance-dsl';

/**
 * Recursively resolve a `.schema` file, following `import` to compose functor
 * chains. Each file is parsed and lowered to the raw shape the categorical
 * parsers consume.
 */
function resolveSchema(schemaFilePath: string): ParsedSchema {
  const file = parseSchemaFile(fs.readFileSync(schemaFilePath, 'utf8'));
  const { raw, hasImport, importPath } = lowerSchemaFile(file);
  const schemaDir = path.dirname(schemaFilePath);

  if (hasImport && importPath) {
    const parentPath = path.resolve(schemaDir, importPath);
    const parentSchema = resolveSchema(parentPath);
    return parseSchemaWithImport(raw, parentSchema);
  }

  return parseSchema(raw);
}

export function compileFile(instancePath: string, options?: CompileOptions): CfnTemplate {
  const instanceDir = path.dirname(path.resolve(instancePath));
  const file = parseInstanceFile(fs.readFileSync(instancePath, 'utf8'));
  const templateRaw = lowerInstanceFile(file);
  const template = parseTemplate(templateRaw);

  const schemaFilePath = path.resolve(instanceDir, template.schemaPath);
  const schema = resolveSchema(schemaFilePath);

  return compile(schema, template, options);
}
