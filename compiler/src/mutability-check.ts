/**
 * END-TO-END mutability check for a CloudFormation template annotated with
 * RFC 0972 `Metadata.Context.mutable`.
 *
 * Ties the whole formalism together on a real artifact:
 *
 *   template.json ──modelFromTemplate──▶ dependency flow (gadget 1)
 *              │                                │
 *   authored `mutable` per resource      RFC mutable lattice (gadget 2's E)
 *              └───────────────┬────────────────┘
 *                              ▼
 *              propagateClassification (gadget 3)
 *                              ▼
 *              violations: a resource whose AUTHORED mutability is lower than
 *              what its dependents force on it (a lock leaking through a dep).
 *
 * Each authored `mutable` plays two roles:
 *   • `atLeast` seed — a locked resource pushes its lock onto its dependencies;
 *   • `atMost` cap   — the author's own ceiling for that resource.
 * A `ClearanceViolation` is then exactly the contradiction "you declared this
 * free-to-tune, but something that must-never-change depends on it."
 */

import {
  Lattice,
  propagateClassification,
  ClearanceViolation,
} from '../../core/src';
import { CfnTemplateModel } from './cfn-template';

/**
 * RFC 0972's `mutable` enum as a chain lattice. Lower = safer to change.
 * free-to-tune ≤ review-required ≤ change-with-constraints ≤ must-never-change
 */
export const MUTABLE_LATTICE = new Lattice({
  levels: [
    'free-to-tune',
    'review-required',
    'change-with-constraints',
    'must-never-change',
  ],
  covers: [
    { lo: 'free-to-tune', hi: 'review-required' },
    { lo: 'review-required', hi: 'change-with-constraints' },
    { lo: 'change-with-constraints', hi: 'must-never-change' },
  ],
});

export interface MutabilityReport {
  ok: boolean;
  /** The mutability forced on every resource by propagation (≥ authored). */
  derived: Record<string, string>;
  /** Resources whose authored `mutable` is below what their dependents force. */
  violations: ClearanceViolation[];
  /** Resources that carried an authored `mutable` (the rest defaulted to ⊥). */
  authored: Record<string, string>;
}

/**
 * Run the end-to-end mutability check over a parsed CFN template model.
 *
 * @param defaultLevel level assumed for resources with no authored `mutable`
 *   (defaults to the lattice bottom, `free-to-tune`). Unannotated resources are
 *   NOT capped — only authored ones are, so a missing annotation never fabricates
 *   a violation; it just lets a lock flow through.
 */
export function checkMutability(
  model: CfnTemplateModel,
  E: Lattice = MUTABLE_LATTICE,
  defaultLevel: string = E.bottom(),
): MutabilityReport {
  const atLeast: Record<string, string> = {};
  const atMost: Record<string, string> = {};
  const authored: Record<string, string> = {};

  for (const res of model.resources.values()) {
    // Only resources that appear in the flow category can be labeled.
    if (!model.flow.category.objects.has(res.logicalId)) continue;
    const level = res.context?.mutable;
    if (level !== undefined) {
      authored[res.logicalId] = level;
      atLeast[res.logicalId] = level; // seed: propagate this lock to deps
      atMost[res.logicalId] = level; // cap: the author's declared ceiling
    } else {
      atLeast[res.logicalId] = defaultLevel;
    }
  }

  const report = propagateClassification(model.flow, E, { atLeast, atMost });

  return {
    ok: report.ok,
    derived: report.labeling,
    violations: report.violations,
    authored,
  };
}
