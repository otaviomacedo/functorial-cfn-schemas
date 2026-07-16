/**
 * Knuth–Bendix completion for the path equations of a finitely-presented
 * category.
 *
 * A category presentation is a string-rewriting system on paths: the objects
 * type the letters (generating morphisms), and each equation `lhs = rhs` is a
 * relation between two composable paths. Deciding whether two paths are equal
 * is the **word problem**, which is undecidable in general — the reason the
 * naive congruence-closure search in `Category.pathsEqual` is only a
 * *semi-decision* (it may explore an infinite equivalence class forever, and a
 * "not found" answer is never a proof of inequality).
 *
 * Knuth–Bendix turns the unordered equations into a terminating, oriented
 * rewrite system and repeatedly adds the consequences of overlapping rules
 * (critical pairs) until either:
 *
 *   - every critical pair already rewrites to a common form — the system is
 *     **confluent**. Combined with termination (guaranteed here by a shortlex
 *     reduction order), Newman's lemma makes it *canonical*: every path has a
 *     unique normal form, so `p ≡ q  ⟺  normalize(p) = normalize(q)`. Equality
 *     is now a genuine **decision procedure**, not a bounded search.
 *
 *   - the rule count blows past a bound before that happens — completion did
 *     not converge (the word problem may be genuinely undecidable for this
 *     presentation). We report `converged: false` so callers can fall back to
 *     the old semi-decision and, crucially, *not* claim more soundness than
 *     they have.
 *
 * Because the shortlex order is total on paths, orientation never fails; the
 * only failure mode is non-termination, which the bound converts into an honest
 * `converged: false`.
 */

import { Path, PathEquation } from './category';

/** An oriented rewrite rule `lhs → rhs`, where `lhs` is shortlex-greater. */
export interface Rule {
  lhs: Path;
  rhs: Path;
}

export interface CompletionOptions {
  /** Give up (report non-convergence) once the rule set exceeds this size. */
  maxRules?: number;
  /** Give up after this many completion rounds. */
  maxIterations?: number;
}

export interface CompletionResult {
  rules: Rule[];
  /**
   * `true` iff completion reached a confluent (hence canonical) system within
   * the bounds. Only then is `normalize` a decision procedure for path
   * equality; otherwise it is merely sound (equal normal forms ⇒ equal paths,
   * but not conversely).
   */
  converged: boolean;
}

const DEFAULT_MAX_RULES = 500;
const DEFAULT_MAX_ITERATIONS = 200;

const arrEq = (a: Path, b: Path): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Shortlex (length-then-lexicographic) comparison. This is a *reduction order*
 * — well-founded and closed under context (`u < v ⇒ xuy < xvy`) — which is what
 * makes every rewrite step strictly decrease a path and thus guarantees
 * normalization terminates.
 */
function shortlexCompare(a: Path, b: Path): number {
  if (a.length !== b.length) return a.length - b.length;
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

/** First index at which `needle` occurs as a contiguous factor of `hay`, else -1. */
function indexOfSub(hay: Path, needle: Path): number {
  if (needle.length === 0) return -1; // never rewrite with an empty lhs
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let hit = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return i;
  }
  return -1;
}

const splice = (word: Path, at: number, len: number, insert: Path): Path => [
  ...word.slice(0, at),
  ...insert,
  ...word.slice(at + len),
];

/**
 * Rewrite `word` to normal form under `rules`: keep applying the leftmost
 * applicable rule until none matches. Terminates because every rule is
 * shortlex-decreasing.
 */
export function normalize(word: Path, rules: Rule[]): Path {
  let w = word;
  // Guard against a pathological rule set that somehow isn't decreasing; with a
  // shortlex-oriented system this bound is never reached.
  for (let guard = 0; guard < 100000; guard++) {
    let rewrote = false;
    for (const rule of rules) {
      const at = indexOfSub(w, rule.lhs);
      if (at >= 0) {
        w = splice(w, at, rule.lhs.length, rule.rhs);
        rewrote = true;
        break;
      }
    }
    if (!rewrote) return w;
  }
  return w;
}

/**
 * Critical pairs of two rules: the paths that two rule left-hand sides both
 * claim a piece of, and the two competing rewrites of each such path.
 *
 *   - **inclusion**: `l2` is a factor of `l1` — the whole `l1` reduces either to
 *     `r1` or, applying rule 2 inside it, to the spliced form.
 *   - **overlap**: a proper suffix of `l1` equals a proper prefix of `l2`, so the
 *     glued word `l1 · (l2 tail)` reduces two ways.
 */
