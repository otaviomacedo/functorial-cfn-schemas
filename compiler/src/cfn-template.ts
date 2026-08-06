/**
 * Read a real CloudFormation template and derive its DEPENDENCY flow.
 *
 * This is the bridge from an actual `.json` CFN template (the artifact the RFC
 * embeds `Metadata.Context` into) to the core `DerivedFlow`. Unlike the `.flow`
 * DSL — which is authored against a `.schema`'s idealized C — here C is the
 * template itself: objects are logical IDs, and the dependency edges are read
 * straight out of the intrinsics that wire one resource to another.
 *
 *   Ref: X                      → this resource depends on X
 *   Fn::GetAtt: [X, Attr]       → depends on X
 *   Fn::Sub with ${X} / ${X.A}  → depends on X
 *   DependsOn: X | [X, …]       → depends on X (explicit ordering dep)
 *
 * The derived flow runs dependent → dependency (the reference direction), which
 * is exactly the direction change-safety / mutability propagates: locking a
 * dependent forces its dependencies to be at least as locked. Every edge is a
 * forward traversal, so all are `functional` (no reversal, no fan-out concern).
 *
 * We also surface each resource's `Metadata.Context` block (RFC 0972 vocabulary)
 * so downstream checks can read the authored `mutable` / `must` / … fields.
 */

import { Category, deriveFlow, DerivedFlow, FlowEdgeSpec } from '../../core/src';

/** RFC 0972 `Metadata.Context` fields we care about (others pass through). */
export interface MetadataContext {
  why?: string;
  must?: string[];
  mutable?: string;
  mutability?: Record<string, string>;
  [k: string]: any;
}

export interface CfnResource {
  logicalId: string;
  type: string;
  properties: Record<string, any>;
  dependsOn: string[];
  context?: MetadataContext;
}

export interface CfnTemplateModel {
  resources: Map<string, CfnResource>;
  /** C = the template as a category: objects are logical IDs, arrows are deps. */
  C: Category;
  /** Dependency flow: dependent → dependency, all forward/functional. */
  flow: DerivedFlow;
}

/** Collect the logical IDs a value transitively refers to (Ref/GetAtt/Sub). */
function collectRefs(value: any, out: Set<string>): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const v of value) collectRefs(v, out);
    return;
  }
  if (typeof value !== 'object') return;

  const keys = Object.keys(value);
  if (keys.length === 1) {
    const key = keys[0];
    const arg = value[key];
    if (key === 'Ref') {
      if (typeof arg === 'string') out.add(arg);
      return;
    }
    if (key === 'Fn::GetAtt') {
      // ["LogicalId", "Attr"] or "LogicalId.Attr"
      const id = Array.isArray(arg) ? arg[0] : String(arg).split('.')[0];
      if (typeof id === 'string') out.add(id);
      return;
    }
    if (key === 'Fn::Sub') {
      // "…${X}…${Y.Attr}…" (optionally [template, {vars}]); scan the template.
      const tmpl = Array.isArray(arg) ? arg[0] : arg;
      if (typeof tmpl === 'string') {
        for (const m of tmpl.matchAll(/\$\{([^}]+)\}/g)) {
          const id = m[1].split('.')[0].trim();
          // Skip pseudo-parameters (AWS::Region, …) and Sub-local vars.
          if (id && !id.startsWith('AWS::')) out.add(id);
        }
      }
      if (Array.isArray(arg) && arg[1]) collectRefs(arg[1], out);
      return;
    }
  }
  // Generic object: recurse into every field (other Fn::* included).
  for (const v of Object.values(value)) collectRefs(v, out);
}

/**
 * Parse a CloudFormation template object (already JSON-decoded) into a model
 * with its dependency flow. Only intra-template references become edges; refs
 * to parameters / pseudo-parameters / unknown ids are ignored.
 */
export function modelFromTemplate(template: any): CfnTemplateModel {
  const rawResources = template.Resources ?? {};
  const resources = new Map<string, CfnResource>();

  for (const [logicalId, def] of Object.entries<any>(rawResources)) {
    const dependsOnRaw = def.DependsOn;
    const dependsOn = Array.isArray(dependsOnRaw)
      ? dependsOnRaw
      : dependsOnRaw
        ? [dependsOnRaw]
        : [];
    const context: MetadataContext | undefined = def.Metadata?.Context;
    resources.set(logicalId, {
      logicalId,
      type: def.Type,
      properties: def.Properties ?? {},
      dependsOn,
      context,
    });
  }

  const ids = new Set(resources.keys());

  // Build dependency edges: for each resource, the set of other resources it
  // references (via properties) or explicitly depends on.
  const edges: FlowEdgeSpec[] = [];
  const morphisms: { name: string; source: string; target: string }[] = [];

  for (const res of resources.values()) {
    const deps = new Set<string>();
    collectRefs(res.properties, deps);
    for (const d of res.dependsOn) deps.add(d);
    deps.delete(res.logicalId); // ignore self-references

    for (const dep of deps) {
      if (!ids.has(dep)) continue; // parameter or external — not a resource edge
      const name = `${res.logicalId}->${dep}`;
      morphisms.push({ name, source: res.logicalId, target: dep });
    }
  }

  const C = new Category({
    objects: [...ids],
    morphisms,
  });

  // Each C-morphism is a forward dependency edge in the flow (dependent→dep).
  for (const m of morphisms) {
    edges.push({ name: m.name, zigzag: [{ morphism: m.name, direction: 'forward' }] });
  }

  const flow = deriveFlow(C, { edges });
  return { resources, C, flow };
}
