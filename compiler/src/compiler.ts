/**
 * The compiler: takes a parsed schema + parsed abstract template,
 * computes the right Kan extension, and renders a CloudFormation template.
 */

import {
  Category,
  Functor,
  Instance,
  inspectKan,
  checkFullyFaithful,
  formatFullFaithfulReport,
} from '../../core/src';
import { ParsedSchema, ObjectDef, PropertyDef } from './schema-parser';
import { AbstractTemplate, AbstractResource } from './template-parser';
import { applyMacros } from './macros';

export interface CfnTemplate {
  AWSTemplateFormatVersion: string;
  Resources: Record<string, CfnResource>;
}

export interface CfnResource {
  Type: string;
  Properties?: Record<string, any>;
}

export interface CompileOptions {
  /**
   * Where full/faithfulness diagnostics go. Defaults to `console.warn`. Pass a
   * collector to capture them, or `() => {}` to silence. These are warnings, not
   * errors: a non-fully-faithful functor still compiles, but the round trip
   * Δ_G Π_G(I) → I may lose or duplicate user data (see `faithfulness.ts`).
   */
  onDiagnostic?: (message: string) => void;
  /** Skip the full/faithfulness check entirely. */
  skipFaithfulnessCheck?: boolean;
}

/**
 * Compile an abstract template into a CloudFormation template.
 */
export function compile(
  schema: ParsedSchema,
  template: AbstractTemplate,
  options: CompileOptions = {},
): CfnTemplate {
  const expanded = schema.macros
    ? applyMacros(schema.macros, template)
    : template;

  const D = new Category(schema.simplified.categorySpec);
  const C = new Category(schema.original.categorySpec);
  const G = new Functor(D, C, schema.functor);

  if (!options.skipFaithfulnessCheck) {
    reportFaithfulness(G, options.onDiagnostic);
  }

  // Build the instance I: D → Set from the abstract resources.
  // Each abstract resource populates the objects in D.
  const sets = buildSets(schema, expanded);
  const functions = buildFunctions(schema, expanded, sets);

  const I = new Instance(D, sets, functions);
  const result = inspectKan(G, I);

  // Render the Kan extension result into CFN resources
  const cfnResources: Record<string, CfnResource> = {};

  for (const [objName, objDef] of schema.original.objects) {
    if (!objDef.cfnType) continue;

    const elements = result.objects[objName].elements;
    const families = result.objects[objName].families;

    for (let i = 0; i < elements.length; i++) {
      const logicalId = elements.length === 1
        ? objName
        : `${objName}${i}`;

      const properties = renderProperties(
        objDef,
        families[i],
        i,
        result,
        schema,
        C,
      );

      cfnResources[logicalId] = {
        Type: objDef.cfnType,
        ...(Object.keys(properties).length > 0 ? { Properties: properties } : {}),
      };
    }
  }

  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Resources: cfnResources,
  };
}

/**
 * Run the static full/faithfulness check on the functor and route each finding
 * to the diagnostic sink (default `console.warn`). Warnings only — a leaky
 * functor still compiles; the point is that it no longer does so silently.
 */
function reportFaithfulness(G: Functor, onDiagnostic?: (message: string) => void): void {
  const sink = onDiagnostic ?? (msg => console.warn(msg));
  const report = checkFullyFaithful(G);
  if (report.full && report.faithful) return;

  sink(
    `warning: functor G: D → C is not fully faithful (checked to path depth ${report.boundedBy}). ` +
      `The generated template may lose or duplicate instance data with no further error:`,
  );
  for (const line of formatFullFaithfulReport(report)) {
    sink('  ' + line);
  }
}

/**
 * Build the sets for the instance from abstract resources.
 *
 * For each object in D:
 * - If it's a resource type that matches an abstract resource, populate with element IDs
 * - If it's a value type used by a resource property, populate with the values
 * - If it's a Toggle, populate with ['*'] or [] based on the property value
 */
function buildSets(
  schema: ParsedSchema,
  template: AbstractTemplate,
): Record<string, any[]> {
  const sets: Record<string, any[]> = {};

  // Initialize all objects: toggles default to ON, others empty
  for (const objName of schema.simplified.categorySpec.objects) {
    const objDef = schema.simplified.objects.get(objName);
    if (objDef?.valueType === 'Toggle') {
      // Check if user explicitly toggled it off
      const toggleValue = template.toggles[objName];
      sets[objName] = (toggleValue === false) ? [] : ['*'];
    } else {
      sets[objName] = [];
    }
  }

  // Process each abstract resource
  for (const resource of template.resources) {
    // Find which simplified object this resource type maps to
    const objName = findObjectForType(schema, resource.type);
    if (!objName) {
      throw new Error(`Unknown resource type "${resource.type}" in template`);
    }

    if (!sets[objName].includes(resource.logicalId)) {
      sets[objName].push(resource.logicalId);
    }

    // Populate value objects from properties
    const objDef = schema.simplified.objects.get(objName)!;
    if (objDef.properties) {
      for (const [propName, propDef] of Object.entries(objDef.properties)) {
        const targetMorphism = propDef.source;
        if (!targetMorphism) continue;

        // Find the target object of this morphism
        const morphism = schema.simplified.categorySpec.morphisms.find(
          m => m.name === targetMorphism,
        );
        if (!morphism) continue;

        const targetObj = morphism.target;
        const value = resource.properties[propName];

        if (value === undefined) continue;

        const targetObjDef = schema.simplified.objects.get(targetObj);
        if (targetObjDef?.valueType === 'Toggle') {
          // Boolean toggles: true → ['*'], false → []
          sets[targetObj] = value ? ['*'] : [];
        } else {
          // Value types: add to set if not already present
          if (!sets[targetObj].includes(value)) {
            sets[targetObj].push(value);
          }
        }
      }
    }
  }

  return sets;
}

