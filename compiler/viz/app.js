/* global cytoscape, cytoscapeFcose */
'use strict';

console.log('[viz] app.js build: highlight-dim-leaves-v3');

// Register the fcose compound layout (UMD global from /vendor/cytoscape-fcose.js).
if (window.cytoscapeFcose) cytoscape.use(window.cytoscapeFcose);

// A 12-color qualitative palette (fill, border) — high-contrast on the dark bg,
// cycled by fiber colorIndex.
const PALETTE = [
  ['#8ecae6', '#4a90b8'], // blue
  ['#a3d9a5', '#4a9d54'], // green
  ['#ffd48a', '#d68a1e'], // amber
  ['#d3a5e0', '#9a55b0'], // purple
  ['#9fe0d8', '#3fa596'], // teal
  ['#ffb3ba', '#d65560'], // red
  ['#b5b9e8', '#5560c0'], // indigo
  ['#f5c9a0', '#c8763a'], // orange
  ['#c9e08a', '#8aa53a'], // lime
  ['#f0a5c8', '#c04a86'], // pink
  ['#a5cbe0', '#4a7ba5'], // steel
  ['#d8c98a', '#a5923a'], // gold
];
const fill = (i) => PALETTE[i % PALETTE.length][0];
const stroke = (i) => PALETTE[i % PALETTE.length][1];

const editor = document.getElementById('editor');
const errorBar = document.getElementById('error-bar');
const statusEl = document.getElementById('status');
const metaEl = document.getElementById('meta');
const legendEl = document.getElementById('legend');
const detailEl = document.getElementById('detail');
const picker = document.getElementById('example-picker');

let cy = null;
let lastFiberColors = {};

// ---- Cytoscape base styles -------------------------------------------------

const cyStyle = [
  {
    selector: 'node[role="panel"]',
    style: {
      'background-color': '#12151b',
      'background-opacity': 0.5,
      'border-color': '#3a4150',
      'border-width': 1.5,
      shape: 'round-rectangle',
      label: 'data(label)',
      'text-valign': 'top',
      'text-halign': 'center',
      'font-size': 13,
      'font-weight': 600,
      color: '#9aa4b2',
      'text-margin-y': -6,
      padding: 18,
    },
  },
  {
    selector: 'node[role="fiber"]',
    style: {
      'background-color': 'data(fillColor)',
      'background-opacity': 0.1,
      'border-color': 'data(strokeColor)',
      'border-width': 1.5,
      'border-style': 'dashed',
      shape: 'round-rectangle',
      label: 'data(label)',
      'text-valign': 'top',
      'text-halign': 'center',
      'font-size': 11,
      color: 'data(strokeColor)',
      'text-margin-y': -4,
      padding: 12,
    },
  },
  {
    selector: 'node[role="d-object"]',
    style: {
      'background-color': 'data(fillColor)',
      'border-color': 'data(strokeColor)',
      'border-width': 2,
      shape: 'round-rectangle',
      label: 'data(label)',
      'text-valign': 'center',
      'text-halign': 'center',
      'font-size': 12,
      'font-weight': 600,
      color: '#0f1115',
      width: 'label',
      height: 26,
      padding: 8,
    },
  },
  {
    selector: 'node[role="c-object"]',
    style: {
      'background-color': 'data(fillColor)',
      'background-opacity': 0.85,
      'border-color': 'data(strokeColor)',
      'border-width': 1.5,
      shape: 'round-rectangle',
      label: 'data(badge)',
      'text-valign': 'center',
      'text-halign': 'center',
      'text-wrap': 'wrap',
      'font-size': 10,
      color: '#0f1115',
      width: 'label',
      height: 'label',
      padding: 8,
    },
  },
  // singleton badge: dashed border to signal "auto-created"
  {
    selector: 'node[role="c-object"][kind="singleton"]',
    style: { 'border-style': 'dashed', 'border-width': 2 },
  },
  {
    selector: 'edge',
    style: {
      'curve-style': 'bezier',
      width: 1.2,
      'line-color': '#3a4150',
      'target-arrow-color': '#3a4150',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 0.9,
      'font-size': 8,
      color: '#7a8494',
      'text-background-color': '#0f1115',
      'text-background-opacity': 0.7,
      'text-background-padding': 2,
    },
  },
  {
    selector: 'edge[kind="d"]',
    style: { label: 'data(label)', 'line-color': '#5a6472', 'target-arrow-color': '#5a6472' },
  },
  {
    selector: 'edge[kind="c"]',
    style: { label: 'data(label)', width: 1, 'line-opacity': 0.55 },
  },
  {
    selector: 'edge[kind="c"][?crossFiber]',
    style: { 'line-color': '#c8763a', 'target-arrow-color': '#c8763a', 'line-opacity': 0.9, width: 1.6 },
  },
  {
    selector: 'edge[kind="g"]',
    style: {
      'line-color': '#6ea8fe',
      'target-arrow-color': '#6ea8fe',
      'line-style': 'dashed',
      'line-opacity': 0.5,
      width: 1.2,
      'target-arrow-shape': 'vee',
    },
  },
  // Hover de-emphasis. We fade everything NOT in the hovered fiber; kept
  // elements get no class at all, so they render exactly as normal.
  //
  // IMPORTANT: `.dim` is only ever applied to leaf nodes and edges — never to
  // the compound containers (panels, fiber boxes). Cytoscape multiplies a
  // child's opacity by its parent's, so dimming a container would drag every
  // kept child down with it (boxes go faint, labels vanish).
  { selector: '.dim', style: { opacity: 0.15 } },
];

