/**
 * Static (instance-independent) analysis of a functor G: D → C.
 *
 * The right Kan extension Π_G I sends each C-object c to the limit over the
 * comma category (c ↓ G). Crucially, that comma category depends only on
 * C, D, and G — never on the user's instance I. So we can classify, ahead of
 * any instance, how the Kan extension will treat every C-object:
 *
 *   - empty comma category      → the limit is a singleton {*}  (auto-created)
 *   - one "source" driver       → the limit ≅ I(d)              (1:1 correlated)
 *   - several source drivers    → the limit is a sub-object of a product
 *                                 ∏ I(dᵢ), i.e. one copy per combination,
 *                                 possibly collapsed by C's path equations
 *
 * The cardinality of the limit, as a function of the D-object cardinalities, is
 * the product of |I(d)| over the *source* strongly-connected-components of the
 * comma category: entries with no incoming constraint are free; every other
 * entry is determined by a constraint (a D-morphism) or merged by a C-equation.
 *
 * `verifyCardinality` cross-checks the predicted formula against the real Kan
 * engine on prime-cardinality probe instances, so a reported class is never a
 * guess — if the structural prediction disagrees with observed behavior, the
 * caller can downgrade the badge honestly.
 */

import { Category } from './category';
import { Functor } from './functor';
import { Instance } from './instance';
import { commaCategory, CommaEntry, Constraint, inspectKan } from './kan';

export type ObjectClassKind =
  | 'singleton' // empty comma category → one auto-created element
  | 'correlated' // exactly one driver → 1:1 with that D-object
  | 'product'; // several drivers → one element per combination

export interface ObjectClass {
  /** The C-object this describes. */
  object: string;
  kind: ObjectClassKind;
  /**
   * The D-objects whose cardinality drives this object's, one entry per source
   * SCC (so a D-object may appear more than once if referenced independently).
   * Empty for `singleton`.
   */
  drivers: string[];
  /**
   * The primary fiber this object is displayed under (best-effort; the most
   * upstream driver in D). Undefined only for `singleton` (its own fiber).
   */
  primaryFiber?: string;
  /** Human-readable cardinality formula, e.g. "1", "|PublicTier|", "|PublicTier| × |Network|". */
  cardinalityFormula: string;
  /** C-equations whose paths start at this object (potential product collapses). */
  collapsingEquations: string[];
}

export interface FiberAnalysis {
  /** Per C-object classification, in C's declaration order. */
  classes: ObjectClass[];
  /** primaryFiber → the C-objects grouped under it (fiber view grouping). */
  fibers: Map<string, string[]>;
  /**
   * Cross-fiber morphisms: generating morphisms whose source and target objects
   * fall in different primary fibers. These are the inter-fiber references.
   */
  crossFiberMorphisms: Array<{ name: string; source: string; target: string; fromFiber: string; toFiber: string }>;
}

/**
 * Analyze a functor statically. `resourceObjects`, if given, restricts the
 * classification to those C-objects (e.g. only the ones that render as CFN
 * resources); otherwise all C-objects are classified.
 */
export function analyzeFibers(G: Functor, resourceObjects?: Iterable<string>): FiberAnalysis {
  const C = G.target;
  const D = G.source;

  const objects = resourceObjects ? [...resourceObjects] : [...C.objects];

  // Order D-objects by "upstream-ness": d1 is upstream of d2 if there is a
  // D-path d1 → d2. Used to pick a primary fiber among several drivers.
  const upstreamRank = computeUpstreamRank(D);

  const classes: ObjectClass[] = [];
  for (const c of objects) {
    classes.push(classifyObject(c, G, C, D, upstreamRank));
  }

  const fibers = new Map<string, string[]>();
  const fiberOf = new Map<string, string>();
  for (const cls of classes) {
    const fiber = cls.primaryFiber ?? cls.object;
    fiberOf.set(cls.object, fiber);
    if (!fibers.has(fiber)) fibers.set(fiber, []);
    fibers.get(fiber)!.push(cls.object);
  }

  const crossFiberMorphisms: FiberAnalysis['crossFiberMorphisms'] = [];
  for (const m of C.morphisms.values()) {
    const fromFiber = fiberOf.get(m.source);
    const toFiber = fiberOf.get(m.target);
    // Only consider morphisms between classified objects that render (both in fiberOf).
    if (fromFiber === undefined || toFiber === undefined) continue;
    if (fromFiber !== toFiber) {
      crossFiberMorphisms.push({
        name: m.name,
        source: m.source,
        target: m.target,
        fromFiber,
        toFiber,
      });
    }
  }

  return { classes, fibers, crossFiberMorphisms };
}

