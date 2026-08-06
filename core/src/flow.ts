/**
 * Data-flow reasoning as a *derived* category (gadget 1).
 *
 * A CloudFormation category C wires references in the direction
 * referencer → referenced (`Subnet → VPC`, `ESM → Queue`, `ESM → Function`).
 * But the properties we want to reason about run in *derived* directions:
 * data flows `Queue → Function`, not `ESM → Queue`. So the "semantic" category
 * is never literally C — it is C with some legs reversed and composites taken.
 *
 * This is the span vocabulary the engine already speaks (see `optional-span`
 * and `span-equation` tests): an `EventSourceMapping` is an apex
 *
 *        Queue  ←—on——  ESM  ——to—→  Function
 *
 * and the data-flow arrow `Queue → Function` is `on⁻¹ ; to` — reverse the `on`
 * leg, compose the `to` leg. More generally a flow edge is a **zigzag** in C:
 * a connected sequence of C-morphisms, each traversed forward or backward.
 *
 * `deriveFlow` turns a set of such zigzags into a genuine finitely-presented
 * `Category` (the Flow category) whose generators are the derived arrows. Once
 * it exists, the reasoning queries are the engine's *existing* primitives:
 *
 *   - reachability ("can a message in the queue reach the bucket?")  → `allPaths`
 *   - flow-equality ("are these two flows the same flow?")           → `pathsEqual`
 *
 * ## Functional vs relational
 *
 * Reversing a leg `l: A → X` is an honest *function* on elements only when `l`
 * is monic (injective) — otherwise `l⁻¹` is one-to-many, a *relation*. For
 * structural reachability that distinction does not matter (a relation still
 * connects the endpoints), so we allow any reversal. But we record, per edge,
 * whether every reversed leg was declared monic: a **functional** flow edge
 * denotes a well-defined function on elements and is safe to propagate labels
 * along (gadget 2); a merely **relational** one is sound for reachability but
 * not for element-level derivation. This keeps the substrate honest about which
 * downstream reasoning each derived arrow can bear.
 */

import { Category, PathEquation, Path } from './category';
import { Instance } from './instance';

export type Direction = 'forward' | 'backward';

/** One hop of a zigzag: a C-morphism traversed in the given direction. */
export interface ZigzagStep {
  morphism: string;
  direction: Direction;
}

/** A derived flow arrow, presented as a zigzag in C. */
export interface FlowEdgeSpec {
  /** Name of the generator this edge contributes to the Flow category. */
  name: string;
  /** The zigzag in C. `backward` steps traverse a C-morphism in reverse. */
  zigzag: ZigzagStep[];
}

export interface FlowSpec {
  /**
   * C-morphisms declared monic (injective). Reversing a monic leg is a
   * function; reversing a non-monic one is only a relation. An edge is
   * `functional` iff every one of its `backward` steps names a monic morphism.
   */
  monic?: string[];
  edges: FlowEdgeSpec[];
  /** Equations among flow generators (e.g. two zigzags denote the same flow). */
  equations?: PathEquation[];
}

export interface FlowEdgeInfo {
  from: string;
  to: string;
  zigzag: ZigzagStep[];
  /** Every reversed leg is monic ⇒ this arrow is a function on elements. */
  functional: boolean;
}

export interface DerivedFlow {
  /** The Flow category: derived arrows as generators over C's flow objects. */
  category: Category;
  /** Per-generator provenance and the functional/relational verdict. */
  edgeInfo: Map<string, FlowEdgeInfo>;
}

/**
 * Walk a zigzag against C, validating composability and computing endpoints.
 * A `forward` step on m: s→t enters at s, exits at t; a `backward` step enters
 * at t, exits at s.
 */
function resolveZigzag(
  C: Category,
  edge: FlowEdgeSpec,
): { from: string; to: string } {
  if (edge.zigzag.length === 0) {
    throw new Error(`Flow edge "${edge.name}" has an empty zigzag`);
  }

  let from = '';
  let cursor = '';

  edge.zigzag.forEach((step, i) => {
    const m = C.morphisms.get(step.morphism);
    if (!m) {
      throw new Error(
        `Flow edge "${edge.name}": unknown C-morphism "${step.morphism}"`,
      );
    }
    const [entry, exit] =
      step.direction === 'forward' ? [m.source, m.target] : [m.target, m.source];

    if (i === 0) {
      from = entry;
      cursor = entry;
    }
    if (entry !== cursor) {
      throw new Error(
        `Flow edge "${edge.name}" is not composable at step ${i} ("${step.morphism}" ` +
          `${step.direction}): expected to enter at "${cursor}" but this hop enters at "${entry}"`,
      );
    }
    cursor = exit;
  });

  return { from, to: cursor };
}

