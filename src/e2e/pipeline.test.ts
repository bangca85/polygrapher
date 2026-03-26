import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CLI = 'node dist/index.js';
const FIXTURES = path.resolve('test-fixtures/go');

function cleanupOutput(projectPath: string) {
  const outDir = path.join(projectPath, 'polygrapher');
  try {
    fs.unlinkSync(path.join(outDir, 'system-map.json'));
    fs.unlinkSync(path.join(outDir, 'system-map.md'));
    fs.unlinkSync(path.join(outDir, 'system-map.html'));
    fs.rmdirSync(outDir);
  } catch { /* ignore if already cleaned */ }
}

describe('E2E Pipeline', () => {
  describe('Story 6.1: Deterministic output on fixtures', () => {
    const projects = ['gin-project', 'chi-project', 'simple-api', 'grpc-service'];

    for (const project of projects) {
      it(`produces correct output for ${project}`, () => {
        const projectPath = path.join(FIXTURES, project);
        const result = execSync(`${CLI} --export-only ${projectPath}`, {
          encoding: 'utf-8',
          timeout: 15000,
        });

        // Should exit cleanly and print file paths
        expect(result).toContain('system-map.json');
        expect(result).toContain('system-map.md');
        expect(result).toContain('system-map.html');

        // All 3 files should exist
        expect(fs.existsSync(path.join(projectPath, 'polygrapher', 'system-map.json'))).toBe(true);
        expect(fs.existsSync(path.join(projectPath, 'polygrapher', 'system-map.md'))).toBe(true);
        expect(fs.existsSync(path.join(projectPath, 'polygrapher', 'system-map.html'))).toBe(true);

        // Parse JSON and check structure
        const json = JSON.parse(fs.readFileSync(path.join(projectPath, 'polygrapher', 'system-map.json'), 'utf-8'));
        expect(json.meta).toBeDefined();
        expect(json.meta.repo).toBe(project);
        expect(json.meta.languages).toContain('go');
        expect(json.nodes.length).toBeGreaterThan(0);

        // Cleanup
        fs.unlinkSync(path.join(projectPath, 'polygrapher', 'system-map.json'));
        fs.unlinkSync(path.join(projectPath, 'polygrapher', 'system-map.md'));
        fs.unlinkSync(path.join(projectPath, 'polygrapher', 'system-map.html'));
      });
    }

    it('produces deterministic output (two runs are identical)', () => {
      const projectPath = path.join(FIXTURES, 'gin-project');

      // Run 1
      execSync(`${CLI} --export-only ${projectPath}`, { timeout: 15000 });
      const json1 = fs.readFileSync(path.join(projectPath, 'polygrapher', 'system-map.json'), 'utf-8');
      const parsed1 = JSON.parse(json1);
      cleanupOutput(projectPath);

      // Run 2
      execSync(`${CLI} --export-only ${projectPath}`, { timeout: 15000 });
      const json2 = fs.readFileSync(path.join(projectPath, 'polygrapher', 'system-map.json'), 'utf-8');
      const parsed2 = JSON.parse(json2);
      cleanupOutput(projectPath);

      // Compare nodes and edges (ignore generatedAt timestamp)
      expect(parsed1.nodes).toEqual(parsed2.nodes);
      expect(parsed1.edges).toEqual(parsed2.edges);
      expect(parsed1.meta.repo).toEqual(parsed2.meta.repo);
      expect(parsed1.meta.languages).toEqual(parsed2.meta.languages);
    });

    it('gin-project has correct node types and counts', () => {
      const projectPath = path.join(FIXTURES, 'gin-project');
      execSync(`${CLI} --export-only ${projectPath}`, { timeout: 15000 });
      const json = JSON.parse(fs.readFileSync(path.join(projectPath, 'polygrapher', 'system-map.json'), 'utf-8'));

      // Should have functions and handlers
      const handlers = json.nodes.filter((n: any) => n.type === 'handler');
      const functions = json.nodes.filter((n: any) => n.type === 'function');
      expect(handlers.length).toBeGreaterThanOrEqual(3); // GetUsers, CreateUser, GetBookings
      expect(functions.length).toBeGreaterThanOrEqual(2); // main, FetchAllUsers, FetchBookings

      // Should have route edges
      const routeEdges = json.edges.filter((e: any) => e.type === 'routes-to');
      expect(routeEdges.length).toBeGreaterThanOrEqual(3);

      // Should have call edges
      const callEdges = json.edges.filter((e: any) => e.type === 'calls');
      expect(callEdges.length).toBeGreaterThanOrEqual(1);

      // Cleanup
      cleanupOutput(projectPath);
    });

    it('grpc-service has service and struct nodes', () => {
      const projectPath = path.join(FIXTURES, 'grpc-service');
      execSync(`${CLI} --export-only ${projectPath}`, { timeout: 15000 });
      const json = JSON.parse(fs.readFileSync(path.join(projectPath, 'polygrapher', 'system-map.json'), 'utf-8'));

      const services = json.nodes.filter((n: any) => n.type === 'grpc');
      const structs = json.nodes.filter((n: any) => n.type === 'struct');
      expect(services.length).toBeGreaterThanOrEqual(3); // CreateBooking, GetBooking, ListBookings
      expect(structs.length).toBeGreaterThanOrEqual(1); // Booking

      // Cleanup
      cleanupOutput(projectPath);
    });

    it('HTML viewer is self-contained (no CDN, inline cytoscape)', () => {
      const projectPath = path.join(FIXTURES, 'gin-project');
      execSync(`${CLI} --export-only ${projectPath}`, { timeout: 15000 });
      const html = fs.readFileSync(path.join(projectPath, 'polygrapher', 'system-map.html'), 'utf-8');

      // No CDN references — cytoscape must be inlined
      expect(html).not.toContain('unpkg.com');
      expect(html).not.toContain('cdn.jsdelivr.net');
      expect(html).toContain('cytoscape'); // library source is inlined

      // VS Code links use encodeURI
      expect(html).toContain('encodeURI');

      // Faded opacity is 0.20 per FR27
      expect(html).toContain("'opacity': 0.20");
      expect(html).not.toContain("'opacity': 0.15");

      // Route nodes are created from routes-to edges (not route-registration)
      expect(html).toContain("e.type === 'routes-to'");
      expect(html).not.toContain("e.source === 'route-registration'");

      // M-1: repo name in <title> is HTML-escaped (not raw)
      expect(html).toContain('<title>Polygrapher');
      expect(html).not.toContain('<title>Polygrapher — ${'); // no raw template interpolation

      // M-4: no inline onclick with dynamic data (uses data-focus-id + addEventListener)
      expect(html).not.toContain("onclick=\"focusNode(");
      expect(html).toContain('data-focus-id');
      expect(html).toContain("el.dataset.focusId");

      // Cleanup
      cleanupOutput(projectPath);
    });

    it('Epic 7: Path tracing logic present in HTML viewer', () => {
      const projectPath = path.join(FIXTURES, 'gin-project');
      execSync(`${CLI} --export-only ${projectPath}`, { timeout: 15000 });
      const html = fs.readFileSync(path.join(projectPath, 'polygrapher', 'system-map.html'), 'utf-8');

      // FR39/FR40: BFS trace function exists with upstream/downstream support
      expect(html).toContain('function tracePaths');
      expect(html).toContain("dir === 'downstream'");
      expect(html).toContain("'upstream'");

      // FR41: Trace dim opacity is exactly 0.1 for both nodes and edges
      expect(html).toContain("selector: 'node.trace-dimmed'");
      expect(html).toContain("selector: 'edge.trace-dimmed'");
      // Both must use 0.1
      const nodeDimMatch = html.match(/node\.trace-dimmed.*?opacity.*?([\d.]+)/s);
      const edgeDimMatch = html.match(/edge\.trace-dimmed.*?opacity.*?([\d.]+)/s);
      expect(nodeDimMatch).toBeTruthy();
      expect(edgeDimMatch).toBeTruthy();
      expect(parseFloat(nodeDimMatch![1])).toBe(0.1);
      expect(parseFloat(edgeDimMatch![1])).toBe(0.1);

      // FR42: Trace mode toggle buttons (upstream/downstream/both)
      expect(html).toContain("data-trace=\"upstream\"");
      expect(html).toContain("data-trace=\"downstream\"");
      expect(html).toContain("data-trace=\"both\"");

      // FR43: Depth indicator rendered in traced node label
      expect(html).toContain('traceDepth');
      // Traced node style includes label function that appends depth
      expect(html).toContain("ele.data('traceDepth')");

      // Story 7.1: Leaf node visual indicator
      expect(html).toContain("selector: 'node.leaf-node'");
      expect(html).toContain("addClass('leaf-node')");

      // Cycle detection
      expect(html).toContain("addClass('cycle-node')");

      // Cleanup
      cleanupOutput(projectPath);
    });

    it('Epic 8: Edge interaction logic present in HTML viewer', () => {
      const projectPath = path.join(FIXTURES, 'gin-project');
      execSync(`${CLI} --export-only ${projectPath}`, { timeout: 15000 });
      const html = fs.readFileSync(path.join(projectPath, 'polygrapher', 'system-map.html'), 'utf-8');

      // FR44: Edge click opens detail panel with metadata
      expect(html).toContain('function openEdgePanel');
      expect(html).toContain("cy.on('tap', 'edge'");

      // FR45: Edge hover tooltip
      expect(html).toContain("cy.on('mouseover', 'edge'");
      expect(html).toContain('edgeTooltip');

      // FR46: Call site VS Code link uses callLine (not srcNode.line)
      expect(html).toContain('edgeData.callLine');
      expect(html).toContain('Call site');

      // Edge data includes callLine field (both normal and split route edges)
      expect(html).toContain('callLine: e.callLine');

      // FR46: Split route edges also propagate callLine
      // The route edge split code creates e...a and e...b edges — both must carry callLine
      const splitEdgeMatches = html.match(/id: 'e' \+ i \+ '[ab]'[\s\S]*?callLine/g);
      expect(splitEdgeMatches).toBeTruthy();
      expect(splitEdgeMatches!.length).toBeGreaterThanOrEqual(2);

      // Cleanup
      cleanupOutput(projectPath);
    });

    it('Epic 8: Go extractor emits callLine on all edge types', () => {
      const projectPath = path.join(FIXTURES, 'gin-project');
      execSync(`${CLI} --export-only ${projectPath}`, { timeout: 15000 });
      const json = JSON.parse(fs.readFileSync(path.join(projectPath, 'polygrapher', 'system-map.json'), 'utf-8'));

      const callEdges = json.edges.filter((e: any) => e.type === 'calls');
      expect(callEdges.length).toBeGreaterThan(0);

      // At least some call edges should have callLine
      const withCallLine = callEdges.filter((e: any) => typeof e.callLine === 'number' && e.callLine > 0);
      expect(withCallLine.length).toBeGreaterThan(0);

      // callLine should be different from source node's declaration line
      for (const edge of withCallLine) {
        const srcNode = json.nodes.find((n: any) => n.id === edge.source);
        if (srcNode) {
          // callLine is the line of the call expression inside the function body,
          // which should be >= the function declaration line
          expect(edge.callLine).toBeGreaterThanOrEqual(srcNode.line);
        }
      }

      // FR46: routes-to edges also carry callLine (route registration line)
      const routeEdges = json.edges.filter((e: any) => e.type === 'routes-to');
      expect(routeEdges.length).toBeGreaterThan(0);
      const routesWithCallLine = routeEdges.filter((e: any) => typeof e.callLine === 'number' && e.callLine > 0);
      expect(routesWithCallLine.length).toBe(routeEdges.length); // ALL routes-to edges must have callLine

      // Cleanup
      cleanupOutput(projectPath);
    });

    it('Epic 9: Auto-clustering and FR51 aggregated edges in HTML viewer', () => {
      const projectPath = path.join(FIXTURES, 'gin-project');
      execSync(`${CLI} --export-only ${projectPath}`, { timeout: 15000 });
      const html = fs.readFileSync(path.join(projectPath, 'polygrapher', 'system-map.html'), 'utf-8');

      // FR47: Clustering threshold > 50 nodes
      expect(html).toContain('nodeCount > 50');

      // FR47-48: Cluster building with compound parent nodes
      expect(html).toContain('function buildClusters');
      expect(html).toContain('function getClusterKey');

      // FR49-50: Collapse/expand cluster functions
      expect(html).toContain('function collapseCluster');
      expect(html).toContain('function expandCluster');
      expect(html).toContain('collapsed-cluster');

      // FR51: Aggregated edges between collapsed clusters
      expect(html).toContain('function updateAggregatedEdges');
      expect(html).toContain('aggregated-edge');
      // Aggregated edge has count label
      expect(html).toContain("edgeType: 'aggregated'");
      // Aggregated edge CSS style
      expect(html).toContain("selector: 'edge.aggregated-edge'");
      // Aggregated edges created between collapsed clusters
      expect(html).toContain('srcCluster');
      expect(html).toContain('tgtCluster');
      // Count badge via label data
      expect(html).toContain("'label': 'data(label)'");

      // Cleanup on removeClusters
      expect(html).toContain("cy.edges('.aggregated-edge').remove()");

      // Cleanup
      cleanupOutput(projectPath);
    });

    it('Epic 10: Expand/collapse disabled — all nodes always visible', () => {
      const projectPath = path.join(FIXTURES, 'gin-project');
      execSync(`${CLI} --export-only ${projectPath}`, { timeout: 15000 });
      const html = fs.readFileSync(path.join(projectPath, 'polygrapher', 'system-map.html'), 'utf-8');

      // Functions exist as no-ops (kept for API compatibility)
      expect(html).toContain('function markExpandableNodes');
      expect(html).toContain('function expandNodeCallees');
      expect(html).toContain('function collapseNodeCallees');

      // Feature is disabled — no node hiding logic
      expect(html).not.toContain("addClass('expandable')");
      expect(html).not.toContain("addClass('hidden-callee')");

      cleanupOutput(projectPath);
    });

    it('Epic 11: Minimap rendering, sync, and positioning in HTML viewer', () => {
      const projectPath = path.join(FIXTURES, 'gin-project');
      execSync(`${CLI} --export-only ${projectPath}`, { timeout: 15000 });
      const html = fs.readFileSync(path.join(projectPath, 'polygrapher', 'system-map.html'), 'utf-8');

      // FR56: Minimap element and canvas
      expect(html).toContain('id="minimap"');
      expect(html).toContain('function renderMinimap');

      // FR56 AC: Minimap max 150x150px
      expect(html).toContain('width: 150px');
      expect(html).toContain('height: 150px');

      // FR57: Viewport rectangle overlay
      expect(html).toContain('Draw viewport rectangle');

      // FR58: Click and drag in minimap to navigate
      expect(html).toContain('minimap');
      expect(html).toContain('mousedown');

      // FR59: Minimap syncs with trace and search state
      // renderMinimap called after trace
      expect(html).toContain('trace-dimmed');
      expect(html).toContain('n.hasClass(\'faded\')');
      // renderMinimap triggered after search/trace changes
      const renderCalls = html.match(/renderMinimap/g);
      expect(renderCalls).toBeTruthy();
      expect(renderCalls!.length).toBeGreaterThanOrEqual(6); // search clear, search match, tracePaths, clearTrace, pan/zoom, layout

      // FR60: Toggle via button and M key
      expect(html).toContain('minimapToggle');
      expect(html).toContain("e.key === 'm'");

      // Auto-hide on small graphs (<30 nodes)
      expect(html).toContain('nodeCount < 30');

      // Minimap shifts when detail panel opens (doesn't obscure panel)
      expect(html).toContain('updateMinimapPosition');
      expect(html).toContain("376px"); // 360px panel + 16px gap

      cleanupOutput(projectPath);
    });

    it('unsupported language exits with error', () => {
      const projectPath = path.resolve('test-fixtures/unsupported-lang');
      expect(() => {
        execSync(`${CLI} --export-only ${projectPath}`, {
          encoding: 'utf-8',
          timeout: 5000,
          stdio: 'pipe',
        });
      }).toThrow();
    });

    it('Epic 12.5: mixed Go+NextJS repo detects both languages and cross-language edges', () => {
      const projectPath = path.resolve('test-fixtures/mixed/go-nextjs');
      execSync(`${CLI} --export-only ${projectPath}`, { timeout: 15000 });

      const json = JSON.parse(
        fs.readFileSync(path.join(projectPath, 'polygrapher', 'system-map.json'), 'utf-8')
      );

      // Both languages detected
      expect(json.meta.languages).toContain('go');
      expect(json.meta.languages).toContain('typescript');

      // Go handler node exists
      const goHandler = json.nodes.find((n: any) => n.name === 'handleBooking');
      expect(goHandler).toBeDefined();

      // TS function node exists
      const tsFunc = json.nodes.find((n: any) => n.name === 'callBookingApi');
      expect(tsFunc).toBeDefined();

      // Cross-language edge: TS fetch('/api/booking') -> Go handleBooking handler
      const restEdge = json.edges.find(
        (e: any) => e.type === 'calls' && e.protocol === 'REST' && e.metadata?.path === '/api/booking'
      );
      expect(restEdge).toBeDefined();
      // Edge target should be resolved to the Go handler node (not the raw URL)
      expect(restEdge.target).toBe(goHandler.id);

      cleanupOutput(projectPath);
    });
  });

    it('Epic 13: Dart bloc-app produces correct node types', () => {
      const projectPath = path.resolve('test-fixtures/dart/bloc-app');
      execSync(`${CLI} --export-only ${projectPath}`, { timeout: 15000 });

      const json = JSON.parse(
        fs.readFileSync(path.join(projectPath, 'polygrapher', 'system-map.json'), 'utf-8')
      );

      expect(json.meta.languages).toContain('dart');

      // BLoC nodes
      const blocNodes = json.nodes.filter((n: any) => n.type === 'bloc');
      expect(blocNodes.length).toBeGreaterThanOrEqual(1);

      // Service nodes (Repository, UseCase, DataSource)
      const serviceNodes = json.nodes.filter((n: any) => n.type === 'service');
      expect(serviceNodes.length).toBeGreaterThanOrEqual(1);

      // Component nodes (Widgets)
      const componentNodes = json.nodes.filter((n: any) => n.type === 'component');
      expect(componentNodes.length).toBeGreaterThanOrEqual(1);

      // Dio REST call edges
      const restEdges = json.edges.filter((e: any) => e.protocol === 'REST');
      expect(restEdges.length).toBeGreaterThanOrEqual(1);

      cleanupOutput(projectPath);
    });

    it('Epic 13: Dart riverpod-app extracts providers and routes', () => {
      const projectPath = path.resolve('test-fixtures/dart/riverpod-app');
      execSync(`${CLI} --export-only ${projectPath}`, { timeout: 15000 });

      const json = JSON.parse(
        fs.readFileSync(path.join(projectPath, 'polygrapher', 'system-map.json'), 'utf-8')
      );

      expect(json.meta.languages).toContain('dart');

      // Riverpod provider nodes (service type)
      const serviceNodes = json.nodes.filter((n: any) => n.type === 'service');
      expect(serviceNodes.length).toBeGreaterThanOrEqual(2);

      // GoRouter route nodes
      const routeNodes = json.nodes.filter((n: any) => n.type === 'route');
      expect(routeNodes.length).toBeGreaterThanOrEqual(2);

      // routes-to edges
      const routeEdges = json.edges.filter((e: any) => e.type === 'routes-to');
      expect(routeEdges.length).toBeGreaterThanOrEqual(2);

      cleanupOutput(projectPath);
    });

    it('Epic 13: Dart pure-dart extracts functions and services (no widgets)', () => {
      const projectPath = path.resolve('test-fixtures/dart/pure-dart');
      execSync(`${CLI} --export-only ${projectPath}`, { timeout: 15000 });

      const json = JSON.parse(
        fs.readFileSync(path.join(projectPath, 'polygrapher', 'system-map.json'), 'utf-8')
      );

      expect(json.meta.languages).toContain('dart');

      // Should have function and service nodes
      const functionNodes = json.nodes.filter((n: any) => n.type === 'function');
      expect(functionNodes.length).toBeGreaterThanOrEqual(1);

      // No widget/component nodes (no Flutter dependency)
      const componentNodes = json.nodes.filter((n: any) => n.type === 'component');
      expect(componentNodes).toHaveLength(0);

      cleanupOutput(projectPath);
    });

    it('Epic 13: triple-language monorepo (Go+TS+Dart) with cross-language edges', () => {
      const projectPath = path.resolve('test-fixtures/mixed/go-nextjs-flutter');
      execSync(`${CLI} --export-only ${projectPath}`, { timeout: 15000 });

      const json = JSON.parse(
        fs.readFileSync(path.join(projectPath, 'polygrapher', 'system-map.json'), 'utf-8')
      );

      // All three languages detected
      expect(json.meta.languages).toContain('go');
      expect(json.meta.languages).toContain('typescript');
      expect(json.meta.languages).toContain('dart');

      // Cross-language edges: Dart → Go
      const crossLangEdges = json.edges.filter(
        (e: any) => e.type === 'calls' && e.protocol === 'REST' && e.matchConfidence === 'exact'
      );
      expect(crossLangEdges.length).toBeGreaterThanOrEqual(2);

      // Edge validity: all edge sources and targets must reference existing node IDs
      const nodeIds = new Set(json.nodes.map((n: any) => n.id));
      for (const edge of json.edges) {
        expect(nodeIds.has(edge.source)).toBe(true);
        expect(nodeIds.has(edge.target)).toBe(true);
      }

      cleanupOutput(projectPath);
    });

    it('Epic 13: Dart bloc-app edge validity (sources valid, non-REST targets valid)', () => {
      const projectPath = path.resolve('test-fixtures/dart/bloc-app');
      execSync(`${CLI} --export-only ${projectPath}`, { timeout: 15000 });

      const json = JSON.parse(
        fs.readFileSync(path.join(projectPath, 'polygrapher', 'system-map.json'), 'utf-8')
      );

      const nodeIds = new Set(json.nodes.map((n: any) => n.id));

      // All edge sources must reference real nodes
      for (const edge of json.edges) {
        expect(nodeIds.has(edge.source)).toBe(true);
      }

      // Non-REST edge targets must reference real nodes
      const nonRestEdges = json.edges.filter((e: any) => e.protocol !== 'REST');
      for (const edge of nonRestEdges) {
        expect(nodeIds.has(edge.target)).toBe(true);
      }

      // REST edges without cross-language route matches have unresolved targets (expected)
      const restEdges = json.edges.filter((e: any) => e.protocol === 'REST');
      expect(restEdges.length).toBeGreaterThan(0);

      cleanupOutput(projectPath);
    });

    it('Epic 13: Dart output is deterministic', () => {
      const projectPath = path.resolve('test-fixtures/dart/bloc-app');

      execSync(`${CLI} --export-only ${projectPath}`, { timeout: 15000 });
      const json1 = fs.readFileSync(path.join(projectPath, 'polygrapher', 'system-map.json'), 'utf-8');
      cleanupOutput(projectPath);

      execSync(`${CLI} --export-only ${projectPath}`, { timeout: 15000 });
      const json2 = fs.readFileSync(path.join(projectPath, 'polygrapher', 'system-map.json'), 'utf-8');

      const obj1 = JSON.parse(json1);
      const obj2 = JSON.parse(json2);
      obj1.meta.generatedAt = '';
      obj2.meta.generatedAt = '';

      expect(obj1).toEqual(obj2);

      cleanupOutput(projectPath);
    });

  // ─── Item 7: Deterministic output ─────────────────────────────────
  describe('Deterministic output', () => {
    it('produces identical JSON on two consecutive runs', () => {
      const projectPath = path.join(FIXTURES, 'gin-project');

      // Run 1
      execSync(`${CLI} --export-only ${projectPath}`, { timeout: 15000 });
      const json1 = fs.readFileSync(path.join(projectPath, 'polygrapher', 'system-map.json'), 'utf-8');

      // Run 2
      execSync(`${CLI} --export-only ${projectPath}`, { timeout: 15000 });
      const json2 = fs.readFileSync(path.join(projectPath, 'polygrapher', 'system-map.json'), 'utf-8');

      // Parse and compare (exclude generatedAt timestamp)
      const obj1 = JSON.parse(json1);
      const obj2 = JSON.parse(json2);
      obj1.meta.generatedAt = '';
      obj2.meta.generatedAt = '';

      expect(obj1).toEqual(obj2);

      cleanupOutput(projectPath);
    });

    it('TS project produces identical JSON on two runs', () => {
      const projectPath = path.resolve('test-fixtures/ts/nextjs-app');

      execSync(`${CLI} --export-only ${projectPath}`, { timeout: 15000 });
      const json1 = fs.readFileSync(path.join(projectPath, 'polygrapher', 'system-map.json'), 'utf-8');

      execSync(`${CLI} --export-only ${projectPath}`, { timeout: 15000 });
      const json2 = fs.readFileSync(path.join(projectPath, 'polygrapher', 'system-map.json'), 'utf-8');

      const obj1 = JSON.parse(json1);
      const obj2 = JSON.parse(json2);
      obj1.meta.generatedAt = '';
      obj2.meta.generatedAt = '';

      expect(obj1).toEqual(obj2);

      cleanupOutput(projectPath);
    });
  });
});
