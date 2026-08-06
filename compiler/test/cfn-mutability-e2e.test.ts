/**
 * END-TO-END: a real CloudFormation template annotated with RFC 0972
 * `Metadata.Context.mutable`, checked for change-safety consistency by the
 * category-theoretic engine — no hand-built categories anywhere.
 *
 * Pipeline exercised:
 *   1. read a `.json` CFN template from disk
 *   2. modelFromTemplate: extract Ref / Fn::GetAtt / Fn::Sub / DependsOn edges
 *      → a dependency DerivedFlow (gadget 1) over the template's logical IDs
 *   3. checkMutability: authored `mutable` fields seed gadget-3 propagation
 *      over the RFC's mutable lattice (gadget 2's E)
 *   4. report: a violation is a resource whose AUTHORED mutability is lower than
 *      what a dependent forces on it — a lock leaking through a dependency.
 *
 * Two templates: one internally consistent (no violations) and one where the DB
 * subnet is mis-annotated `free-to-tune` while a `must-never-change` subnet
 * group (and hence the DB) depends on it.
 */

import * as fs from 'fs';
import * as path from 'path';
import { modelFromTemplate } from '../src/cfn-template';
import { checkMutability, MUTABLE_LATTICE } from '../src/mutability-check';

function loadModel(file: string) {
  const raw = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../examples', file), 'utf8'),
  );
  return modelFromTemplate(raw);
}

describe('end-to-end CFN mutability check (RFC 0972 Metadata.Context)', () => {
  test('the dependency flow is read straight from the template intrinsics', () => {
    const model = loadModel('rds-app.clean.json');

    // Ref: AppVpc  →  DbSubnet depends on AppVpc.
    expect(model.C.objects.has('AppVpc')).toBe(true);
    // Fn::GetAtt [DbSecurityGroup, GroupId]  →  Database depends on the SG.
    const dbDeps = [...model.flow.edgeInfo.values()]
      .filter(e => e.from === 'Database')
      .map(e => e.to)
      .sort();
    expect(dbDeps).toContain('DbSecurityGroup'); // via Fn::GetAtt
    expect(dbDeps).toContain('DbSubnet'); // via DependsOn
    expect(dbDeps).toContain('DbSubnetGroup'); // via Ref
    // Fn::Sub "${Database.Endpoint.Address}"  →  AppFunction depends on Database.
    const fnDeps = [...model.flow.edgeInfo.values()]
      .filter(e => e.from === 'AppFunction')
      .map(e => e.to);
    expect(fnDeps).toEqual(['Database']);
  });

  test('CLEAN template: every authored lock is consistent with its dependents', () => {
    const model = loadModel('rds-app.clean.json');
    const report = checkMutability(model);

    expect(report.ok).toBe(true);
    expect(report.violations).toEqual([]);

    // The VPC is (correctly) forced to must-never-change by everything above it,
    // matching its authored value.
    expect(report.derived['AppVpc']).toBe('must-never-change');
    // The stateless function depends on nothing that outranks free-to-tune, and
    // nothing depends on it, so it stays free-to-tune.
    expect(report.derived['AppFunction']).toBe('free-to-tune');
  });

  test('VIOLATION template: a free-to-tune subnet under a locked DB is caught', () => {
    const model = loadModel('rds-app.violation.json');
    const report = checkMutability(model);

    expect(report.ok).toBe(false);
    // DbSubnetGroup is must-never-change and depends on DbSubnet (Ref), so the
    // subnet is forced must-never-change — but the author declared it free-to-tune.
    expect(report.violations).toEqual([
      {
        object: 'DbSubnet',
        derived: 'must-never-change',
        atMost: 'free-to-tune',
      },
    ]);
    // The engine still reports the derived (correct) level it should carry.
    expect(report.derived['DbSubnet']).toBe('must-never-change');
    expect(report.authored['DbSubnet']).toBe('free-to-tune');
  });

  test('the check is over the RFC lattice as a total order', () => {
    expect(MUTABLE_LATTICE.leq('free-to-tune', 'must-never-change')).toBe(true);
    expect(MUTABLE_LATTICE.leq('must-never-change', 'free-to-tune')).toBe(false);
    expect(MUTABLE_LATTICE.join(['review-required', 'change-with-constraints'])).toBe(
      'change-with-constraints',
    );
  });
});
