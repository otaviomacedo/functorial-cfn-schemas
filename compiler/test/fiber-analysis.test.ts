import * as fs from 'fs';
import * as path from 'path';
import { parseSchemaFile, lowerSchemaFile } from '../src/schema-dsl';
import { parseSchema } from '../src/schema-parser';
import {
  Category,
  Functor,
  analyzeFibers,
  verifyCardinality,
  FiberAnalysis,
} from '../../core/src';

/** Load an example .schema and build its functor + the list of CFN-resource objects. */
function loadFunctor(file: string): { G: Functor; resourceObjects: string[] } {
  const raw = lowerSchemaFile(
    parseSchemaFile(fs.readFileSync(path.resolve(__dirname, '..', 'examples', file), 'utf8')),
  ).raw;
  const schema = parseSchema(raw);
  const D = new Category(schema.simplified.categorySpec);
  const C = new Category(schema.original.categorySpec);
  const G = new Functor(D, C, schema.functor);
  const resourceObjects = [...schema.original.objects]
    .filter(([, def]) => def.cfnType)
    .map(([name]) => name);
  return { G, resourceObjects };
}

function classOf(a: FiberAnalysis, object: string) {
  const cls = a.classes.find(c => c.object === object);
  if (!cls) throw new Error(`no class for ${object}`);
  return cls;
}

describe('fiber analysis — VPC', () => {
  const { G, resourceObjects } = loadFunctor('vpc.schema');
  const a = analyzeFibers(G, resourceObjects);

  it('classifies direct images as 1:1 correlated with their D-object', () => {
    expect(classOf(a, 'VPC')).toMatchObject({ kind: 'correlated', drivers: ['Network'] });
    expect(classOf(a, 'PublicSubnet')).toMatchObject({ kind: 'correlated', drivers: ['PublicTier'] });
    expect(classOf(a, 'NatGateway')).toMatchObject({ kind: 'correlated', drivers: ['NatSlot'] });
  });

  it('classifies route tables as a product of Network and the subnet tier', () => {
    // This is the case the hand-drawn diagram gets wrong: PublicRT is NOT a pure
    // copy of PublicTier — it is a limit over both Network and PublicTier.
    const rt = classOf(a, 'PublicRT');
    expect(rt.kind).toBe('product');
    expect(new Set(rt.drivers)).toEqual(new Set(['Network', 'PublicTier']));
  });

  it('classifies the fully disconnected EIP as an auto-created singleton', () => {
    expect(classOf(a, 'EIP')).toMatchObject({ kind: 'singleton', drivers: [] });
  });

  it('classifies toggle-driven objects by their toggle', () => {
    expect(classOf(a, 'IGW')).toMatchObject({ kind: 'correlated', drivers: ['IgwToggle'] });
    // The attachment is a product of the network and the toggle.
    const att = classOf(a, 'IGWAttach');
    expect(att.kind).toBe('product');
    expect(new Set(att.drivers)).toEqual(new Set(['Network', 'IgwToggle']));
  });

  it('groups objects into fibers and finds cross-fiber references', () => {
    // Every subnet references its VPC across fibers.
    const names = a.crossFiberMorphisms.map(m => `${m.source}->${m.target}`);
    expect(names).toContain('PublicSubnet->VPC');
    expect(names).toContain('NatGateway->EIP');
  });

  it('flags the association objects as constrained by an equation', () => {
    expect(classOf(a, 'PublicRTAssoc').collapsingEquations.length).toBeGreaterThan(0);
  });

  it('cardinality predictions match the real Kan engine (coherent probe)', () => {
    expect(verifyCardinality(G, a, { ks: [1, 2, 3] })).toEqual([]);
  });
});

describe('fiber analysis — API Gateway', () => {
  const { G, resourceObjects } = loadFunctor('apigw.schema');
  const a = analyzeFibers(G, resourceObjects);

  it('classifies methods 1:1 with their D method object', () => {
    expect(classOf(a, 'PublicMethod')).toMatchObject({ kind: 'correlated', drivers: ['Method'] });
    expect(classOf(a, 'AuthorizedMethod')).toMatchObject({
      kind: 'correlated',
      drivers: ['AuthMethod'],
    });
  });

  it('classifies Integration as a product of its type and uri value objects', () => {
    const integ = classOf(a, 'Integration');
    expect(integ.kind).toBe('product');
    expect(new Set(integ.drivers)).toEqual(new Set(['IntegrationType', 'IntegrationUri']));
  });

  it('classifies Deployment as toggle-driven (auto-created per API)', () => {
    const dep = classOf(a, 'Deployment');
    expect(dep.kind).toBe('product');
    expect(new Set(dep.drivers)).toEqual(new Set(['Api', 'DeployToggle']));
  });

  it('authorized method carries its path-equation constraints', () => {
    expect(classOf(a, 'AuthorizedMethod').collapsingEquations.length).toBeGreaterThan(0);
  });

  it('cardinality predictions match the real Kan engine (coherent probe)', () => {
    expect(verifyCardinality(G, a, { ks: [1, 2, 3] })).toEqual([]);
  });
});