/**
 * Build the morphism functions from the abstract resources.
 */
function buildFunctions(
  schema: ParsedSchema,
  template: AbstractTemplate,
  sets: Record<string, any[]>,
): Record<string, (x: any) => any> {
  const functions: Record<string, (x: any) => any> = {};

  for (const morphism of schema.simplified.categorySpec.morphisms) {
    const sourceObj = findObjectForType(schema, getTypeForObject(schema, morphism.source));
    if (!sourceObj) {
      // Morphism from a non-resource object — identity or constant
      functions[morphism.name] = (x: any) => x;
      continue;
    }

    // Find which property this morphism corresponds to
    const objDef = schema.simplified.objects.get(morphism.source);
    let propertyName: string | undefined;
    if (objDef?.properties) {
      for (const [pName, pDef] of Object.entries(objDef.properties)) {
        if (pDef.source === morphism.name) {
          propertyName = pName;
          break;
        }
      }
    }

    if (propertyName) {
      // The function maps each resource element to its property value
      functions[morphism.name] = (resourceId: any) => {
        const resource = template.resources.find(r => r.logicalId === resourceId);
        if (!resource) return sets[morphism.target][0];
        const value = resource.properties[propertyName!];
        if (value === undefined) return sets[morphism.target][0];
        if (schema.simplified.objects.get(morphism.target)?.valueType === 'Toggle') {
          return value ? '*' : sets[morphism.target][0];
        }
        return value;
      };
    } else {
      // No property maps to this morphism — use first element as default
      functions[morphism.name] = (_x: any) => sets[morphism.target][0];
    }
  }

  return functions;
}

/**
 * Render properties for a generated CFN resource.
 */
function renderProperties(
  objDef: ObjectDef,
  family: Map<string, any>,
  elementIndex: number,
  result: any,
  schema: ParsedSchema,
  C: Category,
): Record<string, any> {
  const properties: Record<string, any> = {};

  if (!objDef.properties) return properties;

  for (const [propName, propDef] of Object.entries(objDef.properties)) {
    if (propDef.default) {
      properties[propName] = propDef.default;
      continue;
    }

    if (propDef.source) {
      // Find the morphism and resolve the reference
      const morphism = C.morphisms.get(propDef.source);
      if (!morphism) continue;

      const targetObj = schema.original.objects.get(morphism.target);
      if (!targetObj) continue;

      if (targetObj.valueType) {
        // Value type — extract the actual value from the family
        const value = resolveValue(propDef.source, family, result, morphism.target);
        if (value !== undefined) {
          properties[propName] = value;
        }
      } else if (targetObj.cfnType) {
        // Resource reference — produce Ref or Fn::GetAtt
        const targetIdx = result.instance.applyMorphism(propDef.source, elementIndex);
        const targetElements = result.objects[morphism.target].elements;
        const targetLogicalId = targetElements.length === 1
          ? morphism.target
          : `${morphism.target}${targetIdx}`;
        properties[propName] = renderReference(targetLogicalId, propDef.via);
      }
    }
  }

  return properties;
}

/**
 * Resolve a value from the family data or the instance.
 *
 * Family keys are "d:path" where d is an object in D (simplified schema) and
 * path is a comma-joined sequence of C morphisms from c to G(d). We match by
 * finding an entry whose path begins with the morphism we're resolving.
 */
function resolveValue(
  morphismName: string,
  family: Map<string, any>,
  result: any,
  targetObject: string,
): any {
  // Primary: find a family entry whose path is exactly the morphism (most common case)
  for (const [key, value] of family) {
    const pathPart = key.split(':')[1] ?? '';
    if (pathPart === morphismName) {
      return value;
    }
  }
  // Secondary: match by C-level target object prefix (legacy single-hop compatibility)
  for (const [key, value] of family) {
    if (key.startsWith(`${targetObject}:`)) {
      return value;
    }
  }
  // Fallback: look in the target object's elements
  const elements = result.objects[targetObject]?.elements;
  if (elements && elements.length > 0) {
    return elements[0];
  }
  return undefined;
}

/**
 * Render a reference to a target resource as either { Ref } or { "Fn::GetAtt" }.
 *
 * Via syntax:
 *   undefined or "Ref"       → { "Ref": logicalId }
 *   "GetAtt.AttrName"        → { "Fn::GetAtt": [logicalId, "AttrName"] }
 *   "GetAtt.Attr1.Attr2"    → { "Fn::GetAtt": [logicalId, "Attr1.Attr2"] }
 */
function renderReference(logicalId: string, via: string | undefined): any {
  if (!via || via === 'Ref') {
    return { Ref: logicalId };
  }

  if (via.startsWith('GetAtt.')) {
    const attribute = via.slice('GetAtt.'.length);
    return { 'Fn::GetAtt': [logicalId, attribute] };
  }

  throw new Error(`Invalid Via annotation: "${via}". Expected "Ref" or "GetAtt.<AttributeName>"`);
}

function findObjectForType(schema: ParsedSchema, type: string | undefined): string | undefined {
  if (!type) return undefined;
  for (const [name, def] of schema.simplified.objects) {
    if ((def as any).type === type) return name;
  }
  return undefined;
}

function getTypeForObject(schema: ParsedSchema, objName: string): string | undefined {
  const def = schema.simplified.objects.get(objName);
  return (def as any)?.type;
}