/**
 * Derive the Flow category from C and a set of zigzag flow edges.
 *
 * The resulting category's objects are exactly the endpoints touched by the
 * edges; its generators are the edges themselves. Reachability and flow-equality
 * then run through `Category.allPaths` / `Category.pathsEqual`.
 */
export function deriveFlow(C: Category, spec: FlowSpec): DerivedFlow {
  const monic = new Set(spec.monic ?? []);

  // Guard: a monic declaration must name a real C-morphism.
  for (const m of monic) {
    if (!C.morphisms.has(m)) {
      throw new Error(`Flow spec declares unknown morphism "${m}" as monic`);
    }
  }

  const edgeInfo = new Map<string, FlowEdgeInfo>();
  const objects = new Set<string>();
  const generators = spec.edges.map(edge => {
    if (edgeInfo.has(edge.name)) {
      throw new Error(`Duplicate flow edge name "${edge.name}"`);
    }
    const { from, to } = resolveZigzag(C, edge);
    const functional = edge.zigzag.every(
      step => step.direction === 'forward' || monic.has(step.morphism),
    );
    edgeInfo.set(edge.name, { from, to, zigzag: edge.zigzag, functional });
    objects.add(from);
    objects.add(to);
    return { name: edge.name, source: from, target: to };
  });

  const category = new Category({
    objects: [...objects],
    morphisms: generators,
    equations: spec.equations,
  });

  return { category, edgeInfo };
}

/**
 * Does data flow from `from` to `to`? Reflexive-transitive: an object always
 * reaches itself. Returns true iff some directed flow path exists in Flow.
 */
export function reaches(
  flow: DerivedFlow,
  from: string,
  to: string,
  maxDepth = 10,
): boolean {
  if (from === to) return true;
  return flow.category.allPaths(from, to, maxDepth).length > 0;
}

/**
 * All distinct flow paths `from → to` (canonical reps mod flow equations).
 * The empty path is included when `from === to`.
 */
export function flowPaths(
  flow: DerivedFlow,
  from: string,
  to: string,
  maxDepth = 10,
): Path[] {
  return flow.category.allPaths(from, to, maxDepth);
}

/**
 * Is this flow path element-level well-defined? True iff every generator on it
 * is `functional` (all its reversed legs were monic). Sound to propagate labels
 * along only when true; otherwise the path is a relation, not a function.
 */
export function isFunctional(flow: DerivedFlow, path: Path): boolean {
  return path.every(g => flow.edgeInfo.get(g)?.functional ?? false);
}

// ---------------------------------------------------------------------------
// Element-level flow: derive flow over the CATEGORY OF ELEMENTS ∫I.
//
// The type-level Flow above answers "can SOME queue reach SOME bucket in this
// schema". The user's real question is about concrete resources: "does `orders`
// reach `invoices` but not `financial-reports`?". That is NOT a right Kan
// extension — a reversed leg (onQueue⁻¹) is a partial, one-to-many map on
// elements, and Set-valued Kan can only migrate honest functions.
//
// The right tool is the SAME `deriveFlow` construction run over a different base
// category: the category of elements ∫I. Its objects are the concrete elements
// (tagged by their C-object), its generators are the instance's individual
// function-applications `x ↦ I(m)(x)`. Reversing a leg there is an honest
// element-level relation, so we realize it by enumerating preimages. `allPaths`
// / `reaches` then decide concrete reachability with no new engine.
// ---------------------------------------------------------------------------

/** An element of ∫I: an instance element tagged with the C-object it inhabits. */
export interface ElementNode {
  object: string;
  element: any;
  /** Stable node id in ∫I, `"object#element"`. */
  id: string;
}

const nodeId = (object: string, element: any): string => `${object}#${element}`;