function badgeText(node) {
  // Two-line label: name + cardinality formula.
  if (node.cardinality && node.cardinality !== '1') return `${node.label}\n${node.cardinality}`;
  if (node.kind === 'singleton') return `${node.label}\n(singleton)`;
  return node.label;
}

function toElements(model) {
  const nodes = model.nodes.map((n) => {
    const data = { ...n };
    if (typeof n.colorIndex === 'number') {
      data.fillColor = fill(n.colorIndex);
      data.strokeColor = stroke(n.colorIndex);
    }
    if (n.role === 'c-object') data.badge = badgeText(n);
    return { data };
  });
  const edges = model.edges.map((e) => ({ data: e }));
  return [...nodes, ...edges];
}

function render(model) {
  lastFiberColors = model.fiberColors || {};
  const elements = toElements(model);

  if (cy) cy.destroy();
  cy = cytoscape({
    container: document.getElementById('cy'),
    elements,
    style: cyStyle,
    wheelSensitivity: 0.2,
  });

  window.cy = cy; // exposed for debugging / headless assertions

  const layout = cy.layout({
    name: window.cytoscapeFcose ? 'fcose' : 'cose',
    quality: 'default',
    animate: false,
    nodeSeparation: 90,
    idealEdgeLength: 90,
    nodeRepulsion: 9000,
    packComponents: true,
    tile: true,
  });
  layout.run();
  cy.fit(undefined, 30);

  wireInteractions();
  renderLegend(model);
}

// ---- Interactions: hover highlights a fiber; click shows detail ------------

function wireInteractions() {
  cy.on('mouseover', 'node[role="c-object"], node[role="d-object"]', (evt) => {
    highlightFiber(evt.target.data('fiber'));
  });
  cy.on('mouseout', 'node', () => clearHighlight());

  cy.on('tap', 'node[role="c-object"]', (evt) => showDetail(evt.target.data()));
  cy.on('tap', (evt) => {
    if (evt.target === cy) detailEl.classList.add('hidden');
  });
}

function highlightFiber(fiber) {
  if (!fiber) return;
  cy.batch(() => {
    cy.elements().removeClass('dim');

    // The kept set: every element belonging to the hovered fiber — its
    // d-object, its fiber box, and its c-objects (which include G(d)). These
    // are left untouched so they render exactly as normal.
    const kept = cy.nodes(`[fiber="${cssEsc(fiber)}"]`);
    const keptIds = new Set(kept.map((n) => n.id()));

    // Dim only leaf nodes outside the fiber. Compound containers (panels, fiber
    // boxes) are never dimmed: their opacity cascades onto kept children.
    cy.nodes('[role="d-object"], [role="c-object"]').forEach((n) => {
      if (!keptIds.has(n.id())) n.addClass('dim');
    });

    // An edge stays bright only when BOTH endpoints are kept; otherwise it dims.
    cy.edges().forEach((e) => {
      if (!keptIds.has(e.source().id()) || !keptIds.has(e.target().id())) e.addClass('dim');
    });
  });
}

