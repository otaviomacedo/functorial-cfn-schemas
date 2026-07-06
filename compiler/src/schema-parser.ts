import { CategorySpec, GeneratingMorphism, PathEquation, Category, Functor } from '../../core/src';

export interface ObjectDef {
  name: string;
  cfnType?: string;
  valueType?: string;
  properties?: Record<string, PropertyDef>;
}

export interface PropertyDef {
  source?: string;
  default?: string;
  via?: string; // "Ref" (default), "GetAtt.AttributeName", or "GetAtt.Attr1.Attr2"
}

export interface ParsedSchema {
  original: {
    categorySpec: CategorySpec;
    objects: Map<string, ObjectDef>;
  };
  simplified: {
    categorySpec: CategorySpec;
    objects: Map<string, ObjectDef>;
    resourceType: Map<string, string>; // Type string → object name
  };
  functor: {
    onObjects: Record<string, string>;
    onMorphisms: Record<string, string[]>;
  };
  /**
   * Intermediate layers in a multi-hop chain (outermost first).
   * Empty for single-hop schemas.
   */
  layers?: ParsedSchema[];
}

/**
 * Parse a schema that imports another schema, composing functors.
 *
 * The child schema defines a SimplifiedSchema with a Functor into the
 * parent's SimplifiedSchema. The result has the child's SimplifiedSchema
 * and the parent's OriginalSchema, with functors composed.
 */
export function parseSchemaWithImport(childRaw: any, parentSchema: ParsedSchema): ParsedSchema {
  const simp = childRaw.SimplifiedSchema;

  const simplifiedObjects = parseObjects(simp.Objects);
  const simplifiedMorphisms = parseMorphisms(simp.Morphisms);
  const inlinedSimplified = desugarInlineMorphisms(simplifiedObjects, simplifiedMorphisms, simp.Objects);
  const simplifiedEquations = parseEquations(simp.Equations);

  const functorObjects = simp.Functor.Objects as Record<string, string>;
  const functorMorphisms: Record<string, string[]> = {};
  if (simp.Functor.Morphisms) {
    for (const [name, pathStr] of Object.entries(simp.Functor.Morphisms)) {
      functorMorphisms[name] = parsePath(pathStr as string);
    }
  }

  const resourceType = new Map<string, string>();
  for (const obj of simplifiedObjects.values()) {
    const typeStr = (obj as any).type;
    if (typeStr) {
      resourceType.set(typeStr, obj.name);
    }
  }

  // Build the intermediate category (parent's simplified) and compose functors.
  const parentD = new Category(parentSchema.simplified.categorySpec);
  const C = new Category(parentSchema.original.categorySpec);
  const G = new Functor(parentD, C, parentSchema.functor);

  const childD = new Category({
    objects: [...simplifiedObjects.keys()],
    morphisms: inlinedSimplified,
    equations: simplifiedEquations,
  });
  const H = new Functor(childD, parentD, { onObjects: functorObjects, onMorphisms: functorMorphisms });

  const composed = G.compose(H);

  return {
    original: parentSchema.original,
    simplified: {
      categorySpec: {
        objects: [...simplifiedObjects.keys()],
        morphisms: inlinedSimplified,
        equations: simplifiedEquations,
      },
      objects: simplifiedObjects,
      resourceType,
    },
    functor: {
      onObjects: composed.spec.onObjects,
      onMorphisms: composed.spec.onMorphisms,
    },
    layers: [
      { ...parentSchema, layers: undefined },
      ...(parentSchema.layers ?? []),
    ],
  };
}

export function parseSchema(raw: any): ParsedSchema {
  const orig = raw.OriginalSchema;
  const simp = raw.SimplifiedSchema;

  const originalObjects = parseObjects(orig.Objects);
  const originalMorphisms = parseMorphisms(orig.Morphisms);
  const inlinedOriginal = desugarInlineMorphisms(originalObjects, originalMorphisms, orig.Objects);
  const originalEquations = parseEquations(orig.Equations);

  const simplifiedObjects = parseObjects(simp.Objects);
  const simplifiedMorphisms = parseMorphisms(simp.Morphisms);
  const inlinedSimplified = desugarInlineMorphisms(simplifiedObjects, simplifiedMorphisms, simp.Objects);
  const simplifiedEquations = parseEquations(simp.Equations);

  const functorObjects = simp.Functor.Objects as Record<string, string>;
  const functorMorphisms: Record<string, string[]> = {};
  if (simp.Functor.Morphisms) {
    for (const [name, pathStr] of Object.entries(simp.Functor.Morphisms)) {
      functorMorphisms[name] = parsePath(pathStr as string);
    }
  }

  const resourceType = new Map<string, string>();
  for (const obj of simplifiedObjects.values()) {
    const typeStr = (obj as any).type;
    if (typeStr) {
      resourceType.set(typeStr, obj.name);
    }
  }

  return {
    original: {
      categorySpec: {
        objects: [...originalObjects.keys()],
        morphisms: inlinedOriginal,
        equations: originalEquations,
      },
      objects: originalObjects,
    },
    simplified: {
      categorySpec: {
        objects: [...simplifiedObjects.keys()],
        morphisms: inlinedSimplified,
        equations: simplifiedEquations,
      },
      objects: simplifiedObjects,
      resourceType,
    },
    functor: {
      onObjects: functorObjects,
      onMorphisms: functorMorphisms,
    },
  };
}