/**
 * A leg declared monic in the spec that is NOT injective on this instance:
 * some target element has more than one preimage. The type-level `functional`
 * verdict trusted the declaration; here the concrete data contradicts it, so any
 * flow edge reversing this leg actually fans out — a place a "secret leaks via
 * an unexpected shared resource" bug hides. Reachability stays sound (fan-out is
 * modelled), but element-level label propagation along it is NOT safe.
 */
export interface MonicViolation {
  /** The C-morphism declared monic but found non-injective on this instance. */
  morphism: string;
  /** A target element with multiple preimages (the collision). */
  target: any;
  /** The >1 source elements all mapping to `target` under `I(morphism)`. */
  preimages: any[];
}

export interface ElementFlow {
  /** The derived flow over ∫I: nodes are concrete elements, arrows realized flows. */
  flow: DerivedFlow;
  /** All ∫I nodes, keyed by id. */
  nodes: Map<string, ElementNode>;
  /**
   * Declared-monic legs that collide on this instance (empty ⇒ all monic
   * declarations held). When non-empty, edges reversing the offending legs are
   * downgraded to non-`functional` in `flow.edgeInfo`, so `isFunctional` reports
   * the honest instance-level verdict rather than the optimistic type-level one.
   */
  monicViolations: MonicViolation[];
}

/**
 * Build the element-level flow for an instance `I: C → Set` under `spec`.
 *
 * For each type-level flow edge and each way of realizing its zigzag on concrete
 * elements, we emit one generator in ∫I. A `forward` step follows `I(m)`; a
 * `backward` step branches over the preimage `I(m)⁻¹` (one realization per
 * pre-image element — this is where relational fan-out becomes explicit). Each
 * realized edge inherits its type-level edge's `functional` verdict, so a
 * functional edge that nonetheless fans out (a shared monic target would be a
 * modelling error) is still visible as multiple parallel arrows.
 */
export function deriveElementFlow(
  C: Category,
  I: Instance,
  spec: FlowSpec,
): ElementFlow {
  const monic = new Set(spec.monic ?? []);
  for (const m of monic) {
    if (!C.morphisms.has(m)) {
      throw new Error(`Flow spec declares unknown morphism "${m}" as monic`);
    }
  }

  // Precompute preimages for every C-morphism: target element → [source elems].
  const preimages = new Map<string, Map<any, any[]>>();
  const preimageFor = (morphism: string): Map<any, any[]> => {
    let pre = preimages.get(morphism);
    if (pre) return pre;
    const m = C.morphisms.get(morphism);
    if (!m) throw new Error(`Unknown C-morphism "${morphism}" in flow spec`);
    pre = new Map();
    for (const x of I.getSet(m.source)) {
      const y = I.applyMorphism(morphism, x);
      if (!pre.has(y)) pre.set(y, []);
      pre.get(y)!.push(x);
    }
    preimages.set(morphism, pre);
    return pre;
  };

  // Instance-level monic check: a leg declared monic must be injective on I.
  // Any preimage bucket of size > 1 refutes the declaration for THIS instance.
  // We downgrade the offending legs so `functional` reflects the concrete data,
  // not the optimistic type-level assumption.
  const monicViolations: MonicViolation[] = [];
  const collidingMonic = new Set<string>();
  for (const leg of monic) {
    for (const [target, sources] of preimageFor(leg)) {
      if (sources.length > 1) {
        collidingMonic.add(leg);
        monicViolations.push({ morphism: leg, target, preimages: [...sources] });
      }
    }
  }
  // A backward step is element-level functional only if its leg is monic AND
  // actually injective on this instance.
  const legTrustworthy = (leg: string) => monic.has(leg) && !collidingMonic.has(leg);

  const nodes = new Map<string, ElementNode>();
  const touch = (object: string, element: any): string => {
    const id = nodeId(object, element);
    if (!nodes.has(id)) nodes.set(id, { object, element, id });
    return id;
  };

  const edges: FlowEdgeSpec[] = [];
  const edgeInfo = new Map<string, FlowEdgeInfo>();
  let counter = 0;

  for (const edge of spec.edges) {
    // Resolve the type-level endpoints/functionality once (also validates the
    // zigzag is composable in C).
    const { from: typeFrom } = resolveZigzag(C, edge);
    const functional = edge.zigzag.every(
      step => step.direction === 'forward' || legTrustworthy(step.morphism),
    );

    // Realize the zigzag on every starting element of its source object.
    for (const start of I.getSet(typeFrom)) {
      // Each realization is a concrete walk; a backward step forks over preimages.
      let walks: any[][] = [[start]];
      for (const step of edge.zigzag) {
        const next: any[][] = [];
        const m = C.morphisms.get(step.morphism)!;
        for (const walk of walks) {
          const head = walk[walk.length - 1];
          if (step.direction === 'forward') {
            next.push([...walk, I.applyMorphism(step.morphism, head)]);
          } else {
            for (const pre of preimageFor(step.morphism).get(head) ?? []) {
              next.push([...walk, pre]);
            }
          }
          void m;
        }
        walks = next;
      }

      for (const walk of walks) {
        const srcId = touch(typeFrom, walk[0]);
        const dstObj = flowEdgeEndpointObject(C, edge);
        const dstId = touch(dstObj, walk[walk.length - 1]);
        const name = `${edge.name}#${counter++}`;
        edges.push({
          name,
          // The realized edge is a single direct hop in ∫I between concrete
          // element-nodes; its provenance is the original zigzag.
          zigzag: edge.zigzag,
        });
        edgeInfo.set(name, {
          from: srcId,
          to: dstId,
          zigzag: edge.zigzag,
          functional,
        });
      }
    }
  }

  // Assemble ∫I's flow category directly from the realized element edges.
  const category = new Category({
    objects: [...nodes.keys()],
    morphisms: edges.map(e => ({
      name: e.name,
      source: edgeInfo.get(e.name)!.from,
      target: edgeInfo.get(e.name)!.to,
    })),
  });

  return { flow: { category, edgeInfo }, nodes, monicViolations };
}