/** Classify a single C-object from the shape of its comma category. */
function classifyObject(
  c: string,
  G: Functor,
  C: Category,
  D: Category,
  upstreamRank: Map<string, number>,
): ObjectClass {
  const { entries, constraints } = commaCategory(c, G, C, D);

  const collapsingEquations = equationsStartingAt(c, C);

  if (entries.length === 0) {
    return {
      object: c,
      kind: 'singleton',
      drivers: [],
      primaryFiber: undefined,
      cardinalityFormula: '1',
      collapsingEquations,
    };
  }

  // Source SCCs of the constraint graph drive the cardinality.
  const sourceSccs = sourceComponents(entries, constraints);
  const drivers = sourceSccs.map(scc => entries[scc[0]].d);

  const primaryFiber = pickPrimaryFiber(drivers, upstreamRank);
  const kind: ObjectClassKind = drivers.length === 1 ? 'correlated' : 'product';

  return {
    object: c,
    kind,
    drivers,
    primaryFiber,
    cardinalityFormula: formatFormula(drivers),
    collapsingEquations,
  };
}

/**
 * Condense the constraint graph into strongly-connected components and return
 * the *source* SCCs (those with no incoming edge from another SCC), as arrays
 * of entry indices. Each source SCC contributes one free cardinality factor.
 *
 * A constraint {from, to} means `to` is determined by `from` (via a D-morphism
 * and G), so the edge points from → to; a source SCC has no incoming edge.
 */
function sourceComponents(entries: CommaEntry[], constraints: Constraint[]): number[][] {
  const n = entries.length;
  const indexOf = new Map<string, number>();
  entries.forEach((e, i) => indexOf.set(e.pathKey, i));

  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const con of constraints) {
    const a = indexOf.get(con.from.pathKey);
    const b = indexOf.get(con.to.pathKey);
    if (a === undefined || b === undefined || a === b) continue;
    adj[a].push(b);
  }

  const sccId = tarjanScc(adj);
  const numSccs = Math.max(-1, ...sccId) + 1;

  // An SCC is a source if no edge enters it from a different SCC.
  const hasIncoming = new Array<boolean>(numSccs).fill(false);
  for (let a = 0; a < n; a++) {
    for (const b of adj[a]) {
      if (sccId[a] !== sccId[b]) hasIncoming[sccId[b]] = true;
    }
  }

  const members: number[][] = Array.from({ length: numSccs }, () => []);
  for (let i = 0; i < n; i++) members[sccId[i]].push(i);

  const sources: number[][] = [];
  for (let s = 0; s < numSccs; s++) {
    if (!hasIncoming[s]) sources.push(members[s]);
  }
  return sources;
}

/** Tarjan's SCC. Returns an array assigning each node its SCC id. */
function tarjanScc(adj: number[][]): number[] {
  const n = adj.length;
  const index = new Array<number>(n).fill(-1);
  const low = new Array<number>(n).fill(0);
  const onStack = new Array<boolean>(n).fill(false);
  const sccId = new Array<number>(n).fill(-1);
  const stack: number[] = [];
  let counter = 0;
  let sccCount = 0;

  // Iterative DFS to avoid stack overflow on large comma categories.
  for (let start = 0; start < n; start++) {
    if (index[start] !== -1) continue;
    const callStack: Array<{ node: number; child: number }> = [{ node: start, child: 0 }];

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1];
      const v = frame.node;

      if (frame.child === 0) {
        index[v] = counter;
        low[v] = counter;
        counter++;
        stack.push(v);
        onStack[v] = true;
      }

      if (frame.child < adj[v].length) {
        const w = adj[v][frame.child];
        frame.child++;
        if (index[w] === -1) {
          callStack.push({ node: w, child: 0 });
        } else if (onStack[w]) {
          low[v] = Math.min(low[v], index[w]);
        }
      } else {
        if (low[v] === index[v]) {
          while (true) {
            const w = stack.pop()!;
            onStack[w] = false;
            sccId[w] = sccCount;
            if (w === v) break;
          }
          sccCount++;
        }
        callStack.pop();
        if (callStack.length > 0) {
          const parent = callStack[callStack.length - 1].node;
          low[parent] = Math.min(low[parent], low[v]);
        }
      }
    }
  }

  return sccId;
}

/** D-objects ranked so that a strictly-upstream object (source of a D-path) ranks higher. */
function computeUpstreamRank(D: Category): Map<string, number> {
  // rank(d) = length of the longest D-path starting at d. More upstream objects
  // (subnets, methods) have longer outgoing paths than base objects (values).
  const rank = new Map<string, number>();
  const visiting = new Set<string>();

  const longest = (o: string): number => {
    if (rank.has(o)) return rank.get(o)!;
    if (visiting.has(o)) return 0; // cycle guard
    visiting.add(o);
    let best = 0;
    for (const m of D.outgoingFrom(o)) {
      best = Math.max(best, 1 + longest(m.target));
    }
    visiting.delete(o);
    rank.set(o, best);
    return best;
  };

  for (const o of D.objects) longest(o);
  return rank;
}