function criticalPairsOf(a: Rule, b: Rule): Array<[Path, Path]> {
  const pairs: Array<[Path, Path]> = [];
  const { lhs: l1, rhs: r1 } = a;
  const { lhs: l2, rhs: r2 } = b;

  // Inclusion: l2 sits inside l1.
  for (let i = 0; i + l2.length <= l1.length; i++) {
    if (arrEq(l1.slice(i, i + l2.length), l2)) {
      const viaA = r1;
      const viaB = splice(l1, i, l2.length, r2);
      pairs.push([viaA, viaB]);
    }
  }

  // Proper suffix/prefix overlap: l1 = x·s, l2 = s·z with 0 < |s| < |l1|,|l2|.
  const maxK = Math.min(l1.length, l2.length) - 1;
  for (let k = 1; k <= maxK; k++) {
    if (arrEq(l1.slice(l1.length - k), l2.slice(0, k))) {
      // Glued word w = l1 · l2.slice(k) = l1.slice(0, |l1|-k) · l2.
      const viaA = [...r1, ...l2.slice(k)];
      const viaB = [...l1.slice(0, l1.length - k), ...r2];
      pairs.push([viaA, viaB]);
    }
  }

  return pairs;
}

function allCriticalPairs(rules: Rule[]): Array<[Path, Path]> {
  const pairs: Array<[Path, Path]> = [];
  for (const a of rules) {
    for (const b of rules) {
      pairs.push(...criticalPairsOf(a, b));
    }
  }
  return pairs;
}

/**
 * Run Knuth–Bendix completion on the given equations.
 *
 * Returns a rule set and whether it converged to a canonical system. Use
 * `normalize(path, result.rules)` to reduce paths; equality of normal forms
 * decides path equality **iff** `result.converged`.
 */
export function completeRewriteSystem(
  equations: PathEquation[],
  options: CompletionOptions = {},
): CompletionResult {
  const maxRules = options.maxRules ?? DEFAULT_MAX_RULES;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  const rules: Rule[] = [];

  const hasRule = (r: Rule): boolean =>
    rules.some(x => arrEq(x.lhs, r.lhs) && arrEq(x.rhs, r.rhs));

  /**
   * Normalize both sides against the current rules and, if they still differ,
   * orient the pair into a fresh rule (larger side rewrites to smaller).
   * Returns whether a genuinely new rule was added.
   */
  const addEquation = (a: Path, b: Path): boolean => {
    const a2 = normalize(a, rules);
    const b2 = normalize(b, rules);
    if (arrEq(a2, b2)) return false;
    const rule: Rule =
      shortlexCompare(a2, b2) > 0 ? { lhs: a2, rhs: b2 } : { lhs: b2, rhs: a2 };
    if (hasRule(rule)) return false;
    rules.push(rule);
    return true;
  };

  // Interreduction (Huet): drop rules whose lhs is now reducible by another
  // rule (they are redundant), and simplify right-hand sides. Keeps the system
  // canonical and lets convergence actually be detected.
  const interreduce = (): void => {
    for (let guard = 0; guard < 10000; guard++) {
      let changed = false;
      for (let i = 0; i < rules.length; i++) {
        const r = rules[i];
        const others = rules.filter((_, j) => j !== i);

        const lhsNF = normalize(r.lhs, others);
        if (!arrEq(lhsNF, r.lhs)) {
          // lhs reducible ⇒ this rule is subsumed; re-add its content as an eqn.
          rules.splice(i, 1);
          addEquation(lhsNF, normalize(r.rhs, rules));
          changed = true;
          break;
        }

        const rhsNF = normalize(r.rhs, others);
        if (!arrEq(rhsNF, r.rhs)) {
          r.rhs = rhsNF;
          changed = true;
          break;
        }
      }
      if (!changed) return;
    }
  };

  for (const eq of equations) addEquation(eq.lhs, eq.rhs);

  for (let iter = 0; iter < maxIterations; iter++) {
    interreduce();
    if (rules.length > maxRules) return { rules, converged: false };

    let changed = false;
    for (const [a, b] of allCriticalPairs(rules)) {
      if (addEquation(a, b)) changed = true;
      if (rules.length > maxRules) return { rules, converged: false };
    }

    if (!changed) {
      interreduce();
      return { rules, converged: true };
    }
  }

  return { rules, converged: false };
}