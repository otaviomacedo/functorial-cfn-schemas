import { Category, Path } from './category';
import { Functor } from './functor';
import { Instance } from './instance';

/**
 * An entry in the comma category (c ↓ G).
 * Represents a morphism f: c → G(d) in C, indexed by d in D.
 */
export interface CommaEntry {
  d: string;
  path: Path;
  pathKey: string;
}

/**
 * A constraint between two comma entries, induced by a morphism h: d₁ → d₂ in D
 * such that G(h) ∘ f₁ = f₂.
 */
export interface Constraint {
  from: CommaEntry;
  to: CommaEntry;
  morphismInD: string;
}

/**
 * A compatible family: an assignment of one element per comma entry,
 * satisfying all constraints.
 */
type Family = Map<string, any>;

/**
 * Compute the right Kan extension Π_G I.
 *
 * Given G: D → C and I: D → Set, produces an instance of C.
 */
export function rightKan(G: Functor, I: Instance): Instance {
  const C = G.target;
  const D = G.source;

  const resultSets: Record<string, any[]> = {};
  const familiesByObject: Map<string, Family[]> = new Map();

  for (const c of C.objects) {
    const { entries, constraints } = commaCategory(c, G, C, D);
    const families = computeLimit(entries, constraints, I);
    familiesByObject.set(c, families);
    resultSets[c] = families.map((_, i) => i);
  }

  const resultFunctions: Record<string, (x: any) => any> = {};

  for (const m of C.morphisms.values()) {
    const sourceFamilies = familiesByObject.get(m.source)!;
    const targetFamilies = familiesByObject.get(m.target)!;

    resultFunctions[m.name] = (sourceIdx: number) => {
      const sourceFamily = sourceFamilies[sourceIdx];
      const restricted = restrictFamily(sourceFamily, m.name, m.target, G, C, D);
      const targetIdx = findMatchingFamily(restricted, targetFamilies, m.target, G, C, D);
      return targetIdx;
    };
  }

  return new Instance(C, resultSets, resultFunctions);
}

/**
 * Build the comma category (c ↓ G): all morphisms from c to objects in G's image.
 *
 * Exported because it is the instance-independent core of the Kan extension —
 * `fiber-analysis.ts` reuses it to classify each C-object statically.
 */
export function commaCategory(
  c: string,
  G: Functor,
  C: Category,
  D: Category,
): { entries: CommaEntry[]; constraints: Constraint[] } {
  const image = G.image();
  const entries: CommaEntry[] = [];
  const seenKeys = new Set<string>();

  for (const d of D.objects) {
    const gd = G.mapObject(d);
    const paths = C.allPaths(c, gd);

    for (const path of paths) {
      const pathKey = `${d}:${path.join(',')}`;

      // Deduplicate paths that are equal under C's equations
      let isDuplicate = false;
      for (const existing of entries) {
        if (existing.d === d && C.pathsEqual(existing.path, path)) {
          isDuplicate = true;
          break;
        }
      }
      if (isDuplicate) continue;

      entries.push({ d, path, pathKey });
    }
  }

  // Find constraints: for each morphism h: d₁ → d₂ in D,
  // check if G(h) ∘ f₁ = f₂ for any pair of entries.
  const constraints: Constraint[] = [];

  for (const h of D.morphisms.values()) {
    const gh = G.mapMorphism(h.name);

    for (const e1 of entries) {
      if (e1.d !== h.source) continue;

      // The composed path: G(h) appended to e1.path
      const composed = [...e1.path, ...gh];

      for (const e2 of entries) {
        if (e2.d !== h.target) continue;

        if (C.pathsEqual(composed, e2.path)) {
          constraints.push({ from: e1, to: e2, morphismInD: h.name });
        }
      }
    }
  }

  return { entries, constraints };
}

/**
 * Compute the limit of the diagram in Set defined by the comma entries and constraints.
 * Returns all compatible families.
 */
function computeLimit(
  entries: CommaEntry[],
  constraints: Constraint[],
  I: Instance,
): Family[] {
  if (entries.length === 0) {
    // Empty diagram → limit is {*}
    return [new Map()];
  }

  // Check if any entry's set is empty → limit is empty
  for (const entry of entries) {
    if (I.getSet(entry.d).length === 0) {
      return [];
    }
  }

  // Generate all candidate families and filter by constraints.
  // A family assigns to each entry an element of I(entry.d).
  const families: Family[] = [];
  generateFamilies(entries, 0, new Map(), constraints, I, families);
  return families;
}

