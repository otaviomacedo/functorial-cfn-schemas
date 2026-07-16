/**
 * Full-faithfulness checker for a functor G: D → C.
 *
 * The right Kan extension Π_G is right adjoint to restriction Δ_G, so every
 * user instance I comes with a counit ε_I : Δ_G Π_G(I) → I — the round trip
 * "expand to a template, then read the D-shaped part back off it". That counit
 * is an isomorphism (the user's data survives the round trip *exactly*) iff G is
 * **fully faithful**. When it isn't, the abstraction leaks with no error:
 *
 *   - **not full**  → a C-morphism between two image objects that G doesn't
 *     hit. It injects an extra entry into a comma category, which either
 *     enlarges the limit (elements silently *duplicated*) or adds a constraint
 *     (combinations silently *filtered*). The user never stated this reference.
 *
 *   - **not faithful** → two distinct D-morphisms d ⇉ d' with equal image in C.
 *     The template can't tell them apart, so I(h₁) and I(h₂) are forced equal —
 *     distinct user data silently *merged*.
 *
 * Both checks reduce to deciding path equality mod each category's equations,
 * which `Category.allPaths` / `Category.pathsEqual` handle. Their soundness is
 * therefore bounded by those: `allPaths` enumerates up to a depth cap and
 * `pathsEqual` is a semi-decision (the word problem). A clean report means "no
 * violation found within the search bound", not a proof — see `boundedBy`.
 */

import { Category, Path } from './category';
import { Functor } from './functor';

/** Two distinct D-morphisms that G identifies (a faithfulness violation). */
export interface FaithfulnessViolation {
  /** Domain endpoints of the collapsed hom-set in D. */
  d: string;
  dPrime: string;
  /** The two (or more) distinct D-paths d → d' that map to a common C-path. */
  dPaths: Path[];
  /** Their shared image path in C (source = G(d), target = G(d')). */
  image: Path;
}

/** A C-morphism between image objects that G fails to hit (a fullness violation). */
export interface FullnessViolation {
  /** The image objects it runs between (both in G's image). */
  cSource: string;
  cTarget: string;
  /** The uncovered C-path itself. */
  cPath: Path;
  /**
   * The D-objects that map onto cSource / cTarget. The morphism *should* be the
   * image of some D-path between a pair drawn from these, but is not.
   */
  preimageSources: string[];
  preimageTargets: string[];
}

export interface FullFaithfulReport {
  faithful: boolean;
  full: boolean;
  faithfulnessViolations: FaithfulnessViolation[];
  fullnessViolations: FullnessViolation[];
  /**
   * The depth cap used when enumerating paths. Because `allPaths` truncates at
   * this depth and `pathsEqual` only semi-decides equality, a clean report is
   * "no violation up to this bound", not a proof of full faithfulness.
   */
  boundedBy: number;
}

/**
 * Check whether G: D → C is faithful, full, or both.
 *
 * Faithful: for every ordered pair (d, d') of D-objects, G is injective on
 * Hom_D(d, d') → Hom_C(G d, G d'). We enumerate the D-hom classes (canonical
 * reps mod D-equations) and flag any two that map to equal C-paths.
 *
 * Full: for every pair of image objects (X, Y), every C-path X → Y is the image
 * of some D-path. We enumerate Hom_C(X, Y) and flag any path not equal (mod
 * C-equations) to the image of a D-path landing between the preimages of X, Y.
 */
export function checkFullyFaithful(G: Functor, maxDepth: number = 10): FullFaithfulReport {
  const C = G.target;
  const D = G.source;

  const faithfulnessViolations = findFaithfulnessViolations(G, D, C, maxDepth);
  const fullnessViolations = findFullnessViolations(G, D, C, maxDepth);

  return {
    faithful: faithfulnessViolations.length === 0,
    full: fullnessViolations.length === 0,
    faithfulnessViolations,
    fullnessViolations,
    boundedBy: maxDepth,
  };
}

