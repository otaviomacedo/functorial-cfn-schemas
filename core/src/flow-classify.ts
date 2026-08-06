/**
 * GADGET 2: security classification as a functor into a sensitivity lattice.
 *
 * Gadget 1 gave us a `Flow` category (data-flow arrows over C, or over the
 * category of elements ∫I). A *classification* assigns a sensitivity level to
 * every flow object. The clean categorical statement is:
 *
 *     a classification is a FUNCTOR  P: Flow → E
 *
 * where E is a sensitivity lattice presented as a thin poset-category — objects
 * are levels (`public ≤ internal ≤ secret`), and there is a (unique) arrow
 * `x → y` in E iff `x ≤ y`.
 *
 * A functor sends each flow edge `A → B` (data flows A to B) to an arrow
 * `P(A) → P(B)` in E. But an arrow `P(A) → P(B)` EXISTS only when `P(A) ≤ P(B)`.
 * So the labeling extends to a functor iff every flow edge is monotone — data
 * only ever moves to a place at least as sensitive. The failure case is exactly
 * the leak we want to reject:
 *
 *     a secret queue wired to a public bucket  ⟺  a flow edge A→B with
 *     P(A) ⋠ P(B)  ⟺  E has no arrow to receive P(A→B)  ⟺  P is NOT a functor.
 *
 * `checkClassification` decides this. When it passes it MATERIALIZES the functor
 * `P: Flow → E` (via the engine's own `Functor`, whose construction validates
 * endpoints) — so "the classification is sound" is witnessed by an actual
 * functor object, not just a boolean. When it fails it returns the offending
 * edges, each localizing one bad wire.
 *
 * ## Variance / "X can read Y"
 *
 * Flow points in the direction data moves. "X reads Y" means Y's data reaches X,
 * i.e. a flow path Y → X. The monotonicity constraint on that path forces
 * `P(Y) ≤ P(X)`: a public consumer may not read secret data. So the same functor
 * check answers read-permission questions once reads are modelled as flow.
 *
 * ## Relational edges still count
 *
 * The constraint is checked on EVERY flow edge regardless of gadget 1's
 * `functional` verdict: a relational (fan-out) edge still delivers the source's
 * data to the target, so it must still be monotone. `functional` governs whether
 * a label can be *derived* along the edge (gadget 3), not whether a given
 * labeling is *sound* (here). Each violation carries its `functional` flag as
 * provenance — a leak through a relational edge is often the more surprising one.
 */

import { Category } from './category';
import { Functor, FunctorSpec } from './functor';
import { DerivedFlow } from './flow';

/** A covering relation `lo ≤ hi` (a Hasse edge); reflexivity/transitivity implied. */
export interface Cover {
  lo: string;
  hi: string;
}

export interface LatticeSpec {
  levels: string[];
  covers: Cover[];
}

/**
 * A sensitivity lattice as a thin poset-category. Objects are levels; generators
 * are the covering relations. It is thin by intent (a poset: at most one arrow
 * between any two objects), so it needs no thinness equations — the only thing
 * the classification check asks of it is `≤`, which is reachability.
 */
export class Lattice {
  readonly category: Category;

  constructor(readonly spec: LatticeSpec) {
    this.category = new Category({
      objects: spec.levels,
      morphisms: spec.covers.map(c => ({
        name: `le:${c.lo}->${c.hi}`,
        source: c.lo,
        target: c.hi,
      })),
    });

    // Guard: covers must present a partial order, not a preorder with cycles.
    // Two distinct mutually-reachable levels would collapse the poset.
    for (const x of spec.levels) {
      for (const y of spec.levels) {
        if (x !== y && this.leq(x, y) && this.leq(y, x)) {
          throw new Error(
            `Lattice is not a partial order: "${x}" and "${y}" are mutually ≤ (a cycle)`,
          );
        }
      }
    }
  }

  /** Order relation `x ≤ y`: reflexive plus reachability along covers. */
  leq(x: string, y: string, maxDepth = 20): boolean {
    if (!this.category.objects.has(x)) throw new Error(`Unknown level "${x}"`);
    if (!this.category.objects.has(y)) throw new Error(`Unknown level "${y}"`);
    if (x === y) return true;
    return this.category.allPaths(x, y, maxDepth).length > 0;
  }

