import * as path from 'path';
import { analyzeSchemaFile } from '../src/analyze-schema';
import { buildGraphModel } from '../src/graph-model';

const model = (file: string) =>
  buildGraphModel(analyzeSchemaFile(path.resolve(__dirname, '..', 'examples', file)));

describe('graph model — VPC', () => {
  const g = model('vpc.schema');

  it('has both panels and reports meta counts', () => {
    const panels = g.nodes.filter(n => n.role === 'panel').map(n => n.id);
    expect(panels).toEqual(expect.arrayContaining(['panel:D', 'panel:C']));
    expect(g.meta).toEqual({ domainObjects: 8, codomainObjects: 20, fibers: 9 });
  });

  it('shows the structural D-objects (drivers) but not value objects', () => {
    const dObjects = g.nodes.filter(n => n.role === 'd-object').map(n => n.label);
    expect(dObjects).toEqual(
      expect.arrayContaining(['Network', 'PublicTier', 'NatSlot', 'IgwToggle']),
    );
    // Value objects like CidrBlock are not drivers → not shown on the D side.
    expect(dObjects).not.toContain('CidrBlock');
  });

  it('groups each C-object under its fiber compound parent', () => {
    const publicRT = g.nodes.find(n => n.id === 'c/PublicRT');
    expect(publicRT).toMatchObject({ role: 'c-object', parent: 'fiber/PublicTier' });
    const fiberParent = g.nodes.find(n => n.id === 'fiber/PublicTier');
    expect(fiberParent).toMatchObject({ role: 'fiber', parent: 'panel:C' });
  });

  it('carries the cardinality badge and class onto product nodes', () => {
    const publicRT = g.nodes.find(n => n.id === 'c/PublicRT')!;
    expect(publicRT.kind).toBe('product');
    expect(publicRT.cardinality).toBe('|Network| × |PublicTier|');
    expect(new Set(publicRT.drivers)).toEqual(new Set(['Network', 'PublicTier']));
  });

  it('marks EIP as a singleton', () => {
    expect(g.nodes.find(n => n.id === 'c/EIP')).toMatchObject({ kind: 'singleton' });
  });

  it('emits G object-mapping edges d → G(d)', () => {
    const gEdge = g.edges.find(e => e.kind === 'g' && e.source === 'd/Network');
    expect(gEdge?.target).toBe('c/VPC');
  });

  it('flags cross-fiber C-edges', () => {
    const cross = g.edges.filter(e => e.kind === 'c' && e.crossFiber);
    expect(cross.length).toBeGreaterThan(0);
    // NatGateway → EIP crosses from the NatSlot fiber to the EIP fiber.
    expect(cross.some(e => e.source === 'c/NatGateway' && e.target === 'c/EIP')).toBe(true);
  });

  it('assigns every fiber a stable color index', () => {
    expect(Object.keys(g.fiberColors)).toHaveLength(9);
    expect(g.fiberColors.Network).toBe(0);
  });
});

describe('graph model — API Gateway', () => {
  const g = model('apigw.schema');

  it('models Integration as a product node', () => {
    const integ = g.nodes.find(n => n.id === 'c/Integration')!;
    expect(integ.kind).toBe('product');
    expect(new Set(integ.drivers)).toEqual(new Set(['IntegrationType', 'IntegrationUri']));
  });

  it('has a fiber per driver and every C-object placed', () => {
    const cObjects = g.nodes.filter(n => n.role === 'c-object');
    expect(cObjects).toHaveLength(g.meta.codomainObjects);
    for (const n of cObjects) expect(n.parent?.startsWith('fiber/')).toBe(true);
  });
});