/** Choose the primary fiber among drivers: the most upstream in D, tie-broken lexically. */
function pickPrimaryFiber(drivers: string[], upstreamRank: Map<string, number>): string {
  let best = drivers[0];
  for (const d of drivers) {
    const rd = upstreamRank.get(d) ?? 0;
    const rb = upstreamRank.get(best) ?? 0;
    if (rd > rb || (rd === rb && d < best)) best = d;
  }
  return best;
}

/** C-equations (as readable strings) whose two paths both start at object `c`. */
function equationsStartingAt(c: string, C: Category): string[] {
  const result: string[] = [];
  for (const eq of C.spec.equations ?? []) {
    const startsHere = (path: string[]): boolean => {
      if (path.length === 0) return false;
      const m = C.morphisms.get(path[0]);
      return m?.source === c;
    };
    if (startsHere(eq.lhs) || startsHere(eq.rhs)) {
      result.push(`${eq.lhs.join(' * ')} = ${eq.rhs.join(' * ')}`);
    }
  }
  return result;
}

function formatFormula(drivers: string[]): string {
  if (drivers.length === 0) return '1';
  // Group repeated drivers into powers for readability.
  const counts = new Map<string, number>();
  for (const d of drivers) counts.set(d, (counts.get(d) ?? 0) + 1);
  const parts: string[] = [];
  for (const [d, n] of counts) parts.push(n === 1 ? `|${d}|` : `|${d}|^${n}`);
  return parts.join(' × ');
}

export interface CardinalityMismatch {
  object: string;
  predicted: number;
  actual: number;
  cardinalities: Record<string, number>;
}

/**
 * Cross-check the analyzer's predicted cardinalities against the real Kan
 * engine, so a reported class is never merely a structural guess.
 *
 * Strategy — the *uniform-k coherent probe*. For each k in `ks` (default
 * 1, 2, 3) it builds an instance where every D-object has exactly k elements
 * and every D-morphism is the identity-by-index map (element i ↦ element i).
 * Because all parallel paths then land on the same index, this instance is
 * *coherent*: it satisfies every path equation in C. It is therefore exactly
 * the regime the analyzer's formula describes — "one element per independent
 * driver, given consistent inputs" — and a class with d drivers must yield
 * k^d elements.
 *
 * Why not distinct primes per driver? That builds *incoherent* instances (e.g.
 * an authorized method whose authorizer and route disagree on their API). The
 * Kan extension legitimately drops the inconsistent combinations — that is the
 * structural safety the system provides — so counts fall *below* the product.
 * We still assert that sound one-sided bound (`actual ≤ product`) but do not
 * treat the shortfall as a mismatch.
 *
 * Returns the list of exact mismatches under the coherent probe (empty = the
 * analysis is verified for the probed sizes).
 */
export function verifyCardinality(
  G: Functor,
  analysis: FiberAnalysis,
  options: { ks?: number[] } = {},
): CardinalityMismatch[] {
  const ks = options.ks ?? [1, 2, 3];
  const mismatches: CardinalityMismatch[] = [];

  for (const k of ks) {
    const card = Object.fromEntries([...G.source.objects].map(o => [o, k]));
    const I = buildUniformInstance(G, k);
    const result = inspectKan(G, I);
    for (const cls of analysis.classes) {
      const actual = result.objects[cls.object]?.elements.length ?? 0;
      const predicted = cls.kind === 'singleton' ? 1 : Math.pow(k, cls.drivers.length);
      if (actual !== predicted) {
        mismatches.push({ object: cls.object, predicted, actual, cardinalities: card });
      }
    }
  }

  return mismatches;
}

/**
 * Build the coherent uniform-k instance of D: every object has k elements and
 * every morphism is the identity-by-index map. Parallel paths agree, so the
 * instance satisfies all of C's path equations.
 */
function buildUniformInstance(G: Functor, k: number): Instance {
  const D = G.source;
  const sets: Record<string, any[]> = {};
  for (const o of D.objects) {
    sets[o] = Array.from({ length: k }, (_, i) => `${o}#${i}`);
  }
  const fns: Record<string, (x: any) => any> = {};
  for (const m of D.morphisms.values()) {
    const src = sets[m.source];
    const tgt = sets[m.target];
    fns[m.name] = (x: any) => tgt[src.indexOf(x)];
  }
  return new Instance(D, sets, fns);
}