function clearHighlight() {
  cy.batch(() => cy.elements().removeClass('dim'));
}

function showDetail(d) {
  const drivers = (d.drivers || []).length ? d.drivers.join(', ') : '—';
  const eqs = (d.equations || []).length
    ? `<div class="eq">constrained by:\n${d.equations.map((e) => '  ' + e).join('\n')}</div>`
    : '';
  const kindLabel = { singleton: 'singleton (auto-created)', correlated: '1:1 correlated', product: 'product' }[d.kind] || d.kind;
  detailEl.innerHTML = `
    <span class="close">×</span>
    <div class="title">${d.label}</div>
    <div class="card">${d.cardinality || '1'}</div>
    <div><span class="k">kind:</span> ${kindLabel}</div>
    <div><span class="k">fiber:</span> ${d.fiber}</div>
    <div><span class="k">drivers:</span> ${drivers}</div>
    ${eqs}
  `;
  detailEl.classList.remove('hidden');
  detailEl.querySelector('.close').onclick = () => detailEl.classList.add('hidden');
}

function renderLegend(model) {
  const rows = Object.entries(model.fiberColors)
    .map(
      ([fiber, i]) =>
        `<div class="row" data-fiber="${escapeHtml(fiber)}"><span class="swatch" style="background:${fill(i)};border:1px solid ${stroke(i)}"></span>${escapeHtml(fiber)}</div>`,
    )
    .join('');
  legendEl.innerHTML = `
    <h4>Fibers</h4>
    ${rows}
    <div class="kinds">
      <div class="row">solid = 1:1 / product</div>
      <div class="row">dashed border = singleton</div>
      <div class="row"><span class="swatch" style="background:#c8763a"></span>cross-fiber ref</div>
      <div class="row"><span class="swatch" style="background:#6ea8fe"></span>G: d → G(d)</div>
    </div>`;
  legendEl.querySelectorAll('.row[data-fiber]').forEach((row) => {
    row.onmouseenter = () => highlightFiber(row.dataset.fiber);
    row.onmouseleave = () => clearHighlight();
  });
}

// ---- Analyze pipeline ------------------------------------------------------

let analyzeTimer = null;
function scheduleAnalyze() {
  clearTimeout(analyzeTimer);
  statusEl.textContent = 'editing…';
  statusEl.className = 'status';
  analyzeTimer = setTimeout(analyze, 350);
}

async function analyze() {
  const source = editor.value;
  try {
    const resp = await fetch('/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    });
    const data = await resp.json();
    if (data.error) {
      showError(data);
      return;
    }
    errorBar.classList.add('hidden');
    statusEl.textContent = 'analyzed';
    statusEl.className = 'status ok';
    metaEl.textContent = `${data.meta.domainObjects} D-objects · ${data.meta.codomainObjects} C-objects · ${data.meta.fibers} fibers`;
    render(data);
  } catch (e) {
    showError({ error: String(e) });
  }
}

function showError(data) {
  const loc = data.line ? ` (line ${data.line}, col ${data.col})` : '';
  errorBar.textContent = `⚠ ${data.error}${loc}`;
  errorBar.classList.remove('hidden');
  statusEl.textContent = 'error';
  statusEl.className = 'status err';
}

// ---- Example picker + bootstrap -------------------------------------------

async function loadExamples() {
  try {
    const resp = await fetch('/examples');
    const { examples } = await resp.json();
    picker.innerHTML = examples.map((f) => `<option value="${f}">${f}</option>`).join('');
    if (examples.length) await loadExample(examples.find((e) => e.includes('vpc')) || examples[0]);
  } catch {
    /* no examples available */
  }
}

async function loadExample(name) {
  picker.value = name;
  const resp = await fetch('/examples/' + encodeURIComponent(name));
  editor.value = await resp.text();
  await analyze();
}

picker.onchange = () => loadExample(picker.value);
editor.addEventListener('input', scheduleAnalyze);

function cssEsc(s) {
  return s.replace(/["\\]/g, '\\$&');
}
function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

loadExamples();
