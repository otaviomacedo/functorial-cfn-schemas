import * as path from 'path';
import { compileFile, parseSchemaFile, lowerSchemaFile, parseSchema, parseTemplate, compile } from '../src';

const instance = (f: string) => path.resolve(__dirname, '..', 'examples', f);

describe('full/faithfulness diagnostics during compilation', () => {
  it('emits no warnings for the fully-faithful VPC schema', () => {
    const diags: string[] = [];
    compileFile(instance('vpc-minimal.instance'), { onDiagnostic: m => diags.push(m) });
    expect(diags).toEqual([]);
  });

  it('is faithful and reports its one remaining fullness gap as an expected note, not a warning', () => {
    const diags: string[] = [];
    const cfn = compileFile(instance('apigw-items-api.instance'), {
      onDiagnostic: m => diags.push(m),
    });

    // Compilation still succeeds — diagnostics are warnings/notes, not errors.
    expect(Object.keys(cfn.Resources).length).toBeGreaterThan(0);

    const text = diags.join('\n');

    // The Route/Authorizer diamond equation added to D makes G faithful, so no
    // merge warning remains.
    expect(text).not.toMatch(/MERGED/);

    // The only remaining gap — Stage → DeployToggle — is declared intended via
    // `expected fullness` in the map block, so it is reported as an expected
    // note and NOT as a duplication/filtering warning.
    expect(text).toMatch(/note: expected fullness gap/);
    expect(text).toContain('Stage.DeploymentId * Deployment.Toggle');
    expect(text).toContain('Deployment is auto-created');

    // With the diamond faithful and the toggle gap declared, there is no
    // outstanding leak — so no "not fully faithful" warning at all.
    expect(text).not.toMatch(/not fully faithful/);
    expect(text).not.toMatch(/DUPLICATED|FILTERED/);
  });

  it('can be silenced with skipFaithfulnessCheck', () => {
    const diags: string[] = [];
    compileFile(instance('apigw-items-api.instance'), {
      onDiagnostic: m => diags.push(m),
      skipFaithfulnessCheck: true,
    });
    expect(diags).toEqual([]);
  });

  it('warns that a stale "expected fullness" declaration matches no gap', () => {
    // D and C are isomorphic here (fully faithful), so there is NO fullness gap.
    // The declaration therefore names a gap that does not exist and must be
    // flagged as stale rather than silently ignored.
    const src = `
      schema C {
        obj AWS::EC2::VPC { CidrBlock { Value: String } } alias VPC
      }
      schema D {
        obj T::Net { CidrBlock { Value: String } } alias Net
      }
      map D -> C {
        Net -> VPC
        expected fullness VPC.CidrBlock
      }
    `;
    const schema = parseSchema(lowerSchemaFile(parseSchemaFile(src)).raw);
    const template = parseTemplate({
      Schema: './x',
      Resources: { N: { Type: 'T::Net', Properties: { CidrBlock: '10.0.0.0/16' } } },
    });

    const diags: string[] = [];
    compile(schema, template, { onDiagnostic: m => diags.push(m) });
    const text = diags.join('\n');
    expect(text).toMatch(/stale annotation|no longer matches any fullness gap/);
    expect(text).toContain('VPC.CidrBlock');
  });
});