function generateFamilies(
  entries: CommaEntry[],
  index: number,
  current: Family,
  constraints: Constraint[],
  I: Instance,
  results: Family[],
): void {
  if (index === entries.length) {
    results.push(new Map(current));
    return;
  }

  const entry = entries[index];
  const elements = I.getSet(entry.d);

  for (const elem of elements) {
    current.set(entry.pathKey, elem);

    // Check all constraints involving this entry that can be checked now
    // (both endpoints assigned)
    let valid = true;
    for (const c of constraints) {
      const fromAssigned = current.has(c.from.pathKey);
      const toAssigned = current.has(c.to.pathKey);

      if (fromAssigned && toAssigned) {
        const fromVal = current.get(c.from.pathKey);
        const toVal = current.get(c.to.pathKey);
        const expected = I.applyMorphism(c.morphismInD, fromVal);
        if (expected !== toVal) {
          valid = false;
          break;
        }
      }
    }

    if (valid) {
      generateFamilies(entries, index + 1, current, constraints, I, results);
    }

    current.delete(entry.pathKey);
  }
}

/**
 * Restrict a family along a morphism g: c → c'.
 *
 * Given a family for c, produce the corresponding family for c' by
 * pre-composing each entry's path with g.
 */
function restrictFamily(
  sourceFamily: Family,
  morphismName: string,
  targetObject: string,
  G: Functor,
  C: Category,
  D: Category,
): Family {
  const restricted = new Map<string, any>();
  const { entries: targetEntries } = commaCategory(targetObject, G, C, D);

  for (const tEntry of targetEntries) {
    // The path from c to G(tEntry.d) that corresponds to this target entry
    // is: tEntry.path ∘ morphismName (pre-compose with g)
    const liftedPath = [morphismName, ...tEntry.path];

    // Find the source entry whose path equals this lifted path (under equations)
    const { entries: sourceEntries } = commaCategory(
      C.sourceOf(morphismName),
      G,
      C,
      D,
    );

    for (const sEntry of sourceEntries) {
      if (sEntry.d !== tEntry.d) continue;
      if (C.pathsEqual(sEntry.path, liftedPath)) {
        const val = sourceFamily.get(sEntry.pathKey);
        if (val !== undefined || sourceFamily.has(sEntry.pathKey)) {
          restricted.set(tEntry.pathKey, val);
        }
        break;
      }
    }
  }

  return restricted;
}

/**
 * Find the index of the target family that matches a restricted family.
 */
function findMatchingFamily(
  restricted: Family,
  targetFamilies: Family[],
  targetObject: string,
  G: Functor,
  C: Category,
  D: Category,
): number {
  for (let i = 0; i < targetFamilies.length; i++) {
    const candidate = targetFamilies[i];
    let matches = true;

    for (const [key, val] of restricted) {
      if (candidate.get(key) !== val) {
        matches = false;
        break;
      }
    }

    if (matches) return i;
  }

  throw new Error(
    `No matching family found in target object "${targetObject}" for restricted family`
  );
}

/**
 * Inspect the computed Kan extension in a human-readable format.
 */
export function inspectKan(G: Functor, I: Instance): KanResult {
  const C = G.target;
  const D = G.source;
  const result = rightKan(G, I);

  const objects: Record<string, { elements: any[]; families: Family[] }> = {};

  for (const c of C.objects) {
    const { entries, constraints } = commaCategory(c, G, C, D);
    const families = computeLimit(entries, constraints, I);
    objects[c] = {
      elements: result.getSet(c),
      families,
    };
  }

  const morphisms: Record<string, Array<{ from: any; to: any }>> = {};
  for (const m of C.morphisms.values()) {
    const mappings: Array<{ from: any; to: any }> = [];
    for (const elem of result.getSet(m.source)) {
      mappings.push({ from: elem, to: result.applyMorphism(m.name, elem) });
    }
    morphisms[m.name] = mappings;
  }

  return { objects, morphisms, instance: result };
}

export interface KanResult {
  objects: Record<string, { elements: any[]; families: Family[] }>;
  morphisms: Record<string, Array<{ from: any; to: any }>>;
  instance: Instance;
}
