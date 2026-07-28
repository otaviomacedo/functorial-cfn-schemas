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

  it('inline Methods sugar works against the unified schema (forwarded defaults + overrides)', () => {
    const cfn = compileFile('examples/apigw-unified-inline-methods.instance', opts);
    const methods = Object.values(cfn.Resources).filter(
      r => r.Type === 'AWS::ApiGateway::Method',
    );
    expect(methods).toHaveLength(4);

    // Auth is forwarded as a default (CUSTOM); GET overrides it to NONE.
    const byVerb = Object.fromEntries(
      methods.map(m => [m.Properties!.HttpMethod, m]),
    );
    expect(byVerb.GET.Properties!.AuthorizationType).toBe('NONE');
    expect(byVerb.POST.Properties!.AuthorizationType).toBe('CUSTOM');

    // Only the public GET lacks an AuthorizerId; the other three share one.
    const withAuth = methods.filter(m => m.Properties?.AuthorizerId);
    expect(withAuth).toHaveLength(3);
    expect(new Set(withAuth.map(m => JSON.stringify(m.Properties!.AuthorizerId))).size).toBe(1);

    // IntegrationType is uniform; IntegrationUri is forwarded but DELETE overrides.
    const integrations = Object.values(cfn.Resources).filter(
      r => r.Type === 'AWS::ApiGateway::Integration',
    );
    expect(new Set(integrations.map(i => i.Properties?.Type))).toEqual(new Set(['AWS_PROXY']));
    expect(new Set(integrations.map(i => JSON.stringify(i.Properties?.Uri))).size).toBe(2);
  });

  it('G is faithful — the only diagnostic is the expected DeployToggle fullness note', () => {
    const diags: string[] = [];
    compileFile('examples/apigw-unified.instance', { onDiagnostic: m => diags.push(m) });
    const warnings = diags.filter(d => d.startsWith('warning:'));
    expect(warnings).toEqual([]);
    expect(diags.some(d => d.includes('expected fullness gap'))).toBe(true);
  });
});