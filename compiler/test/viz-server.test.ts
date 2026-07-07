import { AddressInfo } from 'net';
import { server } from '../src/viz-server';

describe('viz server (smoke)', () => {
  let base: string;

  beforeAll(done => {
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      base = `http://127.0.0.1:${port}`;
      done();
    });
  });

  afterAll(done => {
    server.close(() => done());
  });

  it('serves the index page', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('schema visualizer');
  });

  it('lists example schemas', async () => {
    const res = await fetch(`${base}/examples`);
    const body = (await res.json()) as any;
    expect(body.examples).toEqual(expect.arrayContaining(['vpc.schema', 'apigw.schema']));
  });

  it('analyzes posted schema source into a graph model', async () => {
    const source = `
      schema C { obj AWS::EC2::VPC { CidrBlock { Value: String } } alias VPC }
      schema D { obj T::Net { CidrBlock { Value: String } } alias Net }
      map D -> C { Net -> VPC }
    `;
    const res = await fetch(`${base}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    });
    const body = (await res.json()) as any;
    expect(body.error).toBeUndefined();
    expect(body.meta.codomainObjects).toBeGreaterThan(0);
    expect(body.nodes.some((n: any) => n.id === 'c/VPC')).toBe(true);
  });

  it('returns a line/col error for malformed source', async () => {
    const res = await fetch(`${base}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'schema X {' }),
    });
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/Unterminated/);
    expect(body.line).toBe(1);
  });

  it('rejects path traversal on /examples', async () => {
    const res = await fetch(`${base}/examples/${encodeURIComponent('../../package.json')}`);
    expect(res.status).toBe(400);
  });
});
