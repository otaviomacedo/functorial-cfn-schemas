/**
 * CAPSTONE: the unified API Gateway schema (apigw-unified.schema) replaces the
 * PublicMethod/AuthorizedMethod split with a single Method carrying an optional,
 * shared `Authorizer?` (a span). This test proves the migration is
 * behaviour-preserving: the generated AWS resource SET — types, properties, and
 * cross-references — matches the split schema's output. Only the template-local
 * logical IDs differ (PublicMethod/AuthorizedMethodN → MethodN), which is
 * immaterial to the deployed infrastructure.
 */

import { compileFile, CfnTemplate, CfnResource } from '../src';

const opts = { onDiagnostic: () => {} };

/** Normalize a template to a logical-ID-independent signature for comparison. */
function signature(cfn: CfnTemplate): string[] {
  return Object.values(cfn.Resources)
    .map((r: CfnResource) => JSON.stringify({ Type: r.Type, Properties: r.Properties ?? {} }))
    .sort();
}

describe('CAPSTONE — unified apigw schema is behaviour-equivalent to the split', () => {
  it('produces the identical AWS resource set (modulo logical IDs)', () => {
    const split = compileFile('examples/apigw-items-api.instance', opts);
    const unified = compileFile('examples/apigw-unified.instance', opts);
    expect(signature(unified)).toEqual(signature(split));
  });

  it('the public method has no AuthorizerId; authorized methods share one authorizer', () => {
    const cfn = compileFile('examples/apigw-unified.instance', opts);
    const methods = Object.values(cfn.Resources).filter(
      r => r.Type === 'AWS::ApiGateway::Method',
    );
    expect(methods).toHaveLength(4);

    const withAuth = methods.filter(m => m.Properties?.AuthorizerId);
    const withoutAuth = methods.filter(m => !m.Properties?.AuthorizerId);
    expect(withoutAuth).toHaveLength(1); // the public GET /items
    expect(withAuth).toHaveLength(3); // POST /items, GET+DELETE /items/{id}

    // Both authorized methods reference the SAME authorizer (shared, n:1).
    const refs = new Set(withAuth.map(m => JSON.stringify(m.Properties!.AuthorizerId)));
    expect(refs.size).toBe(1);
  });

  it('G is faithful — the only diagnostic is the expected DeployToggle fullness note', () => {
    const diags: string[] = [];
    compileFile('examples/apigw-unified.instance', { onDiagnostic: m => diags.push(m) });
    const warnings = diags.filter(d => d.startsWith('warning:'));
    expect(warnings).toEqual([]);
    expect(diags.some(d => d.includes('expected fullness gap'))).toBe(true);
  });
});