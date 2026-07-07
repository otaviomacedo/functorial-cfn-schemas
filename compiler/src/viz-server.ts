/**
 * Zero-dependency local dev server for the schema visualization app.
 *
 *   npm run viz            # build + serve on http://localhost:4173
 *   npm run viz -- 8080    # custom port
 *
 * Routes:
 *   GET  /                     → viz/index.html
 *   GET  /app.js, /app.css     → static frontend assets (from viz/)
 *   GET  /vendor/<lib>.js      → cytoscape + fcose UMD builds from node_modules
 *   GET  /examples/<name>      → raw example .schema text (for the picker)
 *   POST /analyze              → { source } → graph JSON, or { error, line, col }
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeSchemaSource } from './analyze-schema';
import { buildGraphModel } from './graph-model';
import { LexError, ParseError } from './lexer';

/**
 * Locate the compiler package directory (which holds viz/, examples/,
 * node_modules/) by walking up from wherever this module runs. This works both
 * for the built layout (dist/compiler/src/viz-server.js) and when imported from
 * source by tests (src/viz-server.ts) — the hop count differs between them.
 */
function findPackageDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (
      fs.existsSync(path.join(dir, 'viz', 'index.html')) &&
      fs.existsSync(path.join(dir, 'examples'))
    ) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error('viz-server: could not locate the compiler package directory');
}

const PKG = findPackageDir();
const VIZ_DIR = path.join(PKG, 'viz');
const EXAMPLES_DIR = path.join(PKG, 'examples');
const NODE_MODULES = path.join(PKG, 'node_modules');

/** Vendored browser libraries, served under /vendor/ in dependency order. */
const VENDOR: Record<string, string> = {
  'layout-base.js': path.join(NODE_MODULES, 'cytoscape-fcose/node_modules/layout-base/layout-base.js'),
  'cose-base.js': path.join(NODE_MODULES, 'cytoscape-fcose/node_modules/cose-base/cose-base.js'),
  'cytoscape.js': path.join(NODE_MODULES, 'cytoscape/dist/cytoscape.min.js'),
  'cytoscape-fcose.js': path.join(NODE_MODULES, 'cytoscape-fcose/cytoscape-fcose.js'),
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sendFile(res: http.ServerResponse, filePath: string, mime?: string): void {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${path.basename(filePath)}`);
      return;
    }
    res.writeHead(200, { 'Content-Type': mime ?? MIME[path.extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function handleAnalyze(req: http.IncomingMessage, res: http.ServerResponse): void {
  let body = '';
  req.on('data', chunk => (body += chunk));
  req.on('end', () => {
    let source: string;
    try {
      source = JSON.parse(body).source ?? '';
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON request body' });
      return;
    }
    try {
      const analysis = analyzeSchemaSource(source);
      sendJson(res, 200, buildGraphModel(analysis));
    } catch (e) {
      if (e instanceof LexError || e instanceof ParseError) {
        sendJson(res, 200, { error: e.message, line: e.line, col: e.col });
      } else {
        sendJson(res, 200, { error: (e as Error).message });
      }
    }
  });
}

function listExamples(): string[] {
  try {
    return fs.readdirSync(EXAMPLES_DIR).filter(f => f.endsWith('.schema')).sort();
  } catch {
    return [];
  }
}

/** Guard against path traversal: resolve within `base` or reject. */
function safeJoin(base: string, name: string): string | null {
  const resolved = path.join(base, name);
  if (!resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'POST' && pathname === '/analyze') {
    handleAnalyze(req, res);
    return;
  }

  if (pathname === '/' || pathname === '/index.html') {
    sendFile(res, path.join(VIZ_DIR, 'index.html'));
    return;
  }

  if (pathname === '/examples') {
    sendJson(res, 200, { examples: listExamples() });
    return;
  }

  if (pathname.startsWith('/examples/')) {
    const name = decodeURIComponent(pathname.slice('/examples/'.length));
    const file = safeJoin(EXAMPLES_DIR, name);
    if (!file) {
      res.writeHead(400);
      res.end('bad path');
      return;
    }
    sendFile(res, file, 'text/plain; charset=utf-8');
    return;
  }

  if (pathname.startsWith('/vendor/')) {
    const name = pathname.slice('/vendor/'.length);
    const file = VENDOR[name];
    if (!file) {
      res.writeHead(404);
      res.end('unknown vendor lib');
      return;
    }
    sendFile(res, file, MIME['.js']);
    return;
  }

  // Static frontend assets (app.js, app.css, …).
  if (pathname.startsWith('/') && (pathname.endsWith('.js') || pathname.endsWith('.css'))) {
    const file = safeJoin(VIZ_DIR, pathname.slice(1));
    if (!file) {
      res.writeHead(400);
      res.end('bad path');
      return;
    }
    sendFile(res, file);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

// Only start listening when run directly (npm run viz), not when imported by tests.
if (require.main === module) {
  const port = Number(process.argv[2]) || 4173;
  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`\n  Schema visualizer running at http://localhost:${port}\n`);
  });
}

export { server };