function findFaithfulnessViolations(
  G: Functor,
  D: Category,
  C: Category,
  maxDepth: number,
): FaithfulnessViolation[] {
  const violations: FaithfulnessViolation[] = [];

  for (const d of D.objects) {
    for (const dPrime of D.objects) {
      const dPaths = D.allPaths(d, dPrime, maxDepth);
      if (dPaths.length < 2) continue; // need two distinct D-morphisms to collide

      // Bucket the D-paths by their image in C (mod C-equations). Any bucket
      // with >1 D-path is a set of morphisms G cannot tell apart.
      const buckets: Array<{ image: Path; members: Path[] }> = [];
      for (const p of dPaths) {
        const image = G.mapPath(p);
        const bucket = buckets.find(b => cPathsEqual(C, b.image, image));
        if (bucket) bucket.members.push(p);
        else buckets.push({ image, members: [p] });
      }

      for (const b of buckets) {
        if (b.members.length > 1) {
          violations.push({ d, dPrime, dPaths: b.members, image: b.image });
        }
      }
    }
  }

  return violations;
}

function findFullnessViolations(
  G: Functor,
  D: Category,
  C: Category,
  maxDepth: number,
): FullnessViolation[] {
  const violations: FullnessViolation[] = [];

  // Which D-objects sit over each image object (object map may be non-injective).
  const preimage = new Map<string, string[]>();
  for (const d of D.objects) {
    const x = G.mapObject(d);
    if (!preimage.has(x)) preimage.set(x, []);
    preimage.get(x)!.push(d);
  }

  const imageObjects = [...preimage.keys()];

  for (const X of imageObjects) {
    for (const Y of imageObjects) {
      // Everything G can express between X and Y: images of D-paths from some
      // preimage of X to some preimage of Y.
      const covered: Path[] = [];
      for (const d of preimage.get(X)!) {
        for (const dPrime of preimage.get(Y)!) {
          for (const p of D.allPaths(d, dPrime, maxDepth)) {
            covered.push(G.mapPath(p));
          }
        }
      }

      // Everything C actually has between X and Y. Any C-path not covered is a
      // reference the schema can't state — instances may be filtered/duplicated.
      for (const cPath of C.allPaths(X, Y, maxDepth)) {
        const hit = covered.some(img => cPathsEqual(C, img, cPath));
        if (!hit) {
          violations.push({
            cSource: X,
            cTarget: Y,
            cPath,
            preimageSources: preimage.get(X)!,
            preimageTargets: preimage.get(Y)!,
          });
        }
      }
    }
  }

  return violations;
}

/** Path equality mod C-equations, treating the empty (identity) path uniformly. */
function cPathsEqual(C: Category, p: Path, q: Path): boolean {
  if (p.length === 0 || q.length === 0) return p.length === q.length;
  return C.pathsEqual(p, q);
}

const showPath = (p: Path): string => (p.length === 0 ? 'id' : p.join(' * '));

/**
 * Render a report as human-readable diagnostic lines (empty if fully faithful).
 *
 * Faithfulness failures are reported as *merges* (distinct user references
 * forced equal) with the concrete D-equation that would fix them — the two
 * D-paths are distinct only because D lacks a relation that C has, so stating
 * it in D removes the collision and restores the round trip. Fullness failures
 * are reported as *duplication/filtering* (an unstated C-reference the Kan
 * extension is nonetheless forced to honor).
 */
export function formatFullFaithfulReport(report: FullFaithfulReport): string[] {
  const lines: string[] = [];

  for (const v of report.faithfulnessViolations) {
    const paths = v.dPaths.map(showPath).join('  =  ');
    lines.push(
      `NOT FAITHFUL: distinct references ${paths} (${v.d} → ${v.dPrime}) map to the same ` +
        `template reference [${showPath(v.image)}], so their data would be MERGED. ` +
        `Fix: add the equation "${suggestedEquation(v)}" to D so the two references coincide there too.`,
    );
  }

  for (const v of report.fullnessViolations) {
    lines.push(
      `NOT FULL: C has reference [${showPath(v.cPath)}] (${v.cSource} → ${v.cTarget}) with no ` +
        `counterpart in the schema. The Kan extension still honors it, so instances may be ` +
        `silently DUPLICATED (one copy per combination) or FILTERED (combinations dropped) — ` +
        `a constraint the user never stated.`,
    );
  }

  return lines;
}

/**
 * The D-equation that would repair a faithfulness violation: equate the two
 * colliding D-paths. Once D states it, they become a single morphism and the
 * collapse is no longer a loss of information.
 */
export function suggestedEquation(v: FaithfulnessViolation): string {
  const [a, b] = v.dPaths;
  return `${showPath(a)} = ${showPath(b)}`;
}