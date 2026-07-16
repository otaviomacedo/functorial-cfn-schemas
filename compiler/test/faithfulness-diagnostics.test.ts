import * as path from 'path';
import { compileFile } from '../src';

const instance = (f: string) => path.resolve(__dirname, '..', 'examples', f);

describe('full/faithfulness diagnostics during compilation', () => {
  it('emits no warnings for the fully-faithful VPC schema', () => {
    const diags: string[] = [];
    compileFile(instance('vpc-minimal.instance'), { onDiagnostic: m => diags.push(m) });
    expect(diags).toEqual([]);
  });

  it('is faithful (the Route/Authorizer diamond equation is stated in D) but still not full', () => {
    const diags: string[] = [];
    const cfn = compileFile(instance('apigw-items-api.instance'), {
      onDiagnostic: m => diags.push(m),
    });

    // Compilation still succeeds — diagnostics are warnings, not errors.
    expect(Object.keys(cfn.Resources).length).toBeGreaterThan(0);

    const text = diags.join('\n');
    expect(text).toMatch(/not fully faithful/);
    // The Route/Authorizer diamond used to MERGE two references to the API; the
    // equation added to D (AuthMethod.Route*Route.Api = AuthMethod.Authorizer*
    // Authorizer.Api) makes G faithful, so no merge warning remains.
    expect(text).not.toMatch(/MERGED/);
    // The Stage → DeployToggle reference D cannot express — intended toggle
    // cascade, reported as a fullness (duplication/filtering) finding.
    expect(text).toMatch(/DUPLICATED|FILTERED/);
    expect(text).toContain('Stage.DeploymentId * Deployment.Toggle');
  });

  it('can be silenced with skipFaithfulnessCheck', () => {
    const diags: string[] = [];
    compileFile(instance('apigw-items-api.instance'), {
      onDiagnostic: m => diags.push(m),
      skipFaithfulnessCheck: true,
    });
    expect(diags).toEqual([]);
  });
});
