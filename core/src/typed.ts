import { Category, CategorySpec, Path } from './category';
import { Functor } from './functor';
import { Instance } from './instance';
import { inspectKan, KanResult } from './kan';

/**
 * Type-level extraction of object names from a const schema spec.
 */
type ObjectNames<S extends CategorySpec> = S['objects'][number];

/**
 * Type-level extraction of morphism specs from a const schema spec.
 */
type MorphismSpecs<S extends CategorySpec> = S['morphisms'][number];

/**
 * Extract the morphism names from a schema.
 */
type MorphismNames<S extends CategorySpec> = MorphismSpecs<S>['name'];

/**
 * Find the source object of a morphism by name.
 */
type SourceOf<S extends CategorySpec, M extends string> =
  Extract<MorphismSpecs<S>, { name: M }>['source'];

/**
 * Find the target object of a morphism by name.
 */
type TargetOf<S extends CategorySpec, M extends string> =
  Extract<MorphismSpecs<S>, { name: M }>['target'];

/**
 * The element type mapping: user declares what type each object's elements have.
 */
export type ElementTypes<S extends CategorySpec> = {
  [K in ObjectNames<S>]: unknown;
};

/**
 * The sets the user must provide: one array per object, typed to its element type.
 */
type InstanceSets<S extends CategorySpec, E extends ElementTypes<S>> = {
  [K in ObjectNames<S>]: E[K][];
};

/**
 * The functions the user must provide: one per morphism, correctly typed.
 */
type InstanceFunctions<S extends CategorySpec, E extends ElementTypes<S>> = {
  [M in MorphismNames<S>]: (x: E[SourceOf<S, M>]) => E[TargetOf<S, M>];
};

/**
 * Functor spec where object/morphism mappings are constrained by both schemas.
 */
type TypedFunctorSpec<D extends CategorySpec, C extends CategorySpec> = {
  onObjects: { [K in ObjectNames<D>]: ObjectNames<C> };
  onMorphisms: { [M in MorphismNames<D>]: Path };
};

/**
 * Render context with typed family access.
 */
export interface TypedRenderContext<
  C extends CategorySpec,
  E extends ElementTypes<C>,
  Obj extends ObjectNames<C>,
> {
  object: Obj;
  index: number;
  family: Map<string, any>;
  refs: {
    [M in MorphismNames<C> as SourceOf<C, M> extends Obj ? M : never]: {
      index: number;
      family: Map<string, any>;
    };
  };
}

/**
 * A typed pattern: compile-time enforcement of schema constraints.
 */
export class TypedPattern<
  D extends CategorySpec,
  C extends CategorySpec,
  DE extends ElementTypes<D>,
  CE extends ElementTypes<C>,
> {
  readonly real: Category;
  readonly simplified: Category;
  readonly functor: Functor;

  constructor(
    readonly realSpec: C,
    readonly simplifiedSpec: D,
    readonly functorSpec: TypedFunctorSpec<D, C>,
    private readonly _deMarker?: DE,
    private readonly _ceMarker?: CE,
  ) {
    this.simplified = new Category(simplifiedSpec as CategorySpec);
    this.real = new Category(realSpec as CategorySpec);
    this.functor = new Functor(this.simplified, this.real, functorSpec);
  }

  instantiate(
    sets: InstanceSets<D, DE>,
    functions: InstanceFunctions<D, DE>,
  ): TypedPatternInstance<D, C, DE, CE> {
    const instance = new Instance(
      this.simplified,
      sets as Record<string, any[]>,
      functions as Record<string, (x: any) => any>,
    );
    return new TypedPatternInstance(this, instance);
  }
}

export class TypedPatternInstance<
  D extends CategorySpec,
  C extends CategorySpec,
  DE extends ElementTypes<D>,
  CE extends ElementTypes<C>,
> {
  constructor(
    private readonly pattern: TypedPattern<D, C, DE, CE>,
    private readonly input: Instance,
  ) {}

  expand(): TypedSkeleton<C, CE> {
    const result = inspectKan(this.pattern.functor, this.input);
    return new TypedSkeleton(this.pattern.real, this.pattern.realSpec, result);
  }
}

export type TypedRenderCallbacks<C extends CategorySpec, CE extends ElementTypes<C>> = {
  [K in ObjectNames<C>]?: (ctx: TypedRenderContext<C, CE, K>) => any;
};

export class TypedSkeleton<C extends CategorySpec, CE extends ElementTypes<C>> {
  constructor(
    private readonly category: Category,
    private readonly spec: C,
    private readonly kanResult: KanResult,
  ) {}

  counts(): { [K in ObjectNames<C>]: number } {
    const result: Record<string, number> = {};
    for (const c of this.category.objects) {
      result[c] = this.kanResult.objects[c].elements.length;
    }
    return result as { [K in ObjectNames<C>]: number };
  }

  familiesFor<K extends ObjectNames<C>>(object: K): Map<string, any>[] {
    return this.kanResult.objects[object as string].families;
  }

  render(callbacks: TypedRenderCallbacks<C, CE>): any[] {
    const results: any[] = [];
    const instance = this.kanResult.instance;

    for (const c of this.category.objects) {
      const callback = (callbacks as Record<string, Function>)[c];
      if (!callback) continue;

      const families = this.kanResult.objects[c].families;
      const elements = this.kanResult.objects[c].elements;

      for (let i = 0; i < elements.length; i++) {
        const refs: Record<string, { index: number; family: Map<string, any> }> = {};

        for (const m of this.category.morphisms.values()) {
          if (m.source !== c) continue;
          const targetIdx = instance.applyMorphism(m.name, i);
          refs[m.name] = {
            index: targetIdx,
            family: this.kanResult.objects[m.target].families[targetIdx] ?? new Map(),
          };
        }

        const ctx = {
          object: c,
          index: i,
          family: families[i],
          refs,
        };

        const rendered = callback(ctx);
        if (rendered !== null && rendered !== undefined) {
          results.push(rendered);
        }
      }
    }

    return results;
  }
}

/**
 * Builder for constructing typed patterns with inference.
 */
export function defineSchema<const S extends CategorySpec>(spec: S): S {
  return spec;
}

export function definePattern<
  const D extends CategorySpec,
  const C extends CategorySpec,
  DE extends ElementTypes<D>,
  CE extends ElementTypes<C>,
>(config: {
  real: C;
  simplified: D;
  functor: TypedFunctorSpec<D, C>;
  elements?: { simplified: DE; real: CE };
}): TypedPattern<D, C, DE, CE> {
  return new TypedPattern(
    config.real,
    config.simplified,
    config.functor,
    undefined as unknown as DE,
    undefined as unknown as CE,
  );
}