  /**
   * The join (least upper bound) of a set of levels — the least level ≥ every
   * member. `join([])` is the bottom element (see `bottom`). Used by gadget 3:
   * a node's derived sensitivity is the join of everything that flows into it,
   * which is exactly a lattice-valued colimit (left Kan extension in `Poset`).
   *
   * A mere poset need not have joins; if none exists (no upper bound, or several
   * incomparable minimal ones) we throw — a *security* lattice is expected to be
   * a genuine join-semilattice, so a missing join is a modelling error, not a
   * silently-dropped constraint.
   */
  join(levels: string[]): string {
    if (levels.length === 0) return this.bottom();
    for (const x of levels) {
      if (!this.category.objects.has(x)) throw new Error(`Unknown level "${x}"`);
    }
    // Upper bounds: levels ≥ every member.
    const uppers = [...this.category.objects].filter(u =>
      levels.every(x => this.leq(x, u)),
    );
    if (uppers.length === 0) {
      throw new Error(
        `Levels {${levels.join(', ')}} have no common upper bound — the lattice ` +
          `is not a join-semilattice`,
      );
    }
    // The join is the unique least upper bound: an upper bound below all others.
    const least = uppers.filter(u => uppers.every(v => this.leq(u, v)));
    if (least.length !== 1) {
      throw new Error(
        `Levels {${levels.join(', ')}} have no unique least upper bound ` +
          `(candidates: {${least.join(', ')}}) — the lattice is not a ` +
          `join-semilattice`,
      );
    }
    return least[0];
  }

  /**
   * The bottom element ⊥ (below every level) — the default "no data has reached
   * here yet" seed for propagation. Throws if the poset has no least element.
   */
  bottom(): string {
    const mins = [...this.category.objects].filter(b =>
      [...this.category.objects].every(x => this.leq(b, x)),
    );
    if (mins.length !== 1) {
      throw new Error(
        `Lattice has no unique bottom element (candidates: {${mins.join(', ')}})`,
      );
    }
    return mins[0];
  }
}

/** A per-flow-object level assignment (the object part of P). */
export type Labeling = Record<string, string> | ((flowObject: string) => string);

function resolveLabel(label: Labeling, obj: string): string {
  const level = typeof label === 'function' ? label(obj) : label[obj];
  if (level === undefined) {
    throw new Error(`Classification does not label flow object "${obj}"`);
  }
  return level;
}

/** One flow edge whose endpoints violate monotonicity (P(from) ⋠ P(to)). */
export interface ClassificationViolation {
  /** The flow generator name (the concrete wire). */
  edge: string;
  from: string;
  to: string;
  fromLevel: string;
  toLevel: string;
  /** Gadget-1 provenance: was this a function or a relational (fan-out) edge? */
  functional: boolean;
}

export interface ClassificationReport {
  ok: boolean;
  violations: ClassificationViolation[];
  /**
   * The materialized functor `P: Flow → E`, present iff `ok`. Its existence is
   * the proof that the classification is sound — the engine's `Functor`
   * constructor validated that every flow edge maps to a real arrow of E.
   */
  functor: Functor | null;
}

/**
 * Check whether a labeling extends to a functor `Flow → E`.
 *
 * For each flow generator `A → B`, require `P(A) ≤ P(B)` in E. Collect every
 * failure. If none, build the witnessing functor: each object goes to its level,
 * each edge to a witnessing chain of covers in E (identity when levels coincide).
 */
export function checkClassification(
  flow: DerivedFlow,
  E: Lattice,
  label: Labeling,
  maxDepth = 20,
): ClassificationReport {
  const violations: ClassificationViolation[] = [];

  const onObjects: Record<string, string> = {};
  for (const obj of flow.category.objects) {
    onObjects[obj] = resolveLabel(label, obj);
  }

  const onMorphisms: Record<string, string[]> = {};
  for (const [edge, info] of flow.edgeInfo) {
    const fromLevel = onObjects[info.from];
    const toLevel = onObjects[info.to];

    if (!E.leq(fromLevel, toLevel, maxDepth)) {
      violations.push({
        edge,
        from: info.from,
        to: info.to,
        fromLevel,
        toLevel,
        functional: info.functional,
      });
      continue;
    }

    // Witness the arrow P(A)→P(B) by a chain of covers (empty if same level).
    onMorphisms[edge] =
      fromLevel === toLevel
        ? []
        : E.category.allPaths(fromLevel, toLevel, maxDepth)[0];
  }

  if (violations.length > 0) {
    return { ok: false, violations, functor: null };
  }

  const spec: FunctorSpec = { onObjects, onMorphisms };
  return { ok: true, violations: [], functor: new Functor(flow.category, E.category, spec) };
}

