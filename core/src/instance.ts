import { Category, Path } from './category';

/**
 * An instance I: C → Set.
 *
 * Assigns a set of elements to each object, and a function to each morphism.
 * Elements are represented as opaque values (any).
 */
export class Instance {
  private readonly sets: Map<string, any[]>;
  private readonly functions: Map<string, Map<any, any>>;

  constructor(
    readonly category: Category,
    sets: Record<string, any[]>,
    functions: Record<string, (x: any) => any>,
  ) {
    this.sets = new Map(Object.entries(sets));
    this.functions = new Map();

    for (const obj of category.objects) {
      if (!this.sets.has(obj)) {
        throw new Error(`Instance missing set for object "${obj}"`);
      }
    }

    for (const [mName, fn] of Object.entries(functions)) {
      const m = category.morphisms.get(mName);
      if (!m) {
        throw new Error(`Instance defines function for unknown morphism "${mName}"`);
      }

      const sourceSet = this.sets.get(m.source)!;
      const targetSet = this.sets.get(m.target)!;
      const fnMap = new Map<any, any>();

      for (const elem of sourceSet) {
        const result = fn(elem);
        if (!targetSet.includes(result)) {
          throw new Error(
            `Instance function for "${mName}" maps "${elem}" to "${result}" which is not in the target set for "${m.target}"`
          );
        }
        fnMap.set(elem, result);
      }

      this.functions.set(mName, fnMap);
    }

    for (const m of category.morphisms.values()) {
      if (!this.functions.has(m.name)) {
        throw new Error(`Instance missing function for morphism "${m.name}"`);
      }
    }
  }

  getSet(object: string): any[] {
    const s = this.sets.get(object);
    if (s === undefined) {
      throw new Error(`No set for object "${object}"`);
    }
    return s;
  }

  applyMorphism(morphismName: string, element: any): any {
    const fn = this.functions.get(morphismName);
    if (!fn) {
      throw new Error(`No function for morphism "${morphismName}"`);
    }
    const result = fn.get(element);
    if (result === undefined && !fn.has(element)) {
      throw new Error(
        `Function for "${morphismName}" is not defined on element "${element}"`
      );
    }
    return result;
  }

  /**
   * Apply a path (composite morphism) to an element.
   * Empty path = identity.
   */
  applyPath(path: Path, element: any): any {
    let current = element;
    for (const name of path) {
      current = this.applyMorphism(name, current);
    }
    return current;
  }
}
