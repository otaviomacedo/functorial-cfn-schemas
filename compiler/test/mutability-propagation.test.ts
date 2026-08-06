/**
 * APPLICATION 1: mutability / change-safety propagation (RFC 0972 `mutable`).
 *
 * Gadget 3, unchanged, on the RFC's own four-value enum used as a lattice:
 *
 *     free-to-tune ≤ review-required ≤ change-with-constraints ≤ must-never-change
 *
 * Over the VPC schema's DEPENDENCY flow (forward references), seeding one locked
 * resource derives the least lock every upstream dependency must inherit. The
 * RFC treats `mutable` as an inert per-resource annotation; here it is derived
 * and, via `atMost`, contradiction-checked.
 */

import * as path from 'path';
import { analyzeFlowFile } from '../src/analyze-flow';
import { Lattice, propagateClassification } from '../../core/src';

const MUT = path.resolve(__dirname, '../examples/vpc-mutability.flow');

// RFC 0972's mutable enum, as a total order (a chain lattice).
const MUTABLE = new Lattice({
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

describe('application 1: mutability propagation over VPC dependencies', () => {
  test('locking the NAT gateway forces its whole dependency chain to lock', () => {
    const { flow } = analyzeFlowFile(MUT);
    const report = propagateClassification(flow, MUTABLE, {
      atLeast: { NatGateway: 'must-never-change' },
    });

    expect(report.ok).toBe(true);
    // The NAT's identity is built on its EIP, its subnet, and (transitively) the
    // VPC — all must inherit the lock.
    expect(report.labeling['EIP']).toBe('must-never-change');
    expect(report.labeling['PublicSubnet']).toBe('must-never-change');
    expect(report.labeling['VPC']).toBe('must-never-change');
  });

  test('unrelated / downstream nodes stay free-to-tune (⊥)', () => {
    const { flow } = analyzeFlowFile(MUT);
    const report = propagateClassification(flow, MUTABLE, {
      atLeast: { NatGateway: 'must-never-change' },
    });
    // NatGateway itself is a dependent, nothing flows into it here, so it holds
    // exactly its seed; the bottom for any unseeded leaf is free-to-tune.
    expect(MUTABLE.bottom()).toBe('free-to-tune');
    expect(report.labeling['NatGateway']).toBe('must-never-change');
  });

  test('a contradiction: EIP pinned free-to-tune under a locked NAT is reported', () => {
    const { flow } = analyzeFlowFile(MUT);
    // Author claims the EIP is safe to swap, but a must-never-change NAT depends
    // on it. No labeling reconciles the two — the derived lock exceeds the pin.
    const report = propagateClassification(flow, MUTABLE, {
      atLeast: { NatGateway: 'must-never-change' },
      atMost: { EIP: 'free-to-tune' },
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      {
        object: 'EIP',
        derived: 'must-never-change',
        atMost: 'free-to-tune',
      },
    ]);
  });

  test('a milder seed propagates a milder lock (join, not just top)', () => {
    const { flow } = analyzeFlowFile(MUT);
    const report = propagateClassification(flow, MUTABLE, {
      atLeast: { NatGateway: 'review-required' },
    });
    expect(report.ok).toBe(true);
    expect(report.labeling['EIP']).toBe('review-required');
    expect(report.labeling['VPC']).toBe('review-required');
  });
});
