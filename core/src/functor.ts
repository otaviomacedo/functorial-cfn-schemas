import { Category, Path } from './category';

export interface FunctorSpec {
  onObjects: Record<string, string>;
  onMorphisms: Record<string, Path>;
}

/**
 * A functor G: D → C between finitely-presented categories.
 *
 * Maps objects to objects and generating morphisms to paths (composites of
 * generating morphisms in C).
 */
export class Functor {
  constructor(
    readonly source: Category,
    readonly target: Category,
    readonly spec: FunctorSpec,
  ) {
    this.validate();
  }

  /**
   * Compose this functor (G: D → C) with another (H: D' → D).
   * Returns G∘H: D' → C.
   */
  compose(H: Functor): Functor {
    if (H.target !== this.source) {
      throw new Error(
        'Cannot compose: H.target must be G.source (the intermediate category instance must be shared)'
      );
    }

    const onObjects: Record<string, string> = {};
    for (const [x, hx] of Object.entries(H.spec.onObjects)) {
      onObjects[x] = this.mapObject(hx);
    }

    const onMorphisms: Record<string, Path> = {};
    for (const [m, hPath] of Object.entries(H.spec.onMorphisms)) {
      onMorphisms[m] = this.mapPath(hPath);
    }

    return new Functor(H.source, this.target, { onObjects, onMorphisms });
  }

  mapObject(obj: string): string {
    const result = this.spec.onObjects[obj];
    if (result === undefined) {
      throw new Error(`Functor does not map object "${obj}"`);
    }
    return result;
  }

  mapMorphism(morphismName: string): Path {
    const result = this.spec.onMorphisms[morphismName];
    if (result === undefined) {
      throw new Error(`Functor does not map morphism "${morphismName}"`);
    }
    return result;
  }

  /**
   * Map a path in the source category to a path in the target category.
   * Empty path (identity) maps to empty path.
   */
  mapPath(path: Path): Path {
    if (path.length === 0) return [];
    return path.flatMap(name => this.mapMorphism(name));
  }

  image(): Set<string> {
    return new Set(Object.values(this.spec.onObjects));
  }

  private validate(): void {
    for (const [dObj, cObj] of Object.entries(this.spec.onObjects)) {
      if (!this.source.objects.has(dObj)) {
        throw new Error(`Functor maps unknown source object "${dObj}"`);
      }
      if (!this.target.objects.has(cObj)) {
        throw new Error(`Functor maps "${dObj}" to unknown target object "${cObj}"`);
      }
    }

    for (const dObj of this.source.objects) {
      if (!(dObj in this.spec.onObjects)) {
        throw new Error(`Functor does not map source object "${dObj}"`);
      }
    }

    for (const [mName, cPath] of Object.entries(this.spec.onMorphisms)) {
      const m = this.source.morphisms.get(mName);
      if (!m) {
        throw new Error(`Functor maps unknown source morphism "${mName}"`);
      }

      const expectedSource = this.mapObject(m.source);
      const expectedTarget = this.mapObject(m.target);

      if (cPath.length === 0) {
        if (expectedSource !== expectedTarget) {
          throw new Error(
            `Functor maps "${mName}" to identity, but G(${m.source})="${expectedSource}" ≠ G(${m.target})="${expectedTarget}"`
          );
        }
      } else {
        const actualSource = this.target.pathSource(cPath);
        const actualTarget = this.target.pathTarget(cPath);

        if (actualSource !== expectedSource) {
          throw new Error(
            `Functor: G(${mName}) has source "${actualSource}" but G(${m.source})="${expectedSource}"`
          );
        }
        if (actualTarget !== expectedTarget) {
          throw new Error(
            `Functor: G(${mName}) has target "${actualTarget}" but G(${m.target})="${expectedTarget}"`
          );
        }
      }
    }

    for (const m of this.source.morphisms.values()) {
      if (!(m.name in this.spec.onMorphisms)) {
        throw new Error(`Functor does not map source morphism "${m.name}"`);
      }
    }
  }
}
