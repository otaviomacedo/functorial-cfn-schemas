/**
 * Bridge between the functorial skeleton and the CDK construct tree.
 *
 * Design:
 *
 * In CDK, resources are constructs in a tree. Cross-references use tokens
 * (Ref, GetAtt) that resolve lazily at synthesis time. The skeleton provides
 * indices and morphism mappings. This bridge:
 *
 * 1. Expands the pattern into a skeleton.
 * 2. For each element in each object's set, invokes a render callback that
 *    creates a CDK construct. The callback receives resolved references to
 *    constructs created by other objects.
 * 3. Handles ordering: objects are rendered in topological order (targets
 *    before sources), so by the time a Subnet callback runs, the VPC
 *    construct already exists and can be referenced.
 *
 * The integration point is intentionally minimal — it doesn't depend on
 * aws-cdk-lib directly. Instead, it takes factory functions that the
 * consumer provides, closing over their CDK scope.
 */

import { Category } from './category';
import { Functor } from './functor';
import { Instance } from './instance';
import { inspectKan, KanResult } from './kan';

/**
 * The construct registry: maps (objectName, elementIndex) to the
 * construct created for that element. Populated during rendering.
 */
type ConstructRegistry = Map<string, any>;

function registryKey(object: string, index: number): string {
  return `${object}#${index}`;
}

/**
 * What a render callback receives in CDK bridge mode.
 */
export interface CdkRenderContext<TConstruct = any> {
  object: string;
  index: number;
  elementCount: number;
  family: Map<string, any>;
  /**
   * Get the construct created for a referenced object.
   * Key is the morphism name (e.g., 'subnet_vpc' to get the VPC construct
   * that this Subnet references).
   */
  ref: (morphismName: string) => TConstruct;
  /**
   * Get all constructs for a given object type.
   * Useful when you need to reference siblings (e.g., all subnets).
   */
  allOf: (objectName: string) => TConstruct[];
}

export type CdkRenderCallback<TConstruct = any> = (
  ctx: CdkRenderContext<TConstruct>,
) => TConstruct;

export interface CdkBridgeConfig<TConstruct = any> {
  callbacks: Record<string, CdkRenderCallback<TConstruct>>;
  /**
   * Optional: control the logical ID generation for each element.
   * Default: `${objectName}${index}` (e.g., "Subnet0", "NAT2")
   */
  logicalId?: (object: string, index: number, elementCount: number) => string;
  /**
   * Optional: objects to skip rendering (e.g., leaf value types like VpcBlock).
   * These still participate in the skeleton computation but don't produce constructs.
   */
  skip?: string[];
}

/**
 * Render a pattern instance into constructs via the CDK bridge.
 *
 * Returns a map from logical ID to construct, in creation order.
 */
export function renderToCdk<TConstruct = any>(
  functor: Functor,
  input: Instance,
  config: CdkBridgeConfig<TConstruct>,
): Map<string, TConstruct> {
  const C = functor.target;
  const result = inspectKan(functor, input);
  const registry: ConstructRegistry = new Map();
  const output = new Map<string, TConstruct>();
  const skip = new Set(config.skip ?? []);

  const order = topologicalOrder(C);

  for (const objectName of order) {
    if (skip.has(objectName)) continue;
    const callback = config.callbacks[objectName];
    if (!callback) continue;

    const elements = result.objects[objectName].elements;
    const families = result.objects[objectName].families;

    for (let i = 0; i < elements.length; i++) {
      const ctx: CdkRenderContext<TConstruct> = {
        object: objectName,
        index: i,
        elementCount: elements.length,
        family: families[i],

        ref: (morphismName: string) => {
          const targetIdx = result.instance.applyMorphism(morphismName, i);
          const m = C.morphisms.get(morphismName);
          if (!m) throw new Error(`Unknown morphism: ${morphismName}`);
          const key = registryKey(m.target, targetIdx);
          const construct = registry.get(key);
          if (construct === undefined) {
            throw new Error(
              `No construct found for ${m.target}#${targetIdx} (referenced via "${morphismName}" from ${objectName}#${i}). ` +
              `Is "${m.target}" in the skip list?`
            );
          }
          return construct;
        },

        allOf: (objName: string) => {
          const count = result.objects[objName]?.elements.length ?? 0;
          const constructs: TConstruct[] = [];
          for (let j = 0; j < count; j++) {
            const c = registry.get(registryKey(objName, j));
            if (c !== undefined) constructs.push(c);
          }
          return constructs;
        },
      };

      const construct = callback(ctx);
      registry.set(registryKey(objectName, i), construct);

      const logicalId = config.logicalId
        ? config.logicalId(objectName, i, elements.length)
        : elements.length === 1 ? objectName : `${objectName}${i}`;

      output.set(logicalId, construct);
    }
  }

  return output;
}

/**
 * Topological sort of objects in C: targets before sources.
 * An object X comes before Y if there's a morphism Y → X.
 * This ensures referenced constructs are created before referencing ones.
 */
function topologicalOrder(C: Category): string[] {
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, Set<string>>();

  for (const obj of C.objects) {
    inDegree.set(obj, 0);
    dependents.set(obj, new Set());
  }

  for (const m of C.morphisms.values()) {
    // m: source → target means source depends on target
    // So target should come first. We add an edge target → source in the DAG.
    inDegree.set(m.source, (inDegree.get(m.source) ?? 0) + 1);
    dependents.get(m.target)!.add(m.source);
  }

  const queue: string[] = [];
  for (const [obj, deg] of inDegree) {
    if (deg === 0) queue.push(obj);
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const obj = queue.shift()!;
    result.push(obj);
    for (const dep of dependents.get(obj)!) {
      const newDeg = inDegree.get(dep)! - 1;
      inDegree.set(dep, newDeg);
      if (newDeg === 0) queue.push(dep);
    }
  }

  // Handle cycles (shouldn't happen in well-formed schemas, but be safe)
  for (const obj of C.objects) {
    if (!result.includes(obj)) result.push(obj);
  }

  return result;
}
