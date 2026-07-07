/**
 * Turn a static `SchemaAnalysis` into a UI-ready graph model for the
 * visualization app (Cytoscape compound graph).
 *
 * The model has two panels:
 *   - D (the user-facing category): the structural D-objects and the morphisms
 *     between them. "Structural" = the objects that actually drive a fiber
 *     (value objects like CidrBlock are omitted, matching fiber-view.mmd).
 *   - C (the CloudFormation category): every resource object, grouped into
 *     colored *fiber* clusters, each node badged with its cardinality class.
 *
 * G is encoded two ways, exactly as the hand-drawn diagram does it: shared color
 * between a D-object and its fiber, plus an explicit dashed G-edge d → G(d).
 */

import { SchemaAnalysis } from './analyze-schema';
import { ObjectClass } from '../../core/src';

export interface GraphNode {
  id: string;
  label: string;
  /** Cytoscape compound parent id, or undefined for a top-level node. */
  parent?: string;
  /** Node role, used for styling. */
  role: 'panel' | 'fiber' | 'd-object' | 'c-object';
  /** Fiber this node belongs to (for color); set on d-object/c-object/fiber. */
  fiber?: string;
  /** Palette index for the fiber (stable per analysis). */
  colorIndex?: number;
  /** For c-objects: the cardinality class detail. */
  cardinality?: string;
  kind?: ObjectClass['kind'];
  drivers?: string[];
  equations?: string[];
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  /** 'd' = morphism in D, 'c' = morphism in C, 'g' = functor mapping d→G(d). */
  kind: 'd' | 'c' | 'g';
  label?: string;
  /** For 'c' edges: true when it crosses between two fibers. */
  crossFiber?: boolean;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** fiber name → palette index, so the frontend and legend agree. */
  fiberColors: Record<string, number>;
  meta: {
    domainObjects: number;
    codomainObjects: number;
    fibers: number;
  };
}

const D_PANEL = 'panel:D';
const C_PANEL = 'panel:C';

export function buildGraphModel(schema: SchemaAnalysis): GraphModel {
  const { functor, analysis } = schema;
  const D = functor.source;

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Stable color index per fiber, in the analysis's fiber order.
  const fiberColors: Record<string, number> = {};
  let colorCounter = 0;
  for (const fiber of analysis.fibers.keys()) {
    fiberColors[fiber] = colorCounter++;
  }

  const classByObject = new Map(analysis.classes.map(c => [c.object, c]));
  const fiberOf = (c: string): string => classByObject.get(c)?.primaryFiber ?? c;

  // ---- Panels (top-level compounds) --------------------------------------
  nodes.push({ id: D_PANEL, label: 'D — user-facing', role: 'panel' });
  nodes.push({ id: C_PANEL, label: 'C — CloudFormation', role: 'panel' });

  // ---- D panel: structural D-objects = the union of all drivers ----------
  const shownDObjects = new Set<string>();
  for (const cls of analysis.classes) for (const d of cls.drivers) shownDObjects.add(d);

  for (const d of D.objects) {
    if (!shownDObjects.has(d)) continue;
    // A D-object's color follows the fiber it names (drivers are usually fibers).
    const ci = fiberColors[d];
    nodes.push({
      id: dNodeId(d),
      label: d,
      parent: D_PANEL,
      role: 'd-object',
      fiber: d,
      colorIndex: ci,
    });
  }

  // D-morphisms between two shown D-objects.
  for (const m of D.morphisms.values()) {
    if (!shownDObjects.has(m.source) || !shownDObjects.has(m.target)) continue;
    edges.push({
      id: `d:${m.name}`,
      source: dNodeId(m.source),
      target: dNodeId(m.target),
      kind: 'd',
      label: shortMorphism(m.name),
    });
  }

  // ---- C panel: fiber clusters + resource objects ------------------------
  for (const [fiber, members] of analysis.fibers) {
    const ci = fiberColors[fiber];
    nodes.push({
      id: fiberNodeId(fiber),
      label: `fiber ${fiber}`,
      parent: C_PANEL,
      role: 'fiber',
      fiber,
      colorIndex: ci,
    });
    for (const obj of members) {
      const cls = classByObject.get(obj)!;
      nodes.push({
        id: cNodeId(obj),
        label: obj,
        parent: fiberNodeId(fiber),
        role: 'c-object',
        fiber,
        colorIndex: ci,
        cardinality: cls.cardinalityFormula,
        kind: cls.kind,
        drivers: cls.drivers,
        equations: cls.collapsingEquations,
      });
    }
  }

  // C-morphisms (only between shown C-objects), flagged if cross-fiber.
  const C = functor.target;
  const shownC = new Set(analysis.classes.map(c => c.object));
  for (const m of C.morphisms.values()) {
    if (!shownC.has(m.source) || !shownC.has(m.target)) continue;
    edges.push({
      id: `c:${m.name}`,
      source: cNodeId(m.source),
      target: cNodeId(m.target),
      kind: 'c',
      label: shortMorphism(m.name),
      crossFiber: fiberOf(m.source) !== fiberOf(m.target),
    });
  }

  // ---- G object-mapping edges: d → G(d), for shown D-objects -------------
  for (const d of shownDObjects) {
    let gd: string | undefined;
    try {
      gd = functor.mapObject(d);
    } catch {
      gd = undefined;
    }
    if (gd && shownC.has(gd)) {
      edges.push({ id: `g:${d}`, source: dNodeId(d), target: cNodeId(gd), kind: 'g' });
    }
  }

  return {
    nodes,
    edges,
    fiberColors,
    meta: {
      domainObjects: shownDObjects.size,
      codomainObjects: analysis.classes.length,
      fibers: analysis.fibers.size,
    },
  };
}

// Distinct id namespaces so a D-object and a same-named C-object never collide.
function dNodeId(name: string): string {
  return `d/${name}`;
}
function cNodeId(name: string): string {
  return `c/${name}`;
}
function fiberNodeId(name: string): string {
  return `fiber/${name}`;
}

/** "PublicSubnet.VpcId" → "VpcId" for a compact edge label. */
function shortMorphism(name: string): string {
  const dot = name.indexOf('.');
  return dot === -1 ? name : name.slice(dot + 1);
}
