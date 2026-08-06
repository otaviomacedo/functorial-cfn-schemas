/**
 * End-to-end: a `.flow` DSL file over a real `.schema`, run through gadget 1.
 *
 * The payoff of wiring flow reasoning into the compiler — the internet-egress
 * question from the VPC schema, answered structurally:
 *   - a PRIVATE subnet reaches the IGW (route → NAT → public subnet → IGW)
 *   - an ISOLATED subnet does NOT (it has no route to a NAT or gateway)
 *
 * Also covers the DSL parser in isolation (zigzag `~`/`*` syntax, monic decls,
 * equations) and the schema-path resolution done by the bridge.
 */

import * as path from 'path';
import { parseFlowFile } from '../src/flow-dsl';
import { analyzeFlowFile } from '../src/analyze-flow';
import { reaches, flowPaths } from '../../core/src';

const EGRESS = path.resolve(__dirname, '../examples/vpc-egress.flow');

describe('.flow DSL parsing', () => {
  test('parses schema ref, monic legs, zigzag edges, and directions', () => {
    const src = `
      flow of "./vpc.schema"
      monic PrivateRTAssoc.RouteTableId
      edge privToRT: ~PrivateRTAssoc.SubnetId * PrivateRTAssoc.RouteTableId
      edge routeToNat: PrivateRoute.NatGatewayId
    `;
    const { schemaPath, spec } = parseFlowFile(src);
    expect(schemaPath).toBe('./vpc.schema');
    expect(spec.monic).toEqual(['PrivateRTAssoc.RouteTableId']);

    const privToRT = spec.edges.find(e => e.name === 'privToRT')!;
    expect(privToRT.zigzag).toEqual([
      { morphism: 'PrivateRTAssoc.SubnetId', direction: 'backward' },
      { morphism: 'PrivateRTAssoc.RouteTableId', direction: 'forward' },
    ]);
    const routeToNat = spec.edges.find(e => e.name === 'routeToNat')!;
    expect(routeToNat.zigzag).toEqual([
      { morphism: 'PrivateRoute.NatGatewayId', direction: 'forward' },
    ]);
  });

  test('parses flow equations between edge paths', () => {
    const { spec } = parseFlowFile(`
      flow of "./x.schema"
      edge a: M.p
      edge b: M.q
      edge c: M.r
      eq a * b = c
    `);
    expect(spec.equations).toEqual([{ lhs: ['a', 'b'], rhs: ['c'] }]);
  });

  test('rejects source without a leading `flow of`', () => {
    expect(() => parseFlowFile('monic X.y')).toThrow(/flow/);
  });
});

describe('gadget 1 over the VPC schema, via the .flow file', () => {
  test('a private subnet reaches the internet gateway (egress via NAT)', () => {
    const { flow } = analyzeFlowFile(EGRESS);
    expect(reaches(flow, 'PrivateSubnet', 'IGW')).toBe(true);
    // The witnessing path exists and is non-trivial.
    expect(flowPaths(flow, 'PrivateSubnet', 'IGW').length).toBeGreaterThan(0);
  });

  test('a private subnet reaches the NAT gateway and the public subnet it sits in', () => {
    const { flow } = analyzeFlowFile(EGRESS);
    expect(reaches(flow, 'PrivateSubnet', 'NatGateway')).toBe(true);
    expect(reaches(flow, 'PrivateSubnet', 'PublicSubnet')).toBe(true);
  });

  test('an ISOLATED subnet cannot reach the internet gateway', () => {
    const { flow } = analyzeFlowFile(EGRESS);
    expect(reaches(flow, 'IsolatedSubnet', 'IGW')).toBe(false);
    expect(reaches(flow, 'IsolatedSubnet', 'NatGateway')).toBe(false);
  });

  test('egress is directional: the IGW does not reach back into a subnet', () => {
    const { flow } = analyzeFlowFile(EGRESS);
    expect(reaches(flow, 'IGW', 'PrivateSubnet')).toBe(false);
  });

  test('the bridge resolves the schema path relative to the .flow file', () => {
    const { schemaPath, C } = analyzeFlowFile(EGRESS);
    expect(schemaPath.endsWith('vpc.schema')).toBe(true);
    expect(C.objects.has('PrivateSubnet')).toBe(true);
  });
});