// ---------------------------------------------------------------------------
// GADGET 3: propagate a PARTIAL labeling to the least consistent classification.
//
// Gadget 2 checks a *total* labeling. But an author only wants to state a few
// facts — "this queue is `secret`, that bucket is `public`" — and have the
// engine derive the rest. The least labeling consistent with all flows is the
// LEFT KAN EXTENSION of the partial labeling along the inclusion into Flow,
// valued in the poset E; in `Poset`, that Kan extension is computed by JOINS:
//
//     P(x) = join over everything that flows INTO x  ⊔  the seed lower bound at x
//
// This is a monotone map, so we reach it by least-fixpoint iteration from ⊥
// (Kleene). It always satisfies every flow edge by construction (a target is,
// by definition, ≥ each of its sources). Therefore the ONLY way to fail is an
// upper-bound pin: a node whose derived level exceeds a declared `atMost`
// clearance — a leak no labeling can repair.
//
// Relational (fan-out) edges are exactly where the join has >1 argument: a
// shared queue delivering to two functions taints BOTH, so its level is the
// join of both consumers' contributions. This is the "relational edges force a
// lattice join" consequence of the flow-view being Rel-valued (Kleisli(P)).
// ---------------------------------------------------------------------------

export interface PropagationSeed {
  /**
   * Lower bounds: "data originates here at ≥ this level" (sources, taints).
   * Propagates DOWNSTREAM via joins. Omitted objects seed at ⊥.
   */
  atLeast?: Record<string, string>;
  /**
   * Upper bounds: "this resource may hold ≤ this level" (clearances, sinks).
   * Checked AFTER propagation; a derived level above its pin is a leak.
   */
  atMost?: Record<string, string>;
}

/** A node whose derived (least) level exceeds its declared `atMost` clearance. */
export interface ClearanceViolation {
  object: string;
  /** The least level forced on it by upstream flow. */
  derived: string;
  /** The declared upper bound it blew past. */
  atMost: string;
}

export interface PropagationReport {
  /** True iff every `atMost` clearance holds under the derived labeling. */
  ok: boolean;
  /** The least labeling consistent with all flows and `atLeast` seeds. */
  labeling: Record<string, string>;
  /** Clearance breaches (empty iff `ok`). */
  violations: ClearanceViolation[];
  /**
   * The witnessing functor `Flow → E` for the derived labeling, when `ok`. Built
   * via gadget 2's `checkClassification`, so the derived result is certified by
   * the SAME functor machinery — never a labeling that only "looks" consistent.
   */
  functor: Functor | null;
}

/**
 * Propagate a partial labeling to the least classification consistent with all
 * flows (gadget 3). See the block comment above for the Kan-extension framing.
 *
 * Iterates `P(x) = seedLower(x) ⊔ ⊔_{e: y→x} P(y)` from ⊥ to a fixpoint, then
 * checks upper-bound pins and, on success, materializes the functor via gadget 2.
 */
export function propagateClassification(
  flow: DerivedFlow,
  E: Lattice,
  seed: PropagationSeed,
  maxDepth = 20,
): PropagationReport {
  const bottom = E.bottom();
  const atLeast = seed.atLeast ?? {};
  const atMost = seed.atMost ?? {};

  for (const o of Object.keys(atLeast)) requireLevel(E, atLeast[o]);
  for (const o of Object.keys(atMost)) requireLevel(E, atMost[o]);

  // Incoming edges per object: x ← [sources y with an edge y→x].
  const incoming = new Map<string, string[]>();
  for (const obj of flow.category.objects) incoming.set(obj, []);
  for (const info of flow.edgeInfo.values()) {
    incoming.get(info.to)!.push(info.from);
  }

  // Initialize at the seed lower bound (⊥ where unseeded).
  const level = new Map<string, string>();
  for (const obj of flow.category.objects) {
    level.set(obj, atLeast[obj] ?? bottom);
  }

  // Least fixpoint: monotone, over a finite lattice ⇒ terminates. Flow may have
  // cycles (localization can), so we iterate rather than assume a topo order.
  let changed = true;
  while (changed) {
    changed = false;
    for (const obj of flow.category.objects) {
      const contributions = [
        level.get(obj)!,
        ...incoming.get(obj)!.map(src => level.get(src)!),
      ];
      const next = E.join(contributions);
      if (next !== level.get(obj)) {
        level.set(obj, next);
        changed = true;
      }
    }
  }

  const labeling: Record<string, string> = {};
  for (const obj of flow.category.objects) labeling[obj] = level.get(obj)!;

  // Upper-bound pins: the only possible failure. The derived labeling already
  // satisfies every flow edge by construction.
  const violations: ClearanceViolation[] = [];
  for (const [obj, cap] of Object.entries(atMost)) {
    const derived = labeling[obj];
    if (!E.leq(derived, cap, maxDepth)) {
      violations.push({ object: obj, derived, atMost: cap });
    }
  }

  if (violations.length > 0) {
    return { ok: false, labeling, violations, functor: null };
  }

  // Certify the derived labeling with gadget 2's functor machinery.
  const check = checkClassification(flow, E, labeling, maxDepth);
  return { ok: true, labeling, violations: [], functor: check.functor };
}

function requireLevel(E: Lattice, level: string): void {
  if (!E.category.objects.has(level)) {
    throw new Error(`Propagation seed uses unknown level "${level}"`);
  }
}