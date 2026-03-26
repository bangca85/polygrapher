import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SystemMap } from '../types/graph.types.js';

function loadCytoscapeSource(): string {
  // Try to load from node_modules (works both in dev and installed package)
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(__dirname, '..', 'node_modules', 'cytoscape', 'dist', 'cytoscape.min.js'),
    path.resolve(__dirname, '..', '..', 'node_modules', 'cytoscape', 'dist', 'cytoscape.min.js'),
    path.resolve(__dirname, '..', '..', '..', 'node_modules', 'cytoscape', 'dist', 'cytoscape.min.js'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf-8');
    }
  }
  throw new Error('Could not find cytoscape.min.js — run npm install');
}

export function generateViewerHtml(
  systemMap: SystemMap,
  rootPath: string,
  options?: { inline?: boolean; dataUrl?: string }
): string {
  const nodeCount = systemMap.nodes.length;
  const edgeCount = systemMap.edges.length;
  const isInline = options?.inline !== undefined ? options.inline : nodeCount < 1000;
  const dataUrl = options?.dataUrl || './system-map.json';
  // Escape </ and <!-- sequences to prevent script/comment injection (M-1 security fix)
  const graphJson = isInline ? JSON.stringify(systemMap).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--') : '';
  const cytoscapeSrc = loadCytoscapeSource();
  const safeRepoName = systemMap.meta.repo.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Polygrapher — ${safeRepoName}</title>
<script>${cytoscapeSrc}</script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
    background: #0d1117;
    color: #c9d1d9;
    height: 100vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* Header */
  .header {
    display: flex;
    align-items: center;
    gap: 8px 12px;
    padding: 8px 16px;
    background: #161b22;
    border-bottom: 1px solid #30363d;
    flex-shrink: 0;
    z-index: 10;
    flex-wrap: wrap;
  }
  .header h1 {
    font-size: 14px;
    font-weight: 600;
    color: #58a6ff;
    white-space: nowrap;
  }
  .header .stats {
    font-size: 11px;
    color: #8b949e;
    white-space: nowrap;
  }
  .search-box {
    flex: 1 1 200px;
    max-width: 360px;
    min-width: 160px;
    position: relative;
  }
  .search-box input {
    width: 100%;
    padding: 6px 12px 6px 32px;
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 6px;
    color: #c9d1d9;
    font-size: 13px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s;
  }
  .search-box input:focus {
    border-color: #58a6ff;
    box-shadow: 0 0 0 3px rgba(88,166,255,0.1);
  }
  .search-box input::placeholder { color: #484f58; }
  .search-box::before {
    content: '⌕';
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    color: #484f58;
    font-size: 14px;
    pointer-events: none;
  }
  .search-count {
    font-size: 11px;
    color: #8b949e;
    white-space: nowrap;
  }

  /* Main */
  .main {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  /* Graph */
  #cy {
    flex: 1;
    min-height: 400px;
    background: #0d1117;
    position: relative;
  }

  /* Detail Panel */
  .detail-panel {
    width: 360px;
    background: #161b22;
    border-left: 1px solid #30363d;
    overflow-y: auto;
    flex-shrink: 0;
    transition: transform 0.2s ease;
    padding: 0;
  }
  .detail-panel.hidden {
    width: 0;
    padding: 0;
    border: none;
    overflow: hidden;
  }
  .panel-header {
    padding: 16px 20px 12px;
    border-bottom: 1px solid #30363d;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  .panel-header h2 {
    font-size: 16px;
    font-weight: 600;
    color: #f0f6fc;
    word-break: break-all;
  }
  .panel-close {
    background: none;
    border: none;
    color: #8b949e;
    font-size: 18px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .panel-close:hover { background: #21262d; color: #c9d1d9; }
  .panel-section {
    padding: 12px 20px;
    border-bottom: 1px solid #21262d;
  }
  .panel-section h3 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #8b949e;
    margin-bottom: 8px;
  }
  .panel-row {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
    font-size: 13px;
  }
  .panel-row .label { color: #8b949e; }
  .panel-row .value { color: #c9d1d9; text-align: right; }
  .panel-signature {
    font-size: 12px;
    color: #7ee787;
    background: #0d1117;
    padding: 8px 12px;
    border-radius: 6px;
    overflow-x: auto;
    white-space: pre;
    margin-top: 4px;
  }
  .file-link {
    color: #58a6ff;
    text-decoration: none;
    cursor: pointer;
    font-size: 13px;
  }
  .file-link:hover { text-decoration: underline; }
  .connection-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 0;
    font-size: 13px;
  }
  .connection-item .arrow { color: #484f58; }
  .connection-item .conn-name {
    color: #58a6ff;
    cursor: pointer;
  }
  .connection-item .conn-name:hover { text-decoration: underline; }
  .connection-item .conn-type {
    font-size: 11px;
    color: #8b949e;
    background: #21262d;
    padding: 1px 6px;
    border-radius: 10px;
  }

  /* Filter toggles */
  .filters {
    display: flex;
    gap: 4px;
    align-items: center;
    flex-wrap: wrap;
  }
  .filter-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-family: inherit;
    color: #8b949e;
    background: none;
    border: 1px solid transparent;
    border-radius: 12px;
    padding: 3px 10px;
    cursor: pointer;
    transition: all 0.15s;
    user-select: none;
  }
  .filter-btn:hover { background: #21262d; }
  .filter-btn.active {
    border-color: var(--fc);
    color: var(--fc);
    background: rgba(255,255,255,0.04);
  }
  .filter-btn .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }

  /* Node type badge */
  .type-badge {
    display: inline-block;
    font-size: 11px;
    padding: 1px 8px;
    border-radius: 10px;
    font-weight: 500;
  }
  .type-function { background: #1f3a5f; color: #58a6ff; }
  .type-handler { background: #2c1f3f; color: #bc8cff; }
  .type-service { background: #1f3f2c; color: #7ee787; }
  .type-route { background: #3f2c1f; color: #f0883e; }
  .type-component { background: #3f1f2c; color: #ff7b72; }
  .type-struct { background: #3f3f1f; color: #e3b341; }


  /* Path Tracing (Epic 7) */
  .trace-controls {
    display: flex;
    gap: 2px;
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 2px;
  }
  .trace-controls button {
    font-family: inherit;
    font-size: 11px;
    padding: 3px 8px;
    border: none;
    border-radius: 4px;
    background: none;
    color: #8b949e;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .trace-controls button:hover { color: #c9d1d9; background: #21262d; }
  .trace-controls button.active { background: #2a1f00; color: #FFD700; border: 1px solid #FFD700; }
  .trace-controls .trace-label { font-size: 10px; color: #484f58; padding: 3px 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .depth-badge {
    position: absolute;
    top: -6px;
    right: -6px;
    font-size: 9px;
    background: #FFD700;
    color: #0d1117;
    border-radius: 50%;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    pointer-events: none;
  }


  /* Auto-Clustering (Epic 9) */
  .cluster-controls {
    display: flex;
    gap: 2px;
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 2px;
  }
  .cluster-controls button {
    font-family: inherit;
    font-size: 11px;
    padding: 3px 8px;
    border: none;
    border-radius: 4px;
    background: none;
    color: #8b949e;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .cluster-controls button:hover { color: #c9d1d9; background: #21262d; }
  .cluster-controls button.active { background: #21262d; color: #f0f6fc; }



  /* Minimap (Epic 11) */
  #minimap {
    position: absolute;
    bottom: 16px;
    right: 16px;
    width: 150px;
    height: 150px;
    /* Shift left when detail panel is open (panel is 360px + 1px border) */
    transition: right 0.2s, opacity 0.2s;
    background: rgba(22,27,34,0.92);
    border: 1px solid #30363d;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    z-index: 100;
    overflow: hidden;
    cursor: crosshair;
    transition: opacity 0.2s;
  }
  #minimap.hidden { display: none; }
  #minimap canvas { width: 100%; height: 100%; }
  .minimap-toggle {
    font-family: inherit;
    font-size: 11px;
    padding: 3px 8px;
    border: 1px solid #30363d;
    border-radius: 4px;
    background: #0d1117;
    color: #8b949e;
    cursor: pointer;
    transition: all 0.15s;
  }
  .minimap-toggle:hover { color: #c9d1d9; background: #21262d; }
  .minimap-toggle.active { color: #58a6ff; border-color: #58a6ff; }

  /* Expand/Collapse Nodes (Epic 10) */
  .expand-badge {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    background: #21262d;
    color: #c9d1d9;
    border-radius: 4px;
    width: 14px;
    height: 14px;
    font-weight: 700;
    position: absolute;
    border: 1px solid #30363d;
    cursor: pointer;
    user-select: none;
    transition: all 0.15s;
    z-index: 10;
  }
  .expand-badge:hover {
    background: #30363d;
    color: #fff;
    border-color: #58a6ff;
  }

  /* Edge tooltip */
  .edge-tooltip {
    position: fixed;
    pointer-events: none;
    background: #1c2128;
    border: 1px solid #444c56;
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 12px;
    font-family: inherit;
    color: #c9d1d9;
    z-index: 1000;
    white-space: nowrap;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    opacity: 0;
    transition: opacity 0.12s ease;
  }
  .edge-tooltip.visible { opacity: 1; }
  .edge-tooltip .tt-type { color: #f0883e; font-weight: 600; }
  .edge-tooltip .tt-protocol { color: #8b949e; }
  .edge-tooltip .tt-meta { color: #7ee787; font-size: 11px; margin-top: 2px; }

  /* View toggle */
  .view-toggle {
    display: flex;
    gap: 2px;
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 2px;
  }
  .view-toggle button {
    font-family: inherit;
    font-size: 12px;
    padding: 4px 10px;
    border: none;
    border-radius: 4px;
    background: none;
    color: #8b949e;
    cursor: pointer;
    transition: all 0.15s;
  }
  .view-toggle button:hover { color: #c9d1d9; }
  .view-toggle button.active { background: #21262d; color: #f0f6fc; }

  /* List view */
  #listView {
    display: none;
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    background: #0d1117;
  }
  #listView.active { display: block; }
  #cy.hidden { display: none; }

  .list-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .list-table th {
    text-align: left;
    padding: 8px 12px;
    border-bottom: 1px solid #30363d;
    color: #8b949e;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
    position: sticky;
    top: 0;
    background: #0d1117;
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
  }
  .list-table th:hover { color: #c9d1d9; }
  .list-table th .sort-arrow { margin-left: 4px; font-size: 10px; }
  .list-table td {
    padding: 6px 12px;
    border-bottom: 1px solid #161b22;
    color: #c9d1d9;
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .list-table tr { cursor: pointer; transition: background 0.1s; }
  .list-table tr:hover { background: #161b22; }
  .list-table tr.selected { background: #1f2937; }
  .list-conn-count {
    font-size: 12px;
    color: #8b949e;
    text-align: center;
  }

  /* Loading overlay */
  #loading-overlay {
    position: fixed;
    inset: 0;
    background: #0d1117;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    transition: opacity 0.3s ease;
  }
  #loading-overlay.fade-out {
    opacity: 0;
    pointer-events: none;
  }
  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 3px solid #21262d;
    border-top-color: #58a6ff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loading-text {
    margin-top: 16px;
    font-size: 14px;
    color: #8b949e;
  }
  .loading-repo {
    font-size: 16px;
    color: #58a6ff;
    font-weight: 600;
    margin-bottom: 8px;
  }
  .loading-stats {
    font-size: 12px;
    color: #484f58;
    margin-top: 4px;
  }

  /* Tier banner */
  .tier-banner {
    padding: 6px 16px;
    background: #1c1f26;
    border-bottom: 1px solid #30363d;
    font-size: 12px;
    color: #d29922;
    text-align: center;
    display: none;
  }
  .tier-banner.visible { display: block; }
</style>
</head>
<body>

<div class="header">
  <h1>⬡ ${safeRepoName}</h1>
  <div class="stats">${systemMap.nodes.length} nodes · ${systemMap.edges.length} edges</div>
  <div class="search-box">
    <input type="text" id="searchInput" placeholder="Search functions, handlers, files..." />
  </div>
  <div class="search-count" id="searchCount"></div>
  <div class="filters" id="filters">
    <button class="filter-btn active" data-type="function" style="--fc:#58a6ff"><span class="dot" style="background:#58a6ff"></span>function</button>
    <button class="filter-btn active" data-type="handler" style="--fc:#bc8cff"><span class="dot" style="background:#bc8cff"></span>handler</button>
    <button class="filter-btn active" data-type="service" style="--fc:#7ee787"><span class="dot" style="background:#7ee787"></span>service</button>
    <button class="filter-btn active" data-type="grpc" style="--fc:#56d364"><span class="dot" style="background:#56d364"></span>gRPC</button>
    <button class="filter-btn active" data-type="route" style="--fc:#f0883e"><span class="dot" style="background:#f0883e"></span>route</button>
    <button class="filter-btn active" data-type="worker" style="--fc:#d2a8ff"><span class="dot" style="background:#d2a8ff"></span>worker</button>
    <button class="filter-btn active" data-type="component" style="--fc:#ff7b72"><span class="dot" style="background:#ff7b72"></span>component</button>
    <button class="filter-btn active" data-type="struct" style="--fc:#e3b341"><span class="dot" style="background:#e3b341"></span>struct</button>
  </div>
  <div class="cluster-controls" id="clusterControls" style="display:none">
    <button id="collapseAllBtn" title="Collapse all clusters">▢ Collapse All</button>
    <button id="expandAllBtn" title="Expand all clusters">▣ Expand All</button>
    <button id="toggleClusterBtn" class="active" title="Toggle flat/clustered view">⬡ Clustered</button>
  </div>
    <div class="trace-controls" id="traceControls" style="display:none">
    <span class="trace-label">Trace</span>
    <button data-trace="upstream" title="Upstream callers (U)">↑ Up</button>
    <button data-trace="downstream" title="Downstream callees (D)">↓ Down</button>
    <button data-trace="both" title="Bidirectional (B)">↕ Both</button>
    <button data-trace="clear" title="Clear trace (Esc)">✕</button>
  </div>
    <div class="view-toggle" id="viewToggle">
    <button class="active" data-view="graph">Graph</button>
    <button data-view="list">List</button>
  </div>
  <button class="minimap-toggle active" id="minimapToggle" title="Toggle minimap (M)">⊞ Map</button>
</div>

<div class="main">
  <div id="cy"></div>
  <div id="listView"></div>
  <div class="detail-panel hidden" id="detailPanel"></div>
  <div class="edge-tooltip" id="edgeTooltip"></div>
  <div id="minimap"><canvas id="minimapCanvas"></canvas></div>
</div>
<div id="tierBanner" class="tier-banner"></div>
${!isInline ? `
<div id="loading-overlay">
  <div class="loading-repo">⬡ ${safeRepoName}</div>
  <div class="loading-spinner"></div>
  <div class="loading-text" id="loadingText">Loading ${nodeCount.toLocaleString()} nodes...</div>
  <div class="loading-stats">${nodeCount.toLocaleString()} nodes · ${edgeCount.toLocaleString()} edges</div>
</div>` : ''}

<script>
const ROOT_PATH = ${JSON.stringify(rootPath)};
${isInline ? `const GRAPH_DATA = ${graphJson};` : `var GRAPH_DATA = null;`}

${!isInline ? `
// Async data loading for large graphs
(function() {
  var loadingText = document.getElementById('loadingText');
  fetch('${dataUrl}')
    .then(function(res) {
      if (!res.ok) throw new Error('Failed to load data: ' + res.status);
      return res.json();
    })
    .then(function(data) {
      GRAPH_DATA = data;
      // Update loading text — overlay stays visible during init + layout
      var loadingText = document.getElementById('loadingText');
      if (loadingText) loadingText.textContent = 'Rendering ' + data.nodes.length.toLocaleString() + ' nodes...';
      // Defer to next frame so browser paints the loading text before heavy work
      setTimeout(initViewer, 50);
    })
    .catch(function(err) {
      if (loadingText) loadingText.textContent = 'Error: ' + err.message;
      console.error(err);
    });
})();

function initViewer() {
` : ''}
const NODE_COLORS = {
  'function': '#58a6ff',
  'handler': '#bc8cff',
  'service': '#7ee787',
  'grpc':    '#56d364',
  'route':   '#f0883e',
  'component': '#ff7b72',
  'struct': '#e3b341',
  'worker': '#d2a8ff',
};

// HTML escape to prevent XSS from node names/IDs
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Build node ID set for edge validation
const nodeIds = new Set(GRAPH_DATA.nodes.map(n => n.id));

// Create virtual route nodes from routes-to edges (which link function -> handler)
const routeEdges = GRAPH_DATA.edges.filter(e => e.type === 'routes-to');
const routeNodes = new Map();
routeEdges.forEach(e => {
  const meta = e.metadata || {};
  const routeId = 'route-' + (meta.method || '') + '-' + encodeURIComponent(meta.path || '');
  if (!routeNodes.has(routeId)) {
    routeNodes.set(routeId, {
      id: routeId,
      label: (meta.method || '?') + ' ' + (meta.path || '/?'),
      type: 'route',
      nodeColor: NODE_COLORS['route'],
    });
    nodeIds.add(routeId);
  }
  // Insert route node between source function and handler:
  // source -> routeNode -> handler
  e._routeNodeId = routeId;
});

// Build Cytoscape elements
const elements = [];
GRAPH_DATA.nodes.forEach(n => {
  elements.push({
    data: {
      id: n.id,
      label: n.name,
      type: n.type,
      language: n.language,
      file: n.file,
      line: n.line,
      signature: n.signature,
      repo: n.repo,
      nodeColor: NODE_COLORS[n.type] || '#8b949e',
    }
  });
});
routeNodes.forEach(rn => {
  elements.push({ data: rn });
});
GRAPH_DATA.edges.forEach((e, i) => {
  if (e._routeNodeId) {
    // Route edge: split into source -> routeNode -> handler
    const routeId = e._routeNodeId;
    // Resolve source file for call-site link (needed when srcNode is virtual route node)
    const origSrcNode = GRAPH_DATA.nodes.find(n => n.id === e.source);
    const callFile = origSrcNode ? origSrcNode.file : null;
    if (nodeIds.has(e.source)) {
      elements.push({
        data: {
          id: 'e' + i + 'a',
          source: e.source,
          target: routeId,
          edgeType: 'routes-to',
          protocol: e.protocol,
          metadata: e.metadata || {},
          callLine: e.callLine || null,
          callFile: callFile,
          edgeColor: '#f0883e',
        }
      });
    }
    if (nodeIds.has(e.target)) {
      elements.push({
        data: {
          id: 'e' + i + 'b',
          source: routeId,
          target: e.target,
          edgeType: 'routes-to',
          protocol: e.protocol,
          metadata: e.metadata || {},
          callLine: e.callLine || null,
          callFile: callFile,
          edgeColor: '#f0883e',
        }
      });
    }
  } else {
    const src = e.source;
    const tgt = e.target;
    if (!nodeIds.has(src) || !nodeIds.has(tgt)) return;
    elements.push({
      data: {
        id: 'e' + i,
        source: src,
        target: tgt,
        edgeType: e.type,
        protocol: e.protocol,
        metadata: e.metadata || {},
        callLine: e.callLine || null,
        edgeColor: e.type === 'calls' ? '#484f58' : '#30363d',
      }
    });
  }
});

// Adapt layout and label strategy to graph size
const nodeCount = elements.filter(e => !e.data.source).length;
const isLarge = nodeCount > 80;

// Tiered rendering strategy
var renderTier = 1; // Tier 1: full COSE (< 1000 nodes)
if (nodeCount >= 10000) renderTier = 3; // Tier 3: list-only
else if (nodeCount >= 1000) renderTier = 2; // Tier 2: grid layout + progressive edges

// Show tier banner
var tierBanner = document.getElementById('tierBanner');
if (renderTier === 2) {
  tierBanner.textContent = '⚡ Large codebase (' + nodeCount.toLocaleString() + ' nodes) — using fast layout for performance';
  tierBanner.classList.add('visible');
} else if (renderTier === 3) {
  tierBanner.textContent = '⚠ Very large codebase (' + nodeCount.toLocaleString() + ' nodes) — use filters or search to explore. Graph view available when filtered below 2,000 nodes.';
  tierBanner.classList.add('visible');
}

// Truncate label for large graphs
function truncLabel(label) {
  if (!isLarge || !label) return label;
  return label.length > 20 ? label.slice(0, 18) + '…' : label;
}
elements.forEach(e => {
  if (e.data.label && !e.data.source) {
    e.data.shortLabel = truncLabel(e.data.label);
  }
});

// ==== GLOBAL VISIBILITY STATE ====
var expandedNodes = new Set();
var persistKey = 'polygrapher_expanded_' + GRAPH_DATA.meta.repo;
try {
  var saved = sessionStorage.getItem(persistKey);
  if (saved) {
    JSON.parse(saved).forEach(function(id) { expandedNodes.add(id); });
  }
} catch(e) {}
function saveExpandedState() {
  try { sessionStorage.setItem(persistKey, JSON.stringify(Array.from(expandedNodes))); } catch(e) {}
}

const activeTypes = new Set(['function', 'handler', 'service', 'grpc', 'route', 'component', 'struct', 'worker']);
var clusteringEnabled = nodeCount > 50;
var collapsedClusters = new Set();
var clusterMap = {}; // nodeId -> clusterId
var clusterNodes = new Map(); // clusterId -> { label, children }

function updateVisibilityStates() {
  cy.batch(function() {
    cy.nodes().forEach(function(n) {
      if (n.isParent()) return; // Cytoscape manages parent node visibility automatically
      var isHiddenByCluster = false;
      var cid = clusterMap[n.id()];
      if (cid && collapsedClusters.has(cid)) {
        isHiddenByCluster = true;
      }
      var isHiddenByEpic10 = n.hasClass('hidden-callee');
      var isFiltered = !activeTypes.has(n.data('type'));
      
      if (isHiddenByCluster || isHiddenByEpic10 || isFiltered) {
        n.style('display', 'none');
      } else {
        n.style('display', 'element');
      }
    });

    cy.edges().forEach(function(e) {
      if (e.hasClass('aggregated-edge')) return;
      var isHiddenByEpic10 = e.hasClass('hidden-callee-edge');
      if (isHiddenByEpic10) {
        e.style('display', 'none');
        return;
      }
      var srcVis = e.source().style('display') !== 'none';
      var tgtVis = e.target().style('display') !== 'none';
      e.style('display', (srcVis && tgtVis) ? 'element' : 'none');
    });
  });
  
  if (typeof updateAggregatedEdges === 'function') updateAggregatedEdges();
  if (typeof updateBadges === 'function') updateBadges();
  
  var visible = cy.nodes().filter(function(n) { return n.style('display') !== 'none' && !n.isParent(); }).length;
  var total = cy.nodes().filter(function(n) { return !n.isParent(); }).length;
  var statsEl = document.querySelector('.stats');
  if (statsEl) {
    if (visible < total) {
      statsEl.textContent = visible + '/' + total + ' nodes · ' + GRAPH_DATA.edges.length + ' edges';
    } else {
      statsEl.textContent = total + ' nodes · ' + GRAPH_DATA.edges.length + ' edges';
    }
  }

  if (typeof currentView !== 'undefined' && currentView === 'list' && typeof renderListView === 'function') {
    renderListView();
  }

  // Tier 3: re-enable/disable graph button based on visible node count
  if (typeof renderTier !== 'undefined' && renderTier === 3) {
    var graphBtnEl = document.querySelector('#viewToggle button[data-view="graph"]');
    if (graphBtnEl) {
      if (visible < 2000) {
        graphBtnEl.style.opacity = '1';
        graphBtnEl.style.cursor = 'pointer';
        graphBtnEl.title = 'Switch to graph view';
      } else {
        graphBtnEl.style.opacity = '0.4';
        graphBtnEl.style.cursor = 'not-allowed';
        graphBtnEl.title = 'Filter below 2,000 nodes to enable graph view';
      }
    }
  }
}
// =================================

// Separate node and edge elements for tiered rendering
var nodeElements = elements.filter(function(e) { return !e.data.source; });
var edgeElements = elements.filter(function(e) { return !!e.data.source; });

// Tier 2/3: init Cytoscape EMPTY, add elements in batches to avoid blocking
// Tier 1: init with everything (< 2000 nodes, fast enough)
var initElements = renderTier === 1 ? elements : [];

// Init Cytoscape
const cy = cytoscape({
  container: document.getElementById('cy'),
  elements: initElements,
  style: [
    {
      selector: 'node',
      style: {
        'background-color': 'data(nodeColor)',
        'label': isLarge ? 'data(shortLabel)' : 'data(label)',
        'color': '#c9d1d9',
        'font-size': isLarge ? '9px' : '11px',
        'font-family': "'SF Mono', 'Fira Code', monospace",
        'text-valign': 'bottom',
        'text-margin-y': 6,
        'width': isLarge ? 18 : 24,
        'height': isLarge ? 18 : 24,
        'border-width': 2,
        'border-color': 'data(nodeColor)',
        'background-opacity': 0.2,
        'text-outline-color': '#0d1117',
        'text-outline-width': 2,
        'text-max-width': isLarge ? '100px' : '160px',
        'text-wrap': 'ellipsis',
        'transition-property': 'opacity, background-color, border-color',
        'transition-duration': '0.15s',
      }
    },
    {
      selector: 'node.faded',
      style: { 'opacity': 0.20 }
    },
    {
      selector: 'node.highlighted',
      style: {
        'border-width': 3,
        'background-opacity': 0.6,
        'width': 32,
        'height': 32,
        'font-size': '13px',
        'font-weight': 'bold',
      }
    },
    {
      selector: 'node.selected-node',
      style: {
        'border-width': 3,
        'border-color': '#f0f6fc',
        'background-opacity': 0.8,
        'width': 36,
        'height': 36,
      }
    },
    {
      selector: 'edge',
      style: {
        'width': 1.5,
        'line-color': 'data(edgeColor)',
        'target-arrow-color': 'data(edgeColor)',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'arrow-scale': 0.8,
        'opacity': 0.6,
        'transition-property': 'opacity, line-color',
        'transition-duration': '0.15s',
      }
    },
    {
      selector: 'edge.faded',
      style: { 'opacity': 0.08 }
    },
    {
      selector: 'edge.highlighted',
      style: { 'opacity': 1, 'width': 2.5 }
    },
    {
      selector: ':parent',
      style: {
        'background-color': '#161b22',
        'background-opacity': 0.6,
        'border-width': 1,
        'border-color': '#30363d',
        'border-opacity': 0.5,
        'label': 'data(label)',
        'color': '#8b949e',
        'font-size': '10px',
        'text-valign': 'top',
        'text-halign': 'center',
        'text-margin-y': -8,
        'padding': '20px',
        'shape': 'roundrectangle',
        'corner-radius': 8,
      }
    },
    {
      selector: 'node.collapsed-cluster',
      style: {
        'background-color': '#21262d',
        'background-opacity': 0.8,
        'border-width': 2,
        'border-color': '#58a6ff',
        'shape': 'roundrectangle',
        'width': 80,
        'height': 40,
        'label': 'data(clusterLabel)',
        'color': '#58a6ff',
        'font-size': '11px',
        'text-valign': 'center',
        'text-halign': 'center',
      }
    },
    {
      selector: 'node.expandable',
      style: {
        'border-style': 'double',
      }
    },
    {
      selector: 'node.expanded',
      style: {
        'border-color': '#58a6ff',
        'border-width': 3,
      }
    },
    {
      selector: 'node.hidden-callee',
      style: { 'display': 'none' }
    },
    {
      selector: 'edge.hidden-callee-edge',
      style: { 'display': 'none' }
    },
    {
      selector: 'node.traced',
      style: {
        'opacity': 1,
        'border-width': 3,
        'border-color': '#FFD700',
        'background-opacity': 0.7,
        'z-index': 999,
        'label': function(ele) {
          var d = ele.data('traceDepth');
          var name = ele.data('label') || ele.data('shortLabel') || '';
          return d != null && d > 0 ? name + ' [' + d + ']' : name;
        },
        'font-size': '12px',
      }
    },
    {
      selector: 'node.trace-origin',
      style: {
        'opacity': 1,
        'border-width': 4,
        'border-color': '#FFD700',
        'background-opacity': 0.9,
        'background-color': '#FFD700',
        'width': 36,
        'height': 36,
        'z-index': 1000,
        'label': function(ele) { return (ele.data('label') || '') + ' [0]'; },
        'font-size': '12px',
      }
    },
    {
      selector: 'node.trace-dimmed',
      style: { 'opacity': 0.1 }
    },
    {
      selector: 'edge.traced',
      style: { 'opacity': 1, 'width': 3, 'line-color': '#FFD700', 'target-arrow-color': '#FFD700', 'z-index': 998 }
    },
    {
      selector: 'edge.trace-dimmed',
      style: { 'opacity': 0.1 }
    },
    {
      selector: 'node.cycle-node',
      style: { 'border-style': 'dashed' }
    },
    {
      selector: 'node.leaf-node',
      style: { 'shape': 'diamond', 'border-style': 'dotted', 'border-width': 2, 'border-color': '#FFD700' }
    },
    {
      selector: 'edge.aggregated-edge',
      style: {
        'width': 4,
        'line-style': 'dashed',
        'line-color': '#58a6ff',
        'target-arrow-color': '#58a6ff',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'label': 'data(label)',
        'text-background-color': '#0d1117',
        'text-background-opacity': 0.9,
        'text-background-padding': '3px',
        'font-size': '10px',
        'color': '#58a6ff',
        'text-margin-y': -10,
        'z-index': 900,
      }
    },
    {
      selector: 'edge.hover-highlight',
      style: { 'opacity': 1, 'width': 3, 'line-color': '#58a6ff', 'target-arrow-color': '#58a6ff', 'z-index': 999 }
    },
  ],
  layout: renderTier === 1 ? {
    name: 'cose',
    animate: false,
    nodeDimensionsIncludeLabels: true,
    nodeRepulsion: function() { return isLarge ? 80000 : 8000; },
    idealEdgeLength: function() { return isLarge ? 250 : 120; },
    nodeOverlap: 30,
    gravity: isLarge ? 0.15 : 0.4,
    numIter: isLarge ? 1000 : 500,
    padding: isLarge ? 60 : 40,
  } : {
    name: 'preset', // Tier 2/3: no layout at init (elements empty), layout runs after batch add
    animate: false,
  },
  minZoom: 0.1,
  maxZoom: 5,
});

// Overlay removal is handled by onEdgesReady() (Tier 2) and batch completion (Tier 3)
// For Tier 1 inline mode, remove overlay on layoutstop
if (renderTier === 1) {
  cy.one('layoutstop', function() {
    var overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.classList.add('fade-out');
      setTimeout(function() { overlay.remove(); }, 300);
    }
  });
}

// ---- PROGRESSIVE ELEMENT LOADING (Tier 2/3) ----
var edgesReady = (renderTier === 1); // Tier 1: all elements already loaded

function addElementsInBatches(elems, batchSize, onComplete) {
  var idx = 0;
  function nextBatch() {
    var end = Math.min(idx + batchSize, elems.length);
    if (idx >= elems.length) {
      if (onComplete) onComplete();
      return;
    }
    cy.add(elems.slice(idx, end));
    idx = end;
    if (idx < elems.length) {
      setTimeout(nextBatch, 0);
    } else {
      if (onComplete) onComplete();
    }
  }
  setTimeout(nextBatch, 0);
}

function onEdgesReady() {
  edgesReady = true;
  markExpandableNodes();
  recomputeConnectionCounts();
  updateVisibilityStates();
  // Remove loading overlay after everything is done
  var overlay = document.getElementById('loading-overlay');
  if (overlay) {
    overlay.classList.add('fade-out');
    setTimeout(function() { overlay.remove(); }, 300);
  }
}

// Flag: layout needs to run when graph tab is shown (cy container must be visible for correct dimensions)
var needsGraphLayout = false;

if (renderTier === 2) {
  // Step 1: Add nodes in batches of 500
  addElementsInBatches(nodeElements, 500, function() {
    // Step 2: Mark layout as pending — will run when user switches to Graph tab
    needsGraphLayout = true;
    // Step 3: Progressively add edges
    addElementsInBatches(edgeElements, 500, onEdgesReady);
  });
} else if (renderTier === 3) {
  // Add nodes only (no edges, no layout) — list-only mode
  addElementsInBatches(nodeElements, 500, function() {
    // Nodes loaded, list view is ready
    var overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.classList.add('fade-out');
      setTimeout(function() { overlay.remove(); }, 300);
    }
  });
}

// Tier 3: lazy edge loading when user unlocks graph
var tier3EdgesLoaded = false;
function loadTier3EdgesIfNeeded() {
  if (renderTier !== 3 || tier3EdgesLoaded) return;
  var visibleCount = cy.nodes().filter(function(n) { return n.style('display') !== 'none' && !n.isParent(); }).length;
  if (visibleCount < 2000) {
    tier3EdgesLoaded = true;
    addElementsInBatches(edgeElements, 500, function() {
      var visibleEles = cy.elements().filter(function(ele) { return ele.style('display') !== 'none'; });
      visibleEles.layout({ name: 'grid', animate: false, padding: 40, avoidOverlap: true, condense: true }).run();
      onEdgesReady();
    });
  }
}

// ---- SEARCH ----
const searchInput = document.getElementById('searchInput');
const searchCount = document.getElementById('searchCount');

searchInput.addEventListener('input', (e) => {
  const query = e.target.value.trim().toLowerCase();

  // List view: just re-render table
  if (currentView === 'list') {
    renderListView();
    // Update search count from list
    if (!query) { searchCount.textContent = ''; }
    return;
  }

  // Graph view: highlight/fade nodes
  if (!query) {
    cy.elements().removeClass('faded highlighted');
    searchCount.textContent = '';
    // Restore trace if it was active
    if (traceMode !== 'off' && traceOriginId) {
      tracePaths(traceOriginId, traceMode);
    }
    if (minimapVisible) requestAnimationFrame(renderMinimap);
    return;
  }
  // Pause trace during search
  if (traceMode !== 'off') {
    cy.elements().removeClass('traced trace-origin trace-dimmed cycle-node leaf-node'); cy.nodes().removeData('traceDepth');
  }

  const matched = cy.nodes().filter(n => {
    const name = (n.data('label') || '').toLowerCase();
    const file = (n.data('file') || '').toLowerCase();
    const type = (n.data('type') || '').toLowerCase();
    return name.includes(query) || file.includes(query) || type.includes(query);
  });

  cy.elements().addClass('faded').removeClass('highlighted');
  matched.removeClass('faded').addClass('highlighted');
  matched.connectedEdges().removeClass('faded').addClass('highlighted');

  searchCount.textContent = matched.length + ' match' + (matched.length !== 1 ? 'es' : '');

  if (matched.length > 0) {
    cy.animate({ fit: { eles: matched, padding: 60 }, duration: 300 });
  }
  if (minimapVisible) requestAnimationFrame(renderMinimap);
});

// ---- HOVER: show full label on large graphs ----
if (isLarge) {
  cy.on('mouseover', 'node', (evt) => {
    evt.target.style('label', evt.target.data('label'));
    evt.target.style('font-size', '12px');
    evt.target.style('z-index', 999);
  });
  cy.on('mouseout', 'node', (evt) => {
    if (!evt.target.hasClass('highlighted') && !evt.target.hasClass('selected-node')) {
      evt.target.style('label', evt.target.data('shortLabel'));
      evt.target.style('font-size', '9px');
      evt.target.style('z-index', 0);
    }
  });
}

// ---- EDGE INTERACTION (Epic 8) ----
const edgeTooltip = document.getElementById('edgeTooltip');
let edgeTooltipTimer = null;

cy.on('mouseover', 'edge', (evt) => {
  const edge = evt.target;
  edge.addClass('hover-highlight');
  const eType = edge.data('edgeType') || 'calls';
  const protocol = edge.data('protocol') || 'internal';
  const meta = edge.data('metadata') || {};
  let html = '<span class="tt-type">' + esc(eType) + '</span> <span class="tt-protocol">| ' + esc(protocol) + '</span>';
  if (meta.method && meta.path) {
    html += '<div class="tt-meta">' + esc(meta.method) + ' ' + esc(meta.path) + '</div>';
  }
  edgeTooltip.innerHTML = html;
  edgeTooltipTimer = setTimeout(() => edgeTooltip.classList.add('visible'), 50);
  // Position near cursor
  const pos = evt.renderedPosition || edge.midpoint();
  const rect = document.getElementById('cy').getBoundingClientRect();
  edgeTooltip.style.left = (rect.left + pos.x + 12) + 'px';
  edgeTooltip.style.top = (rect.top + pos.y - 10) + 'px';
});

cy.on('mouseout', 'edge', (evt) => {
  evt.target.removeClass('hover-highlight');
  if (edgeTooltipTimer) { clearTimeout(edgeTooltipTimer); edgeTooltipTimer = null; }
  edgeTooltip.classList.remove('visible');
});

cy.on('tap', 'edge', (evt) => {
  const edge = evt.target;
  openEdgePanel(edge.data());
});

function openEdgePanel(edgeData) {
  const nodeMap = {};
  GRAPH_DATA.nodes.forEach(function(nd) { nodeMap[nd.id] = nd; });
  routeNodes.forEach(function(rn, id) { nodeMap[id] = { name: rn.label, file: null, type: 'route' }; });

  const srcNode = nodeMap[edgeData.source] || { name: edgeData.source };
  const tgtNode = nodeMap[edgeData.target] || { name: edgeData.target };
  const meta = edgeData.metadata || {};

  // Build VS Code link for the call site (actual call expression line, not function declaration)
  // For split route edges where srcNode is virtual (file=null), use callFile from edge data
  let vscodeHtml = '';
  const callSiteLine = edgeData.callLine || null;
  const callSiteFile = srcNode.file || edgeData.callFile || null;
  if (callSiteFile && callSiteLine) {
    const absPath = ROOT_PATH + '/' + callSiteFile;
    const vscodeLink = 'vscode://file/' + encodeURI(absPath) + ':' + callSiteLine;
    vscodeHtml = '<div class="panel-row"><span class="label">Call site</span><span class="value"><a class="file-link" href="' + vscodeLink + '" title="Open in VS Code">' + esc(callSiteFile) + ':' + callSiteLine + '</a></span></div>';
  } else if (callSiteFile) {
    // Fallback: link to source function declaration when callLine not available
    const absPath = ROOT_PATH + '/' + callSiteFile;
    const vscodeLink = 'vscode://file/' + encodeURI(absPath) + ':' + (srcNode.line || 1);
    vscodeHtml = '<div class="panel-row"><span class="label">Source</span><span class="value"><a class="file-link" href="' + vscodeLink + '" title="Open in VS Code">' + esc(callSiteFile) + ':' + (srcNode.line || '') + '</a></span></div>';
  }

  // Additional metadata rows
  let metaHtml = '';
  if (meta.method) metaHtml += '<div class="panel-row"><span class="label">Method</span><span class="value">' + esc(meta.method) + '</span></div>';
  if (meta.path) metaHtml += '<div class="panel-row"><span class="label">Path</span><span class="value">' + esc(meta.path) + '</span></div>';

  var edgeTypeStr = esc(edgeData.edgeType) || 'calls';
  var protocolStr = esc(edgeData.protocol) || 'internal';
  var srcName = esc(srcNode.name);
  var tgtName = esc(tgtNode.name);
  var srcId = esc(edgeData.source);
  var tgtId = esc(edgeData.target);
  var html = '<div class="panel-header">';
  html += '<h2>Edge: ' + edgeTypeStr + '</h2>';
  html += '<button class="panel-close" onclick="closePanel()">x</button>';
  html += '</div>';
  html += '<div class="panel-section">';
  html += '<h3>Connection</h3>';
  html += '<div class="panel-row"><span class="label">Source</span><span class="value"><span class="conn-name" data-focus="' + srcId + '">' + srcName + '</span></span></div>';
  html += '<div class="panel-row"><span class="label">Target</span><span class="value"><span class="conn-name" data-focus="' + tgtId + '">' + tgtName + '</span></span></div>';
  html += '<div class="panel-row"><span class="label">Type</span><span class="value"><span class="type-badge type-route">' + edgeTypeStr + '</span></span></div>';
  html += '<div class="panel-row"><span class="label">Protocol</span><span class="value">' + protocolStr + '</span></div>';
  html += metaHtml;
  html += vscodeHtml;
  html += '</div>';
  detailPanel.innerHTML = html;
  detailPanel.classList.remove('hidden');
  cy.nodes().removeClass('selected-node');
  detailPanel.querySelectorAll('.conn-name[data-focus]').forEach(function(el) {
    el.addEventListener('click', function() { focusNode(el.dataset.focus); });
  });
  updateMinimapPosition();
}




// ---- EXPAND/COLLAPSE NODES (Epic 10) ----
// (expandedNodes, persistKey, saveExpandedState declared in GLOBAL VISIBILITY STATE above)

var badgesContainer = document.createElement('div');
badgesContainer.style.position = 'absolute';
badgesContainer.style.top = '0';
badgesContainer.style.left = '0';
badgesContainer.style.pointerEvents = 'none';
badgesContainer.style.width = '100%';
badgesContainer.style.height = '100%';
badgesContainer.style.overflow = 'hidden';
// Badges container added to the wrapper, because #cy handles raw rendering
document.getElementById('cy').appendChild(badgesContainer);

var popups = {};

function updateBadges() {
  cy.nodes('.expandable').forEach(function(n) {
    if (n.style('display') === 'none' || n.hasClass('hidden-callee') || n.isParent()) {
      if (popups[n.id()]) popups[n.id()].style.display = 'none';
      return;
    }
    
    // Also hide if its compound cluster is hidden/collapsed
    var parent = n.parent();
    if (parent.length > 0 && parent.hasClass('collapsed-cluster')) {
      if (popups[n.id()]) popups[n.id()].style.display = 'none';
      return;
    }

    var bb = n.renderedBoundingBox({ includeLabels: false, includeOverlays: false });
    if (bb.w === 0 || bb.h === 0) {
      if (popups[n.id()]) popups[n.id()].style.display = 'none';
      return;
    }
    
    var badge = popups[n.id()];
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'expand-badge';
      badge.style.pointerEvents = 'auto'; // allow clicking the badge
      badge.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleNodeExpand(n.id());
      });
      // Double click prevention to avoid zooming graph when clicking badge quickly
      badge.addEventListener('dblclick', function(e) {
        e.stopPropagation();
      });
      badgesContainer.appendChild(badge);
      popups[n.id()] = badge;
    }
    
    badge.style.display = 'flex';
    badge.textContent = expandedNodes.has(n.id()) ? '-' : '+';
    badge.title = expandedNodes.has(n.id()) ? 'Collapse' : ('Expand ' + n.data('calleeCount') + ' dependencies');
    
    // Position at bottom-right of the node itself
    badge.style.left = (bb.x2 - 10) + 'px';
    badge.style.top = (bb.y2 - 10) + 'px';
  });
}

// Update badges on interactions
cy.on('render pan zoom resize', updateBadges);

// Expand/collapse disabled — all nodes always visible
function markExpandableNodes() {}
function toggleNodeExpand() {}
function expandNodeCallees() {}
function collapseNodeCallees() {}

// Initialize (no-op)
if (edgesReady) markExpandableNodes();

// ---- AUTO-CLUSTERING (Epic 9) ----
// (clusteringEnabled, collapsedClusters, clusterMap, clusterNodes declared in GLOBAL VISIBILITY STATE above)
var clusterControls = document.getElementById('clusterControls');

function getClusterKey(filePath) {
  if (!filePath) return null;
  var parts = filePath.split('/');
  // Use first 2 path segments as cluster key (e.g., "service/domain")
  if (parts.length >= 2) return parts.slice(0, 2).join('/');
  return parts[0] || null;
}

function buildClusters() {
  // Group nodes by directory
  var groups = {};
  cy.nodes().forEach(function(n) {
    if (n.isParent()) return; // skip compound parents
    var file = n.data('file');
    var key = getClusterKey(file);
    if (!key) key = '_root';
    if (!groups[key]) groups[key] = [];
    groups[key].push(n.id());
  });

  // Create compound parent nodes for each group
  var toAdd = [];
  Object.keys(groups).forEach(function(key) {
    if (groups[key].length < 1) return;
    var clusterId = 'cluster-' + key.replace(/[^a-zA-Z0-9]/g, '-');
    clusterNodes.set(clusterId, { label: key, children: groups[key] });

    // Add compound parent
    toAdd.push({
      group: 'nodes',
      data: {
        id: clusterId,
        label: key + ' (' + groups[key].length + ')',
        nodeColor: '#30363d',
      }
    });

    // Set parent for child nodes
    groups[key].forEach(function(childId) {
      var child = cy.getElementById(childId);
      if (child.length > 0) {
        child.move({ parent: clusterId });
        clusterMap[childId] = clusterId;
      }
    });
  });

  cy.add(toAdd);
}

function removeClusters() {
  // Remove aggregated edges first
  cy.edges('.aggregated-edge').remove();
  // Remove all compound parents, move children back to root
  clusterNodes.forEach(function(info, clusterId) {
    info.children.forEach(function(childId) {
      var child = cy.getElementById(childId);
      if (child.length > 0) {
        child.move({ parent: null });
      }
    });
    cy.remove(cy.getElementById(clusterId));
  });
  clusterNodes.clear();
  clusterMap = {};
  collapsedClusters.clear();
  updateVisibilityStates();
}

function collapseCluster(clusterId) {
  var cluster = clusterNodes.get(clusterId);
  if (!cluster) return;
  collapsedClusters.add(clusterId);

  var parent = cy.getElementById(clusterId);
  if (parent.length > 0) {
    parent.data('clusterLabel', cluster.label + ' (' + cluster.children.length + ')');
    parent.addClass('collapsed-cluster');
  }

  // Update central states
  updateVisibilityStates();
}

function expandCluster(clusterId) {
  var cluster = clusterNodes.get(clusterId);
  if (!cluster) return;
  collapsedClusters.delete(clusterId);

  var parent = cy.getElementById(clusterId);
  if (parent.length > 0) {
    parent.removeClass('collapsed-cluster');
  }

  // Update central states
  updateVisibilityStates();
}

// FR51: Create aggregated edges between collapsed clusters
function updateAggregatedEdges() {
  cy.edges('.aggregated-edge').remove();
  if (collapsedClusters.size === 0) return;

  var crossCluster = {}; 
  var toAdd = [];
  
  cy.edges().forEach(function(e) {
    if (e.hasClass('aggregated-edge') || e.hasClass('hidden-callee-edge')) return;
    
    var srcNode = e.source();
    var tgtNode = e.target();
    var srcId = srcNode.id();
    var tgtId = tgtNode.id();
    
    if (!activeTypes.has(srcNode.data('type')) || !activeTypes.has(tgtNode.data('type'))) return;
    
    var srcCluster = clusterMap[srcId];
    var tgtCluster = clusterMap[tgtId];
    
    var srcCollapsed = srcCluster && collapsedClusters.has(srcCluster);
    var tgtCollapsed = tgtCluster && collapsedClusters.has(tgtCluster);
    
    if (!srcCollapsed && !tgtCollapsed) return;
    if (srcCluster === tgtCluster) return; 
    
    var visualSrc = srcCollapsed ? srcCluster : srcId;
    var visualTgt = tgtCollapsed ? tgtCluster : tgtId;
    
    var a = visualSrc < visualTgt ? visualSrc : visualTgt;
    var b = visualSrc < visualTgt ? visualTgt : visualSrc;
    var key = a + '<->' + b;
    
    if (!crossCluster[key]) crossCluster[key] = { count: 0, a: a, b: b };
    crossCluster[key].count++;
  });

  Object.keys(crossCluster).forEach(function(key) {
    var info = crossCluster[key];
    toAdd.push({
      group: 'edges',
      data: {
        id: 'agg-' + info.a + '-' + info.b,
        source: info.a,
        target: info.b,
        edgeType: 'aggregated',
        label: info.count > 1 ? info.count + '' : '',
      },
      classes: 'aggregated-edge',
    });
  });

  if (toAdd.length > 0) cy.add(toAdd);
}

function collapseAll() {
  clusterNodes.forEach(function(info, clusterId) {
    var cluster = clusterNodes.get(clusterId);
    if (!cluster) return;
    collapsedClusters.add(clusterId);
    var parent = cy.getElementById(clusterId);
    if (parent.length > 0) {
      parent.data('clusterLabel', cluster.label + ' (' + cluster.children.length + ')');
      parent.addClass('collapsed-cluster');
    }
  });
  updateVisibilityStates();
}

function expandAll() {
  clusterNodes.forEach(function(info, clusterId) {
    collapsedClusters.delete(clusterId);
    var parent = cy.getElementById(clusterId);
    if (parent.length > 0) parent.removeClass('collapsed-cluster');
  });
  updateVisibilityStates();
}

// Double-click on cluster parent to toggle collapse/expand
cy.on('dblclick', 'node:parent', function(evt) {
  var clusterId = evt.target.id();
  if (collapsedClusters.has(clusterId)) {
    collapsedClusters.delete(clusterId);
    evt.target.removeClass('collapsed-cluster');
  } else {
    var cluster = clusterNodes.get(clusterId);
    if (cluster) {
      collapsedClusters.add(clusterId);
      evt.target.data('clusterLabel', cluster.label + ' (' + cluster.children.length + ')');
      evt.target.addClass('collapsed-cluster');
    }
  }
  updateVisibilityStates();
});

// Initialize clustering
if (clusteringEnabled) {
  clusterControls.style.display = 'flex';
  buildClusters();

  // Re-run layout after adding compound nodes
  cy.layout({
    name: 'cose',
    animate: false,
    nodeDimensionsIncludeLabels: true,
    nodeRepulsion: function() { return 80000; },
    idealEdgeLength: function() { return 250; },
    nodeOverlap: 30,
    gravity: 0.15,
    numIter: 1000,
    padding: 60,
  }).run();
}

// Toggle flat/clustered view
document.getElementById('toggleClusterBtn').addEventListener('click', function() {
  if (clusterNodes.size > 0) {
    removeClusters();
    this.textContent = '⬡ Flat';
    this.classList.remove('active');
    document.getElementById('collapseAllBtn').style.display = 'none';
    document.getElementById('expandAllBtn').style.display = 'none';
    cy.layout({
      name: 'cose',
      animate: false,
      nodeDimensionsIncludeLabels: true,
      nodeRepulsion: function() { return isLarge ? 80000 : 8000; },
      idealEdgeLength: function() { return isLarge ? 250 : 120; },
      nodeOverlap: 30,
      gravity: isLarge ? 0.15 : 0.4,
      numIter: isLarge ? 1000 : 500,
      padding: isLarge ? 60 : 40,
    }).run();
  } else {
    buildClusters();
    this.textContent = '⬡ Clustered';
    this.classList.add('active');
    document.getElementById('collapseAllBtn').style.display = '';
    document.getElementById('expandAllBtn').style.display = '';
    cy.layout({
      name: 'cose',
      animate: false,
      nodeDimensionsIncludeLabels: true,
      nodeRepulsion: function() { return 80000; },
      idealEdgeLength: function() { return 250; },
      nodeOverlap: 30,
      gravity: 0.15,
      numIter: 1000,
      padding: 60,
    }).run();
  }
});

document.getElementById('collapseAllBtn').addEventListener('click', collapseAll);
document.getElementById('expandAllBtn').addEventListener('click', expandAll);



// ---- PATH TRACING (Epic 7) ----
var traceMode = 'off';
var traceOriginId = null;
var traceControls = document.getElementById('traceControls');

function clearTrace() {
  traceMode = 'off';
  traceOriginId = null;
  cy.elements().removeClass('traced trace-origin trace-dimmed cycle-node leaf-node'); cy.nodes().removeData('traceDepth');
  traceControls.style.display = 'none';
  traceControls.querySelectorAll('button').forEach(function(b) { b.classList.remove('active'); });
  if (minimapVisible) requestAnimationFrame(renderMinimap);
}

function showTraceControls(nodeId) {
  traceOriginId = nodeId;
  traceControls.style.display = 'flex';
}

function tracePaths(nodeId, direction) {
  cy.batch(function() {
    cy.elements().removeClass('traced trace-origin trace-dimmed cycle-node leaf-node'); cy.nodes().removeData('traceDepth');
    var visited = new Set();
    var traced = cy.collection();
    var originNode = cy.getElementById(nodeId);
    if (originNode.length === 0) return;

    // BFS traversal
    function bfs(startNode, dir) {
      var queue = [{ node: startNode, depth: 0 }];
      visited.add(startNode.id());
      startNode.data('traceDepth', 0);
      traced = traced.union(startNode);

      while (queue.length > 0) {
        var current = queue.shift();
        var edges, neighbors;
        if (dir === 'downstream') {
          edges = current.node.outgoers('edge');
        } else {
          edges = current.node.incomers('edge');
        }

        edges.forEach(function(edge) {
          traced = traced.union(edge);
          var neighbor = dir === 'downstream' ? edge.target() : edge.source();
          if (visited.has(neighbor.id())) {
            // Cycle detected
            neighbor.addClass('cycle-node');
            return;
          }
          visited.add(neighbor.id());
          neighbor.data('traceDepth', current.depth + 1);
          traced = traced.union(neighbor);
          queue.push({ node: neighbor, depth: current.depth + 1 });
        });
      }
    }

    if (direction === 'downstream' || direction === 'both') {
      bfs(originNode, 'downstream');
    }
    if (direction === 'upstream' || direction === 'both') {
      // Reset visited for upstream if doing both (keep origin)
      if (direction === 'both') {
        // Keep existing traced nodes, just add upstream
        var upVisited = new Set();
        upVisited.add(originNode.id());
        var upQueue = [{ node: originNode, depth: 0 }];
        while (upQueue.length > 0) {
          var current = upQueue.shift();
          var edges = current.node.incomers('edge');
          edges.forEach(function(edge) {
            traced = traced.union(edge);
            var neighbor = edge.source();
            if (upVisited.has(neighbor.id()) || visited.has(neighbor.id())) {
              if (!visited.has(neighbor.id())) neighbor.addClass('cycle-node');
              return;
            }
            upVisited.add(neighbor.id());
            visited.add(neighbor.id());
            neighbor.data('traceDepth', current.depth + 1);
            traced = traced.union(neighbor);
            upQueue.push({ node: neighbor, depth: current.depth + 1 });
          });
        }
      } else {
        bfs(originNode, 'upstream');
      }
    }

    // Apply styles
    cy.elements().addClass('trace-dimmed');
    traced.removeClass('trace-dimmed').addClass('traced');
    originNode.removeClass('traced').addClass('trace-origin');

    // Mark leaf nodes — traced nodes with no further traced edges in trace direction
    traced.nodes().forEach(function(n) {
      if (n.id() === originNode.id()) return;
      var hasTracedContinuation = false;
      if (direction === 'downstream' || direction === 'both') {
        hasTracedContinuation = hasTracedContinuation || n.outgoers('edge').some(function(e) { return e.hasClass('traced'); });
      }
      if (direction === 'upstream' || direction === 'both') {
        hasTracedContinuation = hasTracedContinuation || n.incomers('edge').some(function(e) { return e.hasClass('traced') && e.source().id() !== n.id(); });
      }
      if (!hasTracedContinuation) {
        n.addClass('leaf-node');
      }
    });

    // Update trace controls active state
    traceControls.querySelectorAll('button[data-trace]').forEach(function(b) {
      b.classList.toggle('active', b.dataset.trace === direction);
    });
  });
  if (minimapVisible) requestAnimationFrame(renderMinimap);
}

// Trace controls click handler
traceControls.addEventListener('click', function(e) {
  var btn = e.target.closest('button[data-trace]');
  if (!btn || !traceOriginId) return;
  var dir = btn.dataset.trace;
  if (dir === 'clear') {
    clearTrace();
    return;
  }
  traceMode = dir;
  tracePaths(traceOriginId, dir);
});

// Keyboard shortcuts for trace
document.addEventListener('keydown', function(e) {
  // Skip if user is typing in search
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;

  if (e.key === 'Escape') {
    clearTrace();
    return;
  }

  if (!traceOriginId) return;
  if (e.key === 'u' || e.key === 'U') {
    traceMode = 'upstream';
    tracePaths(traceOriginId, 'upstream');
  } else if (e.key === 'd' || e.key === 'D') {
    traceMode = 'downstream';
    tracePaths(traceOriginId, 'downstream');
  } else if (e.key === 'b' || e.key === 'B') {
    traceMode = 'both';
    tracePaths(traceOriginId, 'both');
  }
});

// ---- TYPE FILTERS ----
document.getElementById('filters').addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;

  const type = btn.dataset.type;
  btn.classList.toggle('active');

  if (btn.classList.contains('active')) {
    activeTypes.add(type);
  } else {
    activeTypes.delete(type);
  }

  applyFilters();
});

function applyFilters() {
  updateVisibilityStates();
}

// ---- VIEW TOGGLE (Graph / List) ----
const cyContainer = document.getElementById('cy');
const listView = document.getElementById('listView');
const viewToggle = document.getElementById('viewToggle');
let currentView = 'graph';
let listSortCol = 'name';
let listSortAsc = true;

viewToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || btn.dataset.view === currentView) return;
  // Block graph view for Tier 3 if too many visible nodes
  if (btn.dataset.view === 'graph' && renderTier === 3) {
    var visibleCount = cy.nodes().filter(function(n) { return n.style('display') !== 'none' && !n.isParent(); }).length;
    if (visibleCount >= 2000) return;
  }

  currentView = btn.dataset.view;
  viewToggle.querySelectorAll('button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  if (currentView === 'list') {
    cyContainer.classList.add('hidden');
    listView.classList.add('active');
    renderListView();
  } else {
    // Tier 3: lazily load edges when switching to graph
    if (typeof loadTier3EdgesIfNeeded === 'function') loadTier3EdgesIfNeeded();
    cyContainer.classList.remove('hidden');
    listView.classList.remove('active');
    cy.resize();
    // Run deferred layout if needed (Tier 2: container was hidden during batch loading)
    if (needsGraphLayout) {
      needsGraphLayout = false;
      cy.layout({ name: 'grid', animate: false, nodeDimensionsIncludeLabels: true, padding: 40, avoidOverlap: true, condense: true }).run();
    }
  }
});

// Default to list view for Tier 2/3
if (renderTier >= 2) {
  currentView = 'list';
  viewToggle.querySelectorAll('button').forEach(function(b) { b.classList.remove('active'); });
  var listBtn = viewToggle.querySelector('button[data-view="list"]');
  if (listBtn) listBtn.classList.add('active');
  cyContainer.classList.add('hidden');
  listView.classList.add('active');
}

// Disable graph button for Tier 3
var graphBtn = viewToggle.querySelector('button[data-view="graph"]');
if (renderTier === 3 && graphBtn) {
  graphBtn.style.opacity = '0.4';
  graphBtn.style.cursor = 'not-allowed';
  graphBtn.title = 'Filter below 2,000 nodes to enable graph view';
}

// Pre-compute connection counts from edgeElements (always available, independent of Cytoscape state)
var inCount = {};
var outCount = {};
function recomputeConnectionCounts() {
  // Reset
  for (var k in inCount) delete inCount[k];
  for (var k in outCount) delete outCount[k];
  edgeElements.forEach(function(e) {
    var src = e.data.source;
    var tgt = e.data.target;
    outCount[src] = (outCount[src] || 0) + 1;
    inCount[tgt] = (inCount[tgt] || 0) + 1;
  });
}
// Compute immediately for all tiers (edgeElements is always available)
recomputeConnectionCounts();

function renderListView() {
  const query = searchInput.value.trim().toLowerCase();

  // Filter by active types + search
  // Combine real nodes + virtual route nodes
  const virtualRoutes = [];
  routeNodes.forEach((rn, id) => {
    virtualRoutes.push({ id: id, name: rn.label, type: 'route', file: '—', line: '', language: 'REST' });
  });
  const allListNodes = GRAPH_DATA.nodes.concat(virtualRoutes);

  const rows = allListNodes.filter(n => {
    if (!activeTypes.has(n.type)) return false;
    if (query) {
      const haystack = (n.name + ' ' + (n.file || '') + ' ' + n.type).toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  // Sort
  rows.sort((a, b) => {
    let va, vb;
    if (listSortCol === 'in') { va = inCount[a.id] || 0; vb = inCount[b.id] || 0; }
    else if (listSortCol === 'out') { va = outCount[a.id] || 0; vb = outCount[b.id] || 0; }
    else { va = a[listSortCol] || ''; vb = b[listSortCol] || ''; }
    if (typeof va === 'string') { va = va.toLowerCase(); vb = vb.toLowerCase(); }
    if (va < vb) return listSortAsc ? -1 : 1;
    if (va > vb) return listSortAsc ? 1 : -1;
    return 0;
  });

  const arrow = (col) => col === listSortCol ? (listSortAsc ? ' ↑' : ' ↓') : '';

  listView.innerHTML = \`
    <table class="list-table">
      <thead><tr>
        <th data-col="name">Name<span class="sort-arrow">\${arrow('name')}</span></th>
        <th data-col="type">Type<span class="sort-arrow">\${arrow('type')}</span></th>
        <th data-col="file">File<span class="sort-arrow">\${arrow('file')}</span></th>
        <th data-col="line">Line<span class="sort-arrow">\${arrow('line')}</span></th>
        <th data-col="in">In<span class="sort-arrow">\${arrow('in')}</span></th>
        <th data-col="out">Out<span class="sort-arrow">\${arrow('out')}</span></th>
      </tr></thead>
      <tbody>
        \${rows.map(n => \`
          <tr data-id="\${esc(n.id)}">
            <td style="color:\${NODE_COLORS[n.type] || '#c9d1d9'}">\${esc(n.name)}</td>
            <td><span class="type-badge type-\${esc(n.type)}">\${esc(n.type)}</span></td>
            <td style="color:#8b949e">\${esc(n.file)}</td>
            <td style="color:#8b949e">\${n.line}</td>
            <td class="list-conn-count">\${inCount[n.id] || 0}</td>
            <td class="list-conn-count">\${outCount[n.id] || 0}</td>
          </tr>
        \`).join('')}
      </tbody>
    </table>
  \`;

  // Sort on header click
  listView.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (listSortCol === col) { listSortAsc = !listSortAsc; }
      else { listSortCol = col; listSortAsc = true; }
      renderListView();
    });
  });

  // Row click opens detail panel
  listView.querySelectorAll('tr[data-id]').forEach(tr => {
    tr.addEventListener('click', () => {
      const nodeId = tr.dataset.id;
      const cyNode = cy.getElementById(nodeId);
      if (cyNode.length > 0) {
        listView.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
        tr.classList.add('selected');
        openPanel(cyNode.data());
      }
    });
  });
}

// ---- DETAIL PANEL ----
const detailPanel = document.getElementById('detailPanel');

function openPanel(nodeData) {
  const n = nodeData;
  const isVirtualRoute = n.type === 'route' && !n.file;

  // Build node name lookup (real nodes + virtual route nodes)
  const nodeMap = {};
  GRAPH_DATA.nodes.forEach(nd => nodeMap[nd.id] = nd.name);
  routeNodes.forEach((rn, id) => nodeMap[id] = rn.label);

  // Find connections from edgeElements (always available, even before edges loaded into Cytoscape)
  const incoming = edgeElements
    .filter(function(e) { return e.data.target === n.id; })
    .map(function(e) { return { source: e.data.source, type: e.data.edgeType, protocol: e.data.protocol }; });
  const outgoing = edgeElements
    .filter(function(e) { return e.data.source === n.id; })
    .map(function(e) { return { target: e.data.target, type: e.data.edgeType, protocol: e.data.protocol }; });

  const typeClass = 'type-' + n.type;

  // Info section differs for virtual route nodes vs real nodes
  let infoHtml;
  if (isVirtualRoute) {
    infoHtml = \`
      <div class="panel-section">
        <h3>Info</h3>
        <div class="panel-row"><span class="label">Type</span><span class="value"><span class="type-badge \${typeClass}">\${n.type}</span></span></div>
        <div class="panel-row"><span class="label">Protocol</span><span class="value">REST</span></div>
      </div>
    \`;
  } else {
    const absPath = ROOT_PATH + '/' + n.file;
    const vscodeLink = 'vscode://file/' + encodeURI(absPath) + ':' + n.line;
    infoHtml = \`
      <div class="panel-section">
        <h3>Info</h3>
        <div class="panel-row"><span class="label">Type</span><span class="value"><span class="type-badge \${typeClass}">\${esc(n.type)}</span></span></div>
        <div class="panel-row"><span class="label">Language</span><span class="value">\${esc(n.language)}</span></div>
        <div class="panel-row"><span class="label">File</span><span class="value"><a class="file-link" href="\${vscodeLink}" title="Open in VS Code">\${esc(n.file)}:\${n.line}</a></span></div>
      </div>
      <div class="panel-section">
        <h3>Signature</h3>
        <div class="panel-signature">\${esc(n.signature) || '—'}</div>
      </div>
    \`;
  }

  detailPanel.innerHTML = \`
    <div class="panel-header">
      <h2>\${esc(n.label)}</h2>
      <button class="panel-close" onclick="closePanel()">✕</button>
    </div>
    \${infoHtml}
    \${incoming.length > 0 ? \`
    <div class="panel-section">
      <h3>Incoming (\${incoming.length})</h3>
      \${incoming.map(e => \`
        <div class="connection-item">
          <span class="conn-name" data-focus-id="\${esc(e.source)}">\${esc(nodeMap[e.source] || e.source)}</span>
          <span class="arrow">→</span>
          <span class="conn-type">\${esc(e.type)}/\${esc(e.protocol)}</span>
        </div>
      \`).join('')}
    </div>
    \` : ''}
    \${outgoing.length > 0 ? \`
    <div class="panel-section">
      <h3>Outgoing (\${outgoing.length})</h3>
      \${outgoing.map(e => \`
        <div class="connection-item">
          <span class="arrow">→</span>
          <span class="conn-name" data-focus-id="\${esc(e.target)}">\${esc(nodeMap[e.target] || e.target)}</span>
          <span class="conn-type">\${esc(e.type)}/\${esc(e.protocol)}</span>
        </div>
      \`).join('')}
    </div>
    \` : ''}
  \`;

  // M-4 security fix: attach click handlers via addEventListener instead of inline onclick
  detailPanel.querySelectorAll('[data-focus-id]').forEach(function(el) {
    el.addEventListener('click', function() { focusNode(el.dataset.focusId); });
  });

  detailPanel.classList.remove('hidden');
  updateMinimapPosition();
}

function closePanel() {
  detailPanel.classList.add('hidden');
  cy.nodes().removeClass('selected-node');
  updateMinimapPosition();
}

function updateMinimapPosition() {
  if (!minimapEl) return;
  var panelOpen = !detailPanel.classList.contains('hidden');
  minimapEl.style.right = panelOpen ? '376px' : '16px'; // 360px panel + 16px gap
}

function focusNode(nodeId) {
  const node = cy.getElementById(nodeId);
  if (node.length === 0) return;

  openPanel(node.data());

  if (currentView === 'list') {
    // Highlight row in list view and scroll to it
    listView.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
    const row = listView.querySelector('tr[data-id="' + CSS.escape(nodeId) + '"]');
    if (row) {
      row.classList.add('selected');
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } else {
    cy.nodes().removeClass('selected-node');
    node.addClass('selected-node');
    cy.animate({ center: { eles: node }, zoom: 2, duration: 300 });
  }
}

cy.on('tap', 'node', (evt) => {
  cy.nodes().removeClass('selected-node');
  evt.target.addClass('selected-node');
  openPanel(evt.target.data());
  showTraceControls(evt.target.id());
  // Auto-trace downstream on node click if trace was already active
  if (traceMode !== 'off') {
    tracePaths(evt.target.id(), traceMode);
  }
});

cy.on('tap', (evt) => {
  if (evt.target === cy) {
    closePanel();
    clearTrace();
  }
});

// ---- MINIMAP (Epic 11) ----
var minimapEl = document.getElementById('minimap');
var minimapCanvas = document.getElementById('minimapCanvas');
var minimapCtx = minimapCanvas.getContext('2d');
var minimapToggle = document.getElementById('minimapToggle');
var minimapVisible = nodeCount >= 30;

// Auto-hide for small graphs
if (nodeCount < 30) {
  minimapEl.classList.add('hidden');
  minimapToggle.classList.remove('active');
}

function renderMinimap() {
  if (!minimapVisible || minimapEl.classList.contains('hidden')) return;

  var cw = minimapEl.clientWidth;
  var ch = minimapEl.clientHeight;
  minimapCanvas.width = cw * 2; // retina
  minimapCanvas.height = ch * 2;
  minimapCtx.scale(2, 2);
  minimapCtx.clearRect(0, 0, cw, ch);

  // Get graph bounding box
  var bb = cy.elements().boundingBox();
  if (bb.w === 0 || bb.h === 0) return;

  var pad = 10;
  var scaleX = (cw - pad * 2) / bb.w;
  var scaleY = (ch - pad * 2) / bb.h;
  var scale = Math.min(scaleX, scaleY);

  var offsetX = pad + (cw - pad * 2 - bb.w * scale) / 2;
  var offsetY = pad + (ch - pad * 2 - bb.h * scale) / 2;

  // Draw edges
  minimapCtx.strokeStyle = 'rgba(48,54,61,0.4)';
  minimapCtx.lineWidth = 0.5;
  cy.edges().forEach(function(e) {
    if (e.style('display') === 'none') return;
    var sp = e.source().position();
    var tp = e.target().position();
    var sx = (sp.x - bb.x1) * scale + offsetX;
    var sy = (sp.y - bb.y1) * scale + offsetY;
    var tx = (tp.x - bb.x1) * scale + offsetX;
    var ty = (tp.y - bb.y1) * scale + offsetY;
    minimapCtx.beginPath();
    minimapCtx.moveTo(sx, sy);
    minimapCtx.lineTo(tx, ty);
    minimapCtx.stroke();
  });

  // Draw nodes
  cy.nodes().forEach(function(n) {
    if (n.style('display') === 'none') return;
    if (n.isParent() && !n.hasClass('collapsed-cluster')) return; // skip regular parents, but render collapsed clusters
    var pos = n.position();
    var x = (pos.x - bb.x1) * scale + offsetX;
    var y = (pos.y - bb.y1) * scale + offsetY;
    var color = n.data('nodeColor') || '#8b949e';
    var alpha = 1.0;

    // Sync with trace state
    if (n.hasClass('trace-dimmed')) alpha = 0.1;
    else if (n.hasClass('traced') || n.hasClass('trace-origin')) alpha = 1.0;
    // Sync with search state
    if (n.hasClass('faded')) alpha = 0.15;
    else if (n.hasClass('highlighted')) alpha = 1.0;

    minimapCtx.globalAlpha = alpha;

    if (n.hasClass('collapsed-cluster')) {
      minimapCtx.fillStyle = '#21262d';
      minimapCtx.strokeStyle = '#58a6ff';
      minimapCtx.lineWidth = Math.max(0.5, 2 * scale);
      var w = 80 * scale;
      var h = 40 * scale;
      minimapCtx.fillRect(x - w/2, y - h/2, w, h);
      minimapCtx.strokeRect(x - w/2, y - h/2, w, h);
    } else {
      minimapCtx.fillStyle = color;
      minimapCtx.beginPath();
      minimapCtx.arc(x, y, n.hasClass('trace-origin') ? 4 : 2.5, 0, Math.PI * 2);
      minimapCtx.fill();
    }
  });
  minimapCtx.globalAlpha = 1.0;

  // Draw viewport rectangle
  var ext = cy.extent();
  var vx = (ext.x1 - bb.x1) * scale + offsetX;
  var vy = (ext.y1 - bb.y1) * scale + offsetY;
  var vw = ext.w * scale;
  var vh = ext.h * scale;
  minimapCtx.strokeStyle = 'rgba(88,166,255,0.7)';
  minimapCtx.lineWidth = 1.5;
  minimapCtx.strokeRect(vx, vy, vw, vh);
  minimapCtx.fillStyle = 'rgba(88,166,255,0.06)';
  minimapCtx.fillRect(vx, vy, vw, vh);

  // Store mapping for click-to-navigate
  minimapEl._bb = bb;
  minimapEl._scale = scale;
  minimapEl._offsetX = offsetX;
  minimapEl._offsetY = offsetY;
}

// Minimap drag-to-navigate
var minimapDragging = false;

function minimapNavigate(clientX, clientY) {
  var rect = minimapEl.getBoundingClientRect();
  var mx = clientX - rect.left;
  var my = clientY - rect.top;
  var bb = minimapEl._bb;
  var scale = minimapEl._scale;
  var ox = minimapEl._offsetX;
  var oy = minimapEl._offsetY;
  if (!bb || !scale) return;

  var graphX = (mx - ox) / scale + bb.x1;
  var graphY = (my - oy) / scale + bb.y1;
  cy.center({ eles: cy.collection() }); // reset
  cy.pan({
    x: cy.width() / 2 - graphX * cy.zoom(),
    y: cy.height() / 2 - graphY * cy.zoom()
  });
}

minimapEl.addEventListener('mousedown', function(e) {
  minimapDragging = true;
  minimapNavigate(e.clientX, e.clientY);
});

document.addEventListener('mousemove', function(e) {
  if (minimapDragging) {
    minimapNavigate(e.clientX, e.clientY);
  }
});

document.addEventListener('mouseup', function() {
  minimapDragging = false;
});

// Update minimap on pan/zoom/layout
cy.on('pan zoom resize', function() {
  requestAnimationFrame(renderMinimap);
});

// Also re-render after layout completes
cy.on('layoutstop', function() {
  setTimeout(renderMinimap, 100);
});

// Initial render after layout
setTimeout(renderMinimap, 500);

// Toggle minimap
minimapToggle.addEventListener('click', function() {
  minimapVisible = !minimapVisible;
  minimapEl.classList.toggle('hidden', !minimapVisible);
  minimapToggle.classList.toggle('active', minimapVisible);
  if (minimapVisible) renderMinimap();
});

// Keyboard shortcut: M to toggle minimap
document.addEventListener('keydown', function(e) {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  if (e.key === 'm' || e.key === 'M') {
    minimapVisible = !minimapVisible;
    minimapEl.classList.toggle('hidden', !minimapVisible);
    minimapToggle.classList.toggle('active', minimapVisible);
    if (minimapVisible) renderMinimap();
  }
});

${!isInline ? '} // end initViewer' : ''}

${isInline ? '// Inline mode: run viewer immediately' : '// External mode: initViewer() called after fetch completes'}
</script>
</body>
</html>`;
}
