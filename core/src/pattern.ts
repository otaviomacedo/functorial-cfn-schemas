import { Category, CategorySpec } from './category';
import { Functor, FunctorSpec } from './functor';
import { Instance } from './instance';
import { rightKan, inspectKan, KanResult } from './kan';

export interface PatternSpec {
  real: CategorySpec;
  simplified: CategorySpec;
  functor: FunctorSpec;
}

export interface RenderContext {
  object: string;
  index: number;
  family: Map<string, any>;
  refs: Record<string, { index: number; family: Map<string, any> }>;
}

export type RenderCallback = (ctx: RenderContext) => any;

/**
 * A Pattern ties together the real schema C, simplified schema D,
 * functor G: D → C, and render callbacks.
 */
export class Pattern {
  readonly real: Category;
  readonly simplified: Category;
  readonly functor: Functor;

  constructor(spec: PatternSpec) {
    this.simplified = new Category(spec.simplified);
    this.real = new Category(spec.real);
    this.functor = new Functor(this.simplified, this.real, spec.functor);
  }

  /**
   * Create an instance of the simplified schema from user-provided data.
   */
  instantiate(
    sets: Record<string, any[]>,
    functions: Record<string, (x: any) => any>,
  ): PatternInstance {
    const instance = new Instance(this.simplified, sets, functions);
    return new PatternInstance(this, instance);
  }
}

export class PatternInstance {
  constructor(
    private readonly pattern: Pattern,
    private readonly input: Instance,
  ) {}

  /**
   * Compute the right Kan extension — expand the user input into a full skeleton.
   */
  expand(): Skeleton {
    const result = inspectKan(this.pattern.functor, this.input);
    return new Skeleton(this.pattern, result);
  }
}

export class Skeleton {
  constructor(
    private readonly pattern: Pattern,
    private readonly kanResult: KanResult,
  ) {}

  /**
   * Get the number of instances of each object type.
   */
  counts(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const c of this.pattern.real.objects) {
      result[c] = this.kanResult.objects[c].elements.length;
    }
    return result;
  }

  /**
   * Get the families (internal data) for a specific object.
   */
  familiesFor(object: string): Map<string, any>[] {
    return this.kanResult.objects[object].families;
  }

  /**
   * Get the morphism mappings.
   */
  morphismMappings(): Record<string, Array<{ from: number; to: number }>> {
    const result: Record<string, Array<{ from: number; to: number }>> = {};
    for (const [name, mappings] of Object.entries(this.kanResult.morphisms)) {
      result[name] = mappings.map(m => ({ from: m.from, to: m.to }));
    }
    return result;
  }

  /**
   * Render the skeleton into concrete output using callbacks.
   */
  render(callbacks: Record<string, RenderCallback>): any[] {
    const results: any[] = [];
    const instance = this.kanResult.instance;

    for (const c of this.pattern.real.objects) {
      const callback = callbacks[c];
      if (!callback) continue;

      const families = this.kanResult.objects[c].families;
      const elements = this.kanResult.objects[c].elements;

      for (let i = 0; i < elements.length; i++) {
        const refs: Record<string, { index: number; family: Map<string, any> }> = {};

        for (const m of this.pattern.real.morphisms.values()) {
          if (m.source !== c) continue;
          const targetIdx = instance.applyMorphism(m.name, i);
          refs[m.name] = {
            index: targetIdx,
            family: this.kanResult.objects[m.target].families[targetIdx] ?? new Map(),
          };
        }

        const ctx: RenderContext = {
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
