/**
 * Macro preprocessor: rewrites an AbstractTemplate by expanding syntactic
 * sugar (array properties, boolean-to-toggle properties) into canonical
 * D-level resource declarations before the categorical machinery runs.
 *
 * Macros are declared by the abstraction author in the schema. They are
 * purely syntactic (pattern-match on shape, not values) and cannot break
 * functoriality — the expanded output is validated against D normally.
 */

import { AbstractTemplate, AbstractResource } from './template-parser';

export interface MacroExpandArray {
  kind: 'array';
  targetType: string;
  elementProperty: string;
  backRef: string;
  forward?: string[];
}

export interface MacroExpandToggle {
  kind: 'toggle';
  toggleName: string;
}

export type MacroRule = MacroExpandArray | MacroExpandToggle;

export interface MacroDeclaration {
  resourceType: string;
  property: string;
  rule: MacroRule;
}

export interface MacroSet {
  declarations: MacroDeclaration[];
}

export function parseMacros(raw: any, resourceTypes: string[]): MacroSet {
  if (!raw) return { declarations: [] };

  const declarations: MacroDeclaration[] = [];

  for (const [key, def] of Object.entries(raw)) {
    const dotIdx = key.indexOf('.');
    if (dotIdx === -1) {
      throw new Error(`Macro key must be "ResourceType.Property", got "${key}"`);
    }

    const resourceType = key.slice(0, dotIdx);
    const property = key.slice(dotIdx + 1);

    if (!resourceTypes.includes(resourceType)) {
      throw new Error(
        `Macro references unknown resource type "${resourceType}"`
      );
    }

    const d = def as any;

    if (d.ExpandsTo) {
      declarations.push({
        resourceType,
        property,
        rule: {
          kind: 'array',
          targetType: d.ExpandsTo,
          elementProperty: d.ElementProperty,
          backRef: d.BackRef,
          forward: d.Forward,
        },
      });
    } else if (d.Toggle) {
      declarations.push({
        resourceType,
        property,
        rule: {
          kind: 'toggle',
          toggleName: d.Toggle,
        },
      });
    } else {
      throw new Error(
        `Macro "${key}" must have either "ExpandsTo" (array expansion) or "Toggle" (toggle expansion)`
      );
    }
  }

  return { declarations };
}

/**
 * Apply all macros to an abstract template, returning a rewritten template
 * with synthetic properties consumed and expanded resources/toggles added.
 */
export function applyMacros(macros: MacroSet, template: AbstractTemplate): AbstractTemplate {
  if (macros.declarations.length === 0) return template;

  const expandedResources: AbstractResource[] = [];
  const expandedToggles: Record<string, boolean> = { ...template.toggles };

  for (const resource of template.resources) {
    const applicableMacros = macros.declarations.filter(
      m => m.resourceType === resource.type
    );

    if (applicableMacros.length === 0) {
      expandedResources.push(resource);
      continue;
    }

    const remainingProperties = { ...resource.properties };

    for (const macro of applicableMacros) {
      const value = remainingProperties[macro.property];
      delete remainingProperties[macro.property];

      if (value === undefined) continue;

      if (macro.rule.kind === 'array') {
        const items = Array.isArray(value) ? value : [value];
        for (const item of items) {
          const childProps: Record<string, any> = {};

          if (typeof item === 'object' && item !== null) {
            Object.assign(childProps, item);
          } else {
            childProps[macro.rule.elementProperty] = item;
          }

          childProps[macro.rule.backRef] = resource.logicalId;

          if (macro.rule.forward) {
            for (const fwdProp of macro.rule.forward) {
              if (resource.properties[fwdProp] !== undefined) {
                childProps[fwdProp] = resource.properties[fwdProp];
              }
            }
          }

          const childId = generateLogicalId(resource.logicalId, macro.rule, item);

          expandedResources.push({
            logicalId: childId,
            type: macro.rule.targetType,
            properties: childProps,
          });
        }
      } else if (macro.rule.kind === 'toggle') {
        expandedToggles[macro.rule.toggleName] = !!value;
      }
    }

    expandedResources.push({
      logicalId: resource.logicalId,
      type: resource.type,
      properties: remainingProperties,
    });
  }

  return {
    schemaPath: template.schemaPath,
    resources: expandedResources,
    toggles: expandedToggles,
  };
}

function generateLogicalId(
  parentId: string,
  rule: MacroExpandArray,
  item: any,
): string {
  if (typeof item === 'string') {
    const sanitized = item.replace(/[^a-zA-Z0-9]/g, '');
    return `${parentId}${capitalize(sanitized)}`;
  }
  if (typeof item === 'object' && item !== null) {
    const nameValue = item[rule.elementProperty];
    if (typeof nameValue === 'string') {
      const sanitized = nameValue.replace(/[^a-zA-Z0-9]/g, '');
      return `${parentId}${capitalize(sanitized)}`;
    }
  }
  return `${parentId}${capitalize(rule.elementProperty)}`;
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s[0].toUpperCase() + s.slice(1);
}