/** The C-object a type-level flow edge lands on (its zigzag's exit object). */
function flowEdgeEndpointObject(C: Category, edge: FlowEdgeSpec): string {
  return resolveZigzag(C, edge).to;
}

/**
 * Concrete reachability: does data flow from element `fromEl` (of C-object
 * `fromObj`) to element `toEl` (of `toObj`) in the instance? Reflexive.
 */
export function elementReaches(
  ef: ElementFlow,
  fromObj: string,
  fromEl: any,
  toObj: string,
  toEl: any,
  maxDepth = 20,
): boolean {
  const from = nodeId(fromObj, fromEl);
  const to = nodeId(toObj, toEl);
  if (!ef.nodes.has(from) || !ef.nodes.has(to)) return from === to;
  return reaches(ef.flow, from, to, maxDepth);
}

/**
 * Every element (of `toObj`, or of any object when omitted) reachable from a
 * given source element. Returns the concrete `ElementNode`s — the "view of the
 * data flow" for one starting resource.
 */
export function reachableFrom(
  ef: ElementFlow,
  fromObj: string,
  fromEl: any,
  toObj?: string,
  maxDepth = 20,
): ElementNode[] {
  const from = nodeId(fromObj, fromEl);
  const out: ElementNode[] = [];
  for (const node of ef.nodes.values()) {
    if (node.id === from) continue;
    if (toObj && node.object !== toObj) continue;
    if (reaches(ef.flow, from, node.id, maxDepth)) out.push(node);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The RELATIONAL obligation: do declared flow equations hold IN Rel?
//
// `spec.equations` are equations among flow generators. `deriveFlow` feeds them
// to the Flow `Category`, so `pathsEqual` decides them *syntactically* — inside
// the category Flow, mod exactly those equations. But the flow-view of a
// template is a FUNCTOR `Flow → Rel` (Rel = Kleisli(P); see the project note),
// and for that assignment to be a genuine functor, two paths declared equal
// must denote the SAME RELATION on the instance. That is NOT automatic: an
// author can write `deliver;emit = archive` and have the category happily
// believe it, while on a concrete instance the two sides relate different pairs.
//
// This is the flow-analogue of `G` being a valid functor in the synthesis
// direction — a soundness obligation the category presentation cannot see.
// `checkFlowEquations` evaluates each side of each equation as a relation over I
// (forward step = the graph of I(m); backward step = its converse) and reports
// any equation whose two sides differ.
// ---------------------------------------------------------------------------

/** A pair (source element, target element) related by a flow relation. */
type RelPair = string; // encoded "src dst"
const pair = (s: any, t: any): RelPair => `${s} ${t}`;

/**
 * Evaluate a flow path (sequence of generator names) as a relation over I:
 * the set of (start, end) element pairs it connects. Composition of relations,
 * with `backward` steps taking converses. Returns the pair-set.
 */
function evalFlowPathAsRelation(
  C: Category,
  I: Instance,
  edgeInfo: Map<string, FlowEdgeInfo>,
  path: string[],
): Set<RelPair> {
  // Expand the flow path into its underlying C-level zigzag steps.
  const steps: ZigzagStep[] = [];
  for (const gen of path) {
    const info = edgeInfo.get(gen);
    if (!info) throw new Error(`Unknown flow generator "${gen}" in equation`);
    steps.push(...info.zigzag);
  }

  // Determine the entry object (source of the whole path) to seed identity.
  // Start relation = identity on the source object's elements.
  const startObj =
    path.length === 0 ? undefined : edgeInfo.get(path[0])!.from;
  if (startObj === undefined) {
    // Empty path = identity relation; caller compares two such — trivially equal.
    return new Set();
  }
  // We track the relation as pairs (originalStart, currentHead).
  let rel = new Set<RelPair>();
  for (const el of elementsOfFlowObject(C, I, startObj)) {
    rel.add(pair(el, el));
  }

  for (const step of steps) {
    const m = C.morphisms.get(step.morphism)!;
    const next = new Set<RelPair>();
    for (const p of rel) {
      const [start, head] = p.split(' ');
      if (step.direction === 'forward') {
        // Advance head along I(m): head must be in m.source; image in m.target.
        if (I.getSet(m.source).includes(head)) {
          next.add(pair(start, I.applyMorphism(step.morphism, head)));
        }
      } else {
        // Converse: every preimage x with I(m)(x) = head.
        for (const x of I.getSet(m.source)) {
          if (I.applyMorphism(step.morphism, x) === head) {
            next.add(pair(start, x));
          }
        }
      }
    }
    rel = next;
  }
  return rel;
}

/**
 * Flow objects are C-objects, but a flow edge's endpoints are C-objects too;
 * the elements of a flow object are just I's set for that C-object.
 */
function elementsOfFlowObject(C: Category, I: Instance, obj: string): any[] {
  void C;
  return I.getSet(obj);
}

/** A declared flow equation whose two sides denote different relations on I. */
export interface FlowEquationViolation {
  lhs: string[];
  rhs: string[];
  /** Pairs related by exactly one side (symmetric difference), as [start,end]. */
  onlyLhs: Array<[any, any]>;
  onlyRhs: Array<[any, any]>;
}

/**
 * Check that every declared flow equation holds as an equality of RELATIONS on
 * the instance `I` — i.e. that the flow-view `Flow → Rel` really is a functor.
 * Returns one violation per equation whose sides differ (empty ⇒ all hold).
 *
 * `equations` defaults to the spec's own equations (the ones `deriveFlow`
 * already baked into the category), so this is the natural "and are they *true*,
 * not just *assumed*?" companion to building the flow.
 */
export function checkFlowEquations(
  C: Category,
  I: Instance,
  flow: DerivedFlow,
  equations: PathEquation[],
): FlowEquationViolation[] {
  const violations: FlowEquationViolation[] = [];
  const decode = (s: RelPair): [any, any] => {
    const [a, b] = s.split(' ');
    return [a, b];
  };

  for (const eq of equations) {
    const lhs = evalFlowPathAsRelation(C, I, flow.edgeInfo, eq.lhs);
    const rhs = evalFlowPathAsRelation(C, I, flow.edgeInfo, eq.rhs);

    const onlyLhs = [...lhs].filter(p => !rhs.has(p)).map(decode);
    const onlyRhs = [...rhs].filter(p => !lhs.has(p)).map(decode);

    if (onlyLhs.length > 0 || onlyRhs.length > 0) {
      violations.push({ lhs: eq.lhs, rhs: eq.rhs, onlyLhs, onlyRhs });
    }
  }
  return violations;
}