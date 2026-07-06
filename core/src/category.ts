/**
 * A finitely-presented category: objects, generating morphisms, and path equations.
 *
 * Morphisms are represented as paths (sequences of generating morphisms).
 * Path equations declare that two paths are equal in the category.
 */

export interface GeneratingMorphism {
  name: string;
  source: string;
  target: string;
}

export interface PathEquation {
  lhs: string[];
  rhs: string[];
}

export interface CategorySpec {
  objects: string[];
  morphisms: GeneratingMorphism[];
  equations?: PathEquation[];
}

export type Path = string[];

export class Category {
  readonly objects: ReadonlySet<string>;
  readonly morphisms: ReadonlyMap<string, GeneratingMorphism>;

  private readonly outgoing: Map<string, GeneratingMorphism[]>;
  private readonly equations: PathEquation[];
  private pathCache: Map<string, Path[]> | null = null;

  constructor(readonly spec: CategorySpec) {
    this.objects = new Set(spec.objects);
    this.morphisms = new Map(spec.morphisms.map(m => [m.name, m]));
    this.equations = spec.equations ?? [];

    this.outgoing = new Map();
    for (const obj of spec.objects) {
      this.outgoing.set(obj, []);
    }
    for (const m of spec.morphisms) {
      if (!this.objects.has(m.source)) {
        throw new Error(`Morphism "${m.name}" has unknown source "${m.source}"`);
      }
      if (!this.objects.has(m.target)) {
        throw new Error(`Morphism "${m.name}" has unknown target "${m.target}"`);
      }
      this.outgoing.get(m.source)!.push(m);
    }
  }

  sourceOf(morphismName: string): string {
    const m = this.morphisms.get(morphismName);
    if (!m) throw new Error(`Unknown morphism: ${morphismName}`);
    return m.source;
  }

  targetOf(morphismName: string): string {
    const m = this.morphisms.get(morphismName);
    if (!m) throw new Error(`Unknown morphism: ${morphismName}`);
    return m.target;
  }

  outgoingFrom(object: string): GeneratingMorphism[] {
    return this.outgoing.get(object) ?? [];
  }

  /**
   * Compute the target of a path (sequence of generating morphisms).
   * Validates composability.
   */
  pathTarget(path: Path): string {
    if (path.length === 0) throw new Error('Empty path has no target');
    let current = this.sourceOf(path[0]);
    for (const name of path) {
      const m = this.morphisms.get(name);
      if (!m) throw new Error(`Unknown morphism in path: ${name}`);
      if (m.source !== current) {
        throw new Error(
          `Path not composable: morphism "${name}" has source "${m.source}" but expected "${current}"`
        );
      }
      current = m.target;
    }
    return current;
  }

  pathSource(path: Path): string {
    if (path.length === 0) throw new Error('Empty path has no source');
    return this.sourceOf(path[0]);
  }

  /**
   * Find all directed paths from `source` to `target` (up to path equation equivalence).
   * Returns canonical representatives of each equivalence class.
   *
   * Uses BFS on the generating graph, then quotients by equations.
   */
  allPaths(source: string, target: string, maxDepth: number = 10): Path[] {
    const raw = this.allRawPaths(source, target, maxDepth);
    return this.quotiented(raw);
  }

  /**
   * All raw paths from source to target (before quotienting by equations).
   */
  private allRawPaths(source: string, target: string, maxDepth: number): Path[] {
    const results: Path[] = [];

    if (source === target) {
      results.push([]);
    }

    const queue: Array<{ current: string; path: Path }> = [
      { current: source, path: [] },
    ];

    while (queue.length > 0) {
      const { current, path } = queue.shift()!;
      if (path.length >= maxDepth) continue;

      for (const m of this.outgoingFrom(current)) {
        const extended = [...path, m.name];
        if (m.target === target) {
          results.push(extended);
        }
        if (extended.length < maxDepth) {
          queue.push({ current: m.target, path: extended });
        }
      }
    }

    return results;
  }

  /**
   * Quotient a set of paths by the path equations.
   * Returns one representative per equivalence class.
   */
  private quotiented(paths: Path[]): Path[] {
    if (this.equations.length === 0) return paths;

    const classes: Path[][] = [];
    for (const p of paths) {
      let found = false;
      for (const cls of classes) {
        if (this.pathsEqual(p, cls[0])) {
          cls.push(p);
          found = true;
          break;
        }
      }
      if (!found) {
        classes.push([p]);
      }
    }

    return classes.map(cls => cls[0]);
  }

  /**
   * Check if two paths are equal under the path equations.
   * Uses congruence closure: two paths are equal if one can be rewritten
   * into the other by replacing subpaths using the equations.
   */
  pathsEqual(p1: Path, p2: Path): boolean {
    if (p1.length === 0 && p2.length === 0) return true;

    const key1 = p1.join(',');
    const key2 = p2.join(',');
    if (key1 === key2) return true;

    const reachable = this.rewriteClosure(p1);
    return reachable.has(key2);
  }

  private rewriteClosure(path: Path): Set<string> {
    const visited = new Set<string>();
    const queue = [path];
    visited.add(path.join(','));

    while (queue.length > 0) {
      const current = queue.shift()!;

      for (const eq of this.equations) {
        for (const rewritten of this.applyEquation(current, eq.lhs, eq.rhs)) {
          const key = rewritten.join(',');
          if (!visited.has(key)) {
            visited.add(key);
            queue.push(rewritten);
          }
        }
        for (const rewritten of this.applyEquation(current, eq.rhs, eq.lhs)) {
          const key = rewritten.join(',');
          if (!visited.has(key)) {
            visited.add(key);
            queue.push(rewritten);
          }
        }
      }
    }

    return visited;
  }

  private applyEquation(path: Path, from: Path, to: Path): Path[] {
    const results: Path[] = [];
    for (let i = 0; i <= path.length - from.length; i++) {
      let matches = true;
      for (let j = 0; j < from.length; j++) {
        if (path[i + j] !== from[j]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        const rewritten = [
          ...path.slice(0, i),
          ...to,
          ...path.slice(i + from.length),
        ];
        results.push(rewritten);
      }
    }
    return results;
  }
}