function parseObjects(raw: Record<string, any>): Map<string, ObjectDef & { type?: string }> {
  const objects = new Map<string, ObjectDef & { type?: string }>();
  for (const [name, def] of Object.entries(raw)) {
    const obj: ObjectDef & { type?: string } = { name };
    if (def === null) {
      objects.set(name, obj);
      continue;
    }
    if (def.CfnType) obj.cfnType = def.CfnType;
    if (def.ValueType) obj.valueType = def.ValueType;
    if (def.Type) (obj as any).type = def.Type;
    if (def.Properties) {
      obj.properties = {};
      for (const [propName, propDef] of Object.entries(def.Properties)) {
        if (typeof propDef === 'string') {
          obj.properties[propName] = { source: propDef };
        } else if (propDef && typeof propDef === 'object') {
          const pd = propDef as any;
          obj.properties[propName] = {
            source: pd.Source ?? pd.source,
            default: pd.Default ?? pd.default,
            via: pd.Via ?? pd.via,
          };
        }
      }
    }
    objects.set(name, obj);
  }
  return objects;
}

/**
 * Desugar v2 inline morphisms: when a property's `Source` references an object
 * name (rather than a morphism name), generate a morphism and rewrite the property.
 *
 * Also handles the `Structure:` section (structural morphisms not rendered as CFN properties).
 *
 * Returns the complete morphism list (explicit + inferred).
 */
function desugarInlineMorphisms(
  objects: Map<string, ObjectDef & { type?: string }>,
  explicitMorphisms: GeneratingMorphism[],
  rawObjects: Record<string, any>,
): GeneratingMorphism[] {
  const objectNames = new Set(objects.keys());
  const explicitNames = new Set(explicitMorphisms.map(m => m.name));
  const inferred: GeneratingMorphism[] = [];

  for (const [objName, def] of Object.entries(rawObjects)) {
    if (!def || typeof def !== 'object') continue;

    // Process Properties
    const sections: Array<{ key: string; entries: Record<string, any> }> = [];
    if (def.Properties) sections.push({ key: 'Properties', entries: def.Properties });
    if (def.Structure) sections.push({ key: 'Structure', entries: def.Structure });

    for (const section of sections) {
      for (const [propName, propDef] of Object.entries(section.entries)) {
        const sourceValue = typeof propDef === 'string'
          ? propDef
          : (propDef as any)?.Source ?? (propDef as any)?.source;

        if (!sourceValue) continue;

        // Is the source value an object name? If so, it's v2 inline syntax.
        // If it's already a morphism name (exists in explicit morphisms), skip.
        if (objectNames.has(sourceValue) && !explicitNames.has(sourceValue)) {
          const morphismName = `${objName}.${propName}`;

          // Only infer if no explicit morphism already has this name
          if (!explicitNames.has(morphismName)) {
            inferred.push({
              name: morphismName,
              source: objName,
              target: sourceValue,
            });

            // Rewrite the object's property to reference the generated morphism name
            const objDef = objects.get(objName);
            if (objDef?.properties?.[propName]) {
              objDef.properties[propName].source = morphismName;
            }
          }
        }
      }
    }
  }

  return [...explicitMorphisms, ...inferred];
}

function parseMorphisms(raw: Record<string, string> | undefined): GeneratingMorphism[] {
  if (!raw) return [];
  const morphisms: GeneratingMorphism[] = [];
  for (const [name, arrow] of Object.entries(raw)) {
    const match = arrow.match(/^\s*(\w+)\s*->\s*(\w+)\s*$/);
    if (!match) {
      throw new Error(`Invalid morphism syntax: "${name}: ${arrow}". Expected "Source -> Target"`);
    }
    morphisms.push({ name, source: match[1], target: match[2] });
  }
  return morphisms;
}

function parseEquations(raw: string[] | undefined): PathEquation[] {
  if (!raw) return [];
  const equations: PathEquation[] = [];
  for (const eq of raw) {
    const parts = eq.split('=').map(s => s.trim());
    if (parts.length !== 2) {
      throw new Error(`Invalid equation: "${eq}". Expected "path1 = path2"`);
    }
    equations.push({
      lhs: parsePath(parts[0]),
      rhs: parsePath(parts[1]),
    });
  }
  return equations;
}

function parsePath(pathStr: string): string[] {
  // Composition separator is " . " (space-dot-space).
  // If present, split on it (each segment may contain dots, e.g. "Subnet.VpcId").
  // If absent, check whether the string looks like a v1 dot-separated path
  // (all segments are simple identifiers) or a v2 single morphism name.
  if (pathStr.includes(' . ')) {
    return pathStr.split(' . ').map(s => s.trim()).filter(s => s.length > 0);
  }
  // v1 compat: "foo . bar" (already handled above) or "foo.bar" where segments
  // don't contain dots themselves. But v2 morphism names ARE dotted ("Subnet.VpcId").
  // Heuristic: if splitting on "." produces segments that are all simple identifiers
  // AND there are multiple segments AND it doesn't match an Object.Property pattern
  // (which would be exactly 2 segments), this is ambiguous.
  //
  // Resolution: always use " . " for composition. A bare "Subnet.CidrBlock" without
  // spaces is a single morphism name. "subnet_vpc . vpc_cidr" uses v1 underscore names.
  // "subnet_vpc.vpc_cidr" (no spaces) in v1 would never occur — v1 always used ". " or " ."
  //
  // Simple rule: split on " . " only. Otherwise, treat as a single-element path.
  // v1 tests use "subnet_vpc . vpc_cidr" which has the spaces → handled above.
  const trimmed = pathStr.trim();
  if (trimmed.length === 0) return [];
  return [trimmed];
}
