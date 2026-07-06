/**
 * High-level entry point: takes a template file path, resolves its schema
 * reference, and compiles to a CloudFormation template.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { parseSchema, parseSchemaWithImport, ParsedSchema } from './schema-parser';
import { parseTemplate } from './template-parser';
import { compile, CfnTemplate } from './compiler';

/**
 * Recursively resolve a schema file, following Imports to compose functor chains.
 */
function resolveSchema(schemaFilePath: string): ParsedSchema {
  const schemaRaw = yaml.parse(fs.readFileSync(schemaFilePath, 'utf8'));
  const schemaDir = path.dirname(schemaFilePath);

  if (schemaRaw.Imports) {
    const importPath = path.resolve(schemaDir, schemaRaw.Imports);
    const parentSchema = resolveSchema(importPath);
    return parseSchemaWithImport(schemaRaw, parentSchema);
  }

  return parseSchema(schemaRaw);
}

export function compileFile(templatePath: string): CfnTemplate {
  const templateDir = path.dirname(path.resolve(templatePath));
  const templateRaw = yaml.parse(fs.readFileSync(templatePath, 'utf8'));
  const template = parseTemplate(templateRaw);

  const schemaFilePath = path.resolve(templateDir, template.schemaPath);
  const schema = resolveSchema(schemaFilePath);

  return compile(schema, template);
}
