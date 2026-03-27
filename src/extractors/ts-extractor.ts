import fs from 'node:fs';
import path from 'node:path';
import type Parser from 'web-tree-sitter';
import { createParser, parseSource } from '../parser/tree-sitter-engine.js';
import { generateNodeId } from '../graph/node-id.js';
import { Language, NodeType, EdgeType, Protocol } from '../types/graph.types.js';
import type { GraphNode, GraphEdge } from '../types/graph.types.js';
import type { LanguageExtractor, ExtractorResult, ParseError } from '../types/extractor.types.js';

interface RouteRegistration {
  method: string;
  path: string;
  handlerName: string;
  line: number;
  file: string;
}

interface FrameworkInfo {
  hasNext: boolean;
  hasReact: boolean;
  hasReactRouter: boolean;
  hasRedux: boolean;
  hasZustand: boolean;
  hasNest: boolean;
}

interface AxiosInstance {
  variableName: string;
  baseURL: string;
}

export class TypeScriptExtractor implements LanguageExtractor {
  readonly language = Language.TypeScript;
  readonly configFiles = ['package.json'];

  private rootPath = '';
  private repoName = '';

  async detect(rootPath: string): Promise<boolean> {
    return fs.existsSync(path.join(rootPath, 'package.json'));
  }

  async parse(files: string[], rootPath?: string): Promise<ExtractorResult> {
    this.rootPath = rootPath || path.dirname(files[0] || '.');
    this.repoName = path.basename(this.rootPath);

    const allNodes: GraphNode[] = [];
    const allEdges: GraphEdge[] = [];
    const allRoutes: RouteRegistration[] = [];
    const errors: ParseError[] = [];

    // Detect framework from package.json
    const framework = this.detectFramework();

    // Create parsers for different file types
    const tsParser = await createParser(Language.TypeScript);
    const tsxParser = await createParser('tsx');
    const jsParser = await createParser('javascript');

    for (const file of files) {
      try {
        const source = fs.readFileSync(file, 'utf-8');
        const relFile = path.relative(this.rootPath, file);
        const ext = path.extname(file);

        // Choose parser based on file extension
        let parser: Parser;
        if (ext === '.tsx' || ext === '.jsx') {
          parser = tsxParser;
        } else if (ext === '.js') {
          parser = jsParser;
        } else {
          parser = tsParser;
        }

        const tree = parseSource(parser, source);
        const result = this.extractFromTree(tree, relFile, source, framework);

        allNodes.push(...result.nodes);
        allEdges.push(...result.edges);
        allRoutes.push(...result.routes);

        // Next.js route detection from file path
        if (framework.hasNext) {
          const fileRoutes = this.extractNextRoutes(tree, relFile, source);
          allRoutes.push(...fileRoutes);
        }

        // Extract React.lazy declarations as component nodes
        // Import edges created in post-processing (need all files parsed first)
        this.extractLazyComponents(source, relFile, allNodes, []);

        // Route config object detection: { path: '/...', component: ComponentName }
        // Supports React Router v5 config objects and similar patterns
        const configRoutes = this.extractRouteConfigObjects(source, relFile);
        allRoutes.push(...configRoutes);

        // Express-like route detection: app.get('/path', handler), r.post('/path', handler)
        const expressRoutes = this.extractExpressLikeRoutes(source, relFile);
        allRoutes.push(...expressRoutes);
      } catch (error) {
        errors.push({
          file,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Post-processing: link React.lazy components to their actual components
    this.resolveLazyImports(allNodes, allEdges);

    // Build name → node lookup
    const nameToNodes = new Map<string, GraphNode[]>();
    const addToMap = (key: string, node: GraphNode) => {
      const existing = nameToNodes.get(key) ?? [];
      existing.push(node);
      nameToNodes.set(key, existing);
    };
    for (const n of allNodes) {
      addToMap(n.name, n);
    }

    const nodeIdToFile = new Map(allNodes.map(n => [n.id, n.file]));

    // Build file-path index for import resolution
    // Maps relative import path patterns to node IDs
    const fileToModuleId = new Map<string, string>();
    for (const n of allNodes) {
      // Index by file path without extension, for import matching
      const noExt = n.file.replace(/\.(ts|tsx|js|jsx)$/, '');
      fileToModuleId.set(noExt, n.id);
      // Also index by file path with /index removed
      const noIndex = noExt.replace(/\/index$/, '');
      if (noIndex !== noExt) fileToModuleId.set(noIndex, n.id);
    }

    // Build file → main export node ID index (first exported node per file)
    // Used to resolve import edge sources from __module__ to a real node
    const fileToMainNode = new Map<string, string>();
    for (const n of allNodes) {
      if (!fileToMainNode.has(n.file)) {
        fileToMainNode.set(n.file, n.id);
      }
    }

    // Story 12.20: Index barrel re-export files in fileToModuleId
    // Barrel files (index.ts with only re-exports) have no own nodes,
    // so they need synthetic entries pointing to their re-export targets.
    // First pass: collect re-export edges (import edges from barrel files)
    const barrelTargets = new Map<string, string[]>(); // sourceFile → [importPath, ...]
    for (const edge of allEdges) {
      if (edge.type === EdgeType.Imports) {
        const sourceFile = (edge.metadata as any)?.sourceFile ?? '';
        // If this file has no nodes, it's likely a barrel file
        if (sourceFile && !fileToMainNode.has(sourceFile)) {
          const existing = barrelTargets.get(sourceFile) ?? [];
          existing.push(edge.target);
          barrelTargets.set(sourceFile, existing);
        }
      }
    }
    // Register barrel file paths in fileToModuleId, pointing to their first re-export target
    for (const [barrelFile, targets] of barrelTargets) {
      const barrelNoExt = barrelFile.replace(/\.(ts|tsx|js|jsx)$/, '');
      if (!fileToModuleId.has(barrelNoExt)) {
        // Resolve the first re-export target to get a real node ID
        for (const target of targets) {
          let resolvedTarget = target;
          if (resolvedTarget.startsWith('.')) {
            const barrelDir = barrelFile.substring(0, barrelFile.lastIndexOf('/'));
            resolvedTarget = path.posix.normalize(barrelDir + '/' + resolvedTarget);
          }
          const matchedId = fileToModuleId.get(resolvedTarget);
          if (matchedId) {
            fileToModuleId.set(barrelNoExt, matchedId);
            // Also index without /index suffix
            const noIndex = barrelNoExt.replace(/\/index$/, '');
            if (noIndex !== barrelNoExt) fileToModuleId.set(noIndex, matchedId);
            break;
          }
        }
      }
    }

    // Build node ID set for pre-resolved edge detection
    const nodeIdSet = new Set(allNodes.map(n => n.id));

    // Resolve call edges
    const resolvedEdges: GraphEdge[] = [];
    for (const edge of allEdges) {
      if (edge.type === EdgeType.Calls) {
        // Preserve REST API call edges (fetch/axios) as-is — their targets are URLs, not node names
        if (edge.protocol === Protocol.REST && edge.metadata?.path) {
          resolvedEdges.push(edge);
          continue;
        }
        // Preserve pre-resolved edges (Redux/Zustand internal edges with node ID targets)
        if (nodeIdSet.has(edge.target)) {
          resolvedEdges.push(edge);
          continue;
        }
        const targets = nameToNodes.get(edge.target);
        if (targets && targets.length > 0) {
          const callerFile = nodeIdToFile.get(edge.source) ?? '';
          const sameFile = targets.find(t => t.file === callerFile);
          edge.target = (sameFile ?? targets[0]).id;
          resolvedEdges.push(edge);
        } else if (edge.metadata?.kind === 'dependency-injection') {
          // Preserve DI edges even when target is unresolved (cross-file injection)
          resolvedEdges.push(edge);
        }
        // Drop unresolved call edges (stdlib, external)
      } else if (edge.type === EdgeType.Imports) {
        // Preserve NestJS DI/module edges (they use class names as targets, not file paths)
        const rel = edge.metadata?.relationship;
        if (rel === 'injects' || rel === 'module-import' || rel === 'provides') {
          // Try to resolve target class name to a node ID
          const targetNodes = nameToNodes.get(edge.target);
          if (targetNodes && targetNodes.length > 0) {
            edge.target = targetNodes[0].id;
          }
          resolvedEdges.push(edge);
          continue;
        }

        // Resolve import edges by file path, not by name
        let importTarget = edge.target;
        const sourceFile = (edge.metadata as any)?.sourceFile ?? '';

        // Handle path aliases: @/ → project root, @components/ → components/, etc.
        if (importTarget.startsWith('@/')) {
          importTarget = importTarget.substring(2); // '@/components/X' → 'components/X'
        } else if (importTarget.startsWith('.') || importTarget.startsWith('/')) {
          // Relative imports: resolve relative to caller file
          const callerFile = nodeIdToFile.get(edge.source) ?? sourceFile;
          const callerDir = callerFile.substring(0, callerFile.lastIndexOf('/'));
          importTarget = path.posix.normalize(callerDir + '/' + importTarget);
        } else {
          // External package — skip
          continue;
        }

        const matchedId = fileToModuleId.get(importTarget);
        if (matchedId) {
          // Resolve source: map __module__ source to real node from importing file
          const resolvedSource = fileToMainNode.get(sourceFile);
          if (resolvedSource) {
            edge.source = resolvedSource;
            edge.target = matchedId;
            resolvedEdges.push(edge);
          } else {
            // Barrel re-export files: create edge with target only (for chain resolution)
            edge.target = matchedId;
            resolvedEdges.push(edge);
          }
        }
        // Drop unresolved imports
      } else {
        resolvedEdges.push(edge);
      }
    }

    // Resolve route edges
    for (const route of allRoutes) {
      // Story 12.17: Handle lazy routes → imports edge
      if (route.method === 'LAZY' && route.handlerName.startsWith('__lazy__')) {
        const importPath = route.handlerName.replace('__lazy__', '');
        const sourceId = generateNodeId(route.file, '__module__', 0);
        resolvedEdges.push({
          source: sourceId,
          target: importPath,
          type: EdgeType.Imports,
          protocol: Protocol.Internal,
          metadata: { sourceFile: route.file, lazy: 'true', routePath: route.path },
          callLine: route.line,
        });
        continue;
      }

      // Story 12.17: Handle loader/action → calls edge
      if (route.method === 'LOADER' || route.method === 'ACTION') {
        const targets = nameToNodes.get(route.handlerName);
        if (targets && targets.length > 0) {
          const sameFile = targets.find(t => t.file === route.file);
          const target = sameFile ?? targets[0];
          const enclosingNode = this.findEnclosingFunction(allNodes, route.file, route.line);
          const sourceId = enclosingNode?.id ?? generateNodeId(route.file, '__module__', 0);
          resolvedEdges.push({
            source: sourceId,
            target: target.id,
            type: EdgeType.Calls,
            protocol: Protocol.Internal,
            metadata: { routeRole: route.method.toLowerCase(), routePath: route.path },
            callLine: route.line,
          });
        }
        continue;
      }

      const handlerNodes = nameToNodes.get(route.handlerName);

      // Prefer handler in the same file (important for GET/POST which appear in many files)
      const handler = handlerNodes
        ? (handlerNodes.find(h => h.file === route.file) ?? handlerNodes[0])
        : null;

      const enclosingNode = this.findEnclosingFunction(allNodes, route.file, route.line);
      let sourceId: string;

      if (enclosingNode) {
        sourceId = enclosingNode.id;
      } else {
        // No enclosing function — create/reuse a router config node from the file
        const routerName = path.basename(route.file, path.extname(route.file));
        sourceId = generateNodeId(route.file, routerName, 0);
        const existing = allNodes.find(n => n.id === sourceId);
        if (!existing) {
          allNodes.push({
            id: sourceId,
            name: routerName,
            type: NodeType.Route,
            language: Language.TypeScript,
            file: route.file,
            line: 0,
            signature: route.file,
            repo: this.repoName,
          });
        }
      }

      // Rename generic handler names (GET, POST, etc.) to include route path
      if (handler) {
        const httpMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
        if (httpMethods.includes(handler.name) && route.path) {
          handler.name = `${handler.name} ${route.path}`;
          handler.signature = `${handler.signature} // ${route.path}`;
        }
      }

      // Use handler ID as target, or component name as symbolic target (viewer creates virtual route node)
      const targetId = handler ? handler.id : route.handlerName;

      resolvedEdges.push({
        source: sourceId,
        target: targetId,
        type: EdgeType.RoutesTo,
        protocol: Protocol.REST,
        metadata: {
          method: route.method,
          path: route.path,
        },
        callLine: route.line,
      });
    }

    return { nodes: allNodes, edges: resolvedEdges, errors };
  }

  private findEnclosingFunction(nodes: GraphNode[], file: string, line: number): GraphNode | null {
    const candidates = nodes
      .filter(n => n.file === file && n.line <= line)
      .sort((a, b) => b.line - a.line);
    return candidates[0] ?? null;
  }

  // ─── Framework Detection ────────────────────────────────

  private detectFramework(): FrameworkInfo {
    const info: FrameworkInfo = { hasNext: false, hasReact: false, hasReactRouter: false, hasRedux: false, hasZustand: false, hasNest: false };

    // Check root package.json
    this.checkPackageJson(path.join(this.rootPath, 'package.json'), info);

    // Monorepo: scan ALL immediate subdirectories for package.json
    // Covers: apps/*, packages/*, nestjs/, frontend/, backend/, etc.
    try {
      const rootEntries = fs.readdirSync(this.rootPath, { withFileTypes: true });
      for (const entry of rootEntries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          this.checkPackageJson(path.join(this.rootPath, entry.name, 'package.json'), info);
          // Also check nested: apps/web/package.json, packages/api/package.json
          try {
            const subEntries = fs.readdirSync(path.join(this.rootPath, entry.name), { withFileTypes: true });
            for (const sub of subEntries) {
              if (sub.isDirectory() && !sub.name.startsWith('.') && sub.name !== 'node_modules') {
                this.checkPackageJson(path.join(this.rootPath, entry.name, sub.name, 'package.json'), info);
              }
            }
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }

    return info;
  }

  private checkPackageJson(pkgPath: string, info: FrameworkInfo): void {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if ('next' in allDeps) info.hasNext = true;
      if ('react' in allDeps || info.hasNext) info.hasReact = true;
      if ('react-router-dom' in allDeps || 'react-router' in allDeps) info.hasReactRouter = true;
      if ('@reduxjs/toolkit' in allDeps) info.hasRedux = true;
      if ('zustand' in allDeps) info.hasZustand = true;
      if ('@nestjs/common' in allDeps || '@nestjs/core' in allDeps) info.hasNest = true;
    } catch { /* file doesn't exist or invalid JSON */ }
  }

  // ─── AST Extraction ─────────────────────────────────────

  private extractFromTree(
    tree: Parser.Tree,
    file: string,
    source: string,
    framework: FrameworkInfo
  ): { nodes: GraphNode[]; edges: GraphEdge[]; routes: RouteRegistration[] } {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const routes: RouteRegistration[] = [];
    const axiosInstances: AxiosInstance[] = [];

    const cursor = tree.walk();

    const visit = (): void => {
      const node = cursor.currentNode;

      // Function declarations: export default function Name() {}
      if (node.type === 'function_declaration') {
        const extracted = this.extractFunction(node, file, source, framework);
        if (extracted) {
          nodes.push(extracted.node);
          edges.push(...extracted.callEdges);
        }
      }

      // Top-level const arrow functions (non-exported): const helperFn = () => {}
      if (node.type === 'lexical_declaration' && node.parent?.type === 'program') {
        // Skip if inside an export_statement (handled by extractExportedDeclaration)
        const declarators = node.descendantsOfType('variable_declarator');
        for (const dec of declarators) {
          const nameNode = dec.childForFieldName('name');
          const valueNode = dec.childForFieldName('value');
          if (!nameNode || !valueNode) continue;

          // Story 12.22: Detect axios.create({ baseURL }) instances
          const axiosInstance = this.extractAxiosCreate(nameNode, valueNode);
          if (axiosInstance) axiosInstances.push(axiosInstance);

          // Story 12.18: Detect API service object literals
          if (valueNode.type === 'object') {
            const objNodes = this.extractObjectMethods(valueNode, nameNode.text, file, framework, axiosInstances);
            nodes.push(...objNodes.nodes);
            edges.push(...objNodes.edges);
            continue;
          }

          // Story 12.21: Redux createSlice
          if (framework.hasRedux) {
            const sliceResult = this.extractReduxSlice(valueNode, nameNode.text, file);
            if (sliceResult) {
              nodes.push(...sliceResult.nodes);
              edges.push(...sliceResult.edges);
              continue;
            }
          }

          // Story 12.21: Zustand create
          if (framework.hasZustand) {
            const zustandResult = this.extractZustandStore(valueNode, nameNode.text, file);
            if (zustandResult) {
              nodes.push(...zustandResult.nodes);
              edges.push(...zustandResult.edges);
              continue;
            }
          }

          const isArrowOrFunc = this.isArrowOrFuncValue(valueNode);
          if (!isArrowOrFunc) continue;

          // Story 12.19: Unwrap memo/forwardRef/HOC to find inner component
          const unwrapped = this.unwrapHOC(valueNode);

          const name = nameNode.text;
          const line = dec.startPosition.row + 1;
          const id = generateNodeId(file, name, line);
          const nodeType = this.determineNodeType(unwrapped ?? valueNode, name, file, framework);
          const params = (unwrapped ?? valueNode).childForFieldName('parameters')?.text ?? '()';
          nodes.push({
            id, name, type: nodeType, language: Language.TypeScript,
            file, line, signature: `const ${name} = ${params} =>`, repo: this.repoName,
          });
          edges.push(...this.extractCallsFromBody(unwrapped ?? valueNode, id, file));
        }
      }

      // Export statements: export const Name = () => ...
      if (node.type === 'export_statement') {
        // Story 12.20: Barrel re-exports: export { X } from './path'
        const reExportEdges = this.extractReExport(node, file);
        if (reExportEdges.length > 0) {
          edges.push(...reExportEdges);
        }

        const extracted = this.extractExportedDeclaration(node, file, source, framework, axiosInstances);
        if (extracted) {
          nodes.push(...extracted.nodes);
          edges.push(...extracted.callEdges);
        }
      }

      // Class declarations: export class X extends React.Component
      if (node.type === 'class_declaration') {
        const extracted = this.extractClass(node, file, source, framework);
        if (extracted) {
          nodes.push(extracted.node);
          edges.push(...extracted.callEdges);
        }
      }

      // Call expressions: fetch(), axios.get() at top-level
      if (node.type === 'call_expression') {
        const apiCall = this.extractApiCall(node, file, axiosInstances);
        if (apiCall) {
          edges.push(apiCall);
        }

        // CJS require('./path') → imports edge
        const requireEdge = this.extractRequire(node, file);
        if (requireEdge) {
          edges.push(requireEdge);
        }

        // Dynamic import(): dynamic(() => import("@/path")), React.lazy(() => import("./path"))
        const dynamicImports = this.extractDynamicImport(node, file);
        edges.push(...dynamicImports);
      }

      // Import declarations
      if (node.type === 'import_statement') {
        const importEdge = this.extractImport(node, file);
        if (importEdge) {
          edges.push(importEdge);
        }
      }

      if (cursor.gotoFirstChild()) {
        do {
          visit();
        } while (cursor.gotoNextSibling());
        cursor.gotoParent();
      }
    };

    visit();

    // Story 12.11-12.13: NestJS extraction
    if (framework.hasNest) {
      this.extractNestJS(source, file, nodes, edges);
    }

    // Story 12.17: React Router extraction (separate pass for full tree context)
    if (framework.hasReactRouter) {
      // JSX routes: walk all <Route> elements from the root
      const jsxRoutes = this.extractAllJsxRoutes(tree.rootNode, file);
      routes.push(...jsxRoutes);
      // Data router routes: createBrowserRouter([...])
      const dataRoutes = this.extractDataRouterRoutes(tree.rootNode, file);
      routes.push(...dataRoutes);
    }

    return { nodes, edges, routes };
  }

  // ─── Function Extraction ────────────────────────────────

  private extractFunction(
    node: Parser.SyntaxNode,
    file: string,
    source: string,
    framework: FrameworkInfo
  ): { node: GraphNode; callEdges: GraphEdge[] } | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = nameNode.text;
    const line = node.startPosition.row + 1;
    const id = generateNodeId(file, name, line);

    // Check if parent is an export_statement
    const isExported = node.parent?.type === 'export_statement';

    const nodeType = this.determineNodeType(node, name, file, framework);
    const displayName = nodeType === NodeType.Handler ? this.enhanceHandlerName(name, file) : name;

    const params = node.childForFieldName('parameters')?.text ?? '()';
    const signature = `function ${name}${params}`;

    const graphNode: GraphNode = {
      id,
      name: displayName,
      type: nodeType,
      language: Language.TypeScript,
      file,
      line,
      signature,
      repo: this.repoName,
    };

    const callEdges = this.extractCallsFromBody(node, id, file);

    return { node: graphNode, callEdges };
  }

  private extractExportedDeclaration(
    node: Parser.SyntaxNode,
    file: string,
    source: string,
    framework: FrameworkInfo,
    axiosInstances: AxiosInstance[] = []
  ): { nodes: GraphNode[]; callEdges: GraphEdge[] } | null {
    const nodes: GraphNode[] = [];
    const callEdges: GraphEdge[] = [];

    // export const Name = () => { ... }
    const declaration = node.childForFieldName('declaration');
    if (!declaration) {
      // Handle: export default Identifier  (no declaration field)
      // Find the identifier and look up the corresponding top-level const/function
      return this.extractExportDefaultIdentifier(node, file, source, framework);
    }

    if (declaration.type === 'lexical_declaration') {
      // const Name = ...
      const declarators = declaration.descendantsOfType('variable_declarator');
      for (const dec of declarators) {
        const nameNode = dec.childForFieldName('name');
        const valueNode = dec.childForFieldName('value');
        if (!nameNode || !valueNode) continue;

        const name = nameNode.text;
        const line = dec.startPosition.row + 1;
        const id = generateNodeId(file, name, line);

        // Story 12.22: Detect axios.create({ baseURL }) instances
        const axiosInstance = this.extractAxiosCreate(nameNode, valueNode);
        if (axiosInstance) axiosInstances.push(axiosInstance);

        // Story 12.18: Object literal API service pattern
        if (valueNode.type === 'object') {
          const objNodes = this.extractObjectMethods(valueNode, name, file, framework, axiosInstances);
          nodes.push(...objNodes.nodes);
          callEdges.push(...objNodes.edges);
          continue;
        }

        // Story 12.21: Redux createSlice
        if (framework.hasRedux) {
          const sliceResult = this.extractReduxSlice(valueNode, name, file);
          if (sliceResult) {
            nodes.push(...sliceResult.nodes);
            callEdges.push(...sliceResult.edges);
            continue;
          }
        }

        // Story 12.21: Zustand create
        if (framework.hasZustand) {
          const zustandResult = this.extractZustandStore(valueNode, name, file);
          if (zustandResult) {
            nodes.push(...zustandResult.nodes);
            callEdges.push(...zustandResult.edges);
            continue;
          }
        }

        const isArrowOrFunc = this.isArrowOrFuncValue(valueNode);
        if (!isArrowOrFunc) continue;

        // Story 12.19: Unwrap memo/forwardRef/HOC
        const unwrapped = this.unwrapHOC(valueNode);

        const nodeType = this.determineNodeType(unwrapped ?? valueNode, name, file, framework);
        const displayName = nodeType === NodeType.Handler ? this.enhanceHandlerName(name, file) : name;

        const params = (unwrapped ?? valueNode).childForFieldName('parameters')?.text ?? '()';
        const signature = `const ${name} = ${params} =>`;

        nodes.push({
          id,
          name: displayName,
          type: nodeType,
          language: Language.TypeScript,
          file,
          line,
          signature,
          repo: this.repoName,
        });

        callEdges.push(...this.extractCallsFromBody(unwrapped ?? valueNode, id, file));
      }
    } else if (declaration.type === 'function_declaration') {
      // export function Name() { ... }
      const result = this.extractFunction(
        // Re-wrap: pass the original node since it IS the export_statement
        declaration, file, source, framework
      );
      // Force export since it came from export_statement
      if (result) {
        nodes.push(result.node);
        callEdges.push(...result.callEdges);
      } else {
        // extractFunction failed because parent != export_statement
        // since declaration.parent === export_statement's child "declaration" field
        const nameNode = declaration.childForFieldName('name');
        if (nameNode) {
          const name = nameNode.text;
          const line = declaration.startPosition.row + 1;
          const id = generateNodeId(file, name, line);
          const nodeType = this.determineNodeType(declaration, name, file, framework);
          const displayName = nodeType === NodeType.Handler ? this.enhanceHandlerName(name, file) : name;
          const params = declaration.childForFieldName('parameters')?.text ?? '()';
          const signature = `function ${name}${params}`;
          nodes.push({
            id, name: displayName, type: nodeType, language: Language.TypeScript,
            file, line, signature, repo: this.repoName,
          });
          callEdges.push(...this.extractCallsFromBody(declaration, id, file));
        }
      }
    } else if (declaration.type === 'class_declaration') {
      const result = this.extractClass(declaration, file, source, framework);
      if (result) {
        nodes.push(result.node);
        callEdges.push(...result.callEdges);
      }
    }

    return nodes.length > 0 ? { nodes, callEdges } : null;
  }

  /**
   * Handle: export default Identifier / export default HOC(Component)
   * Finds the corresponding top-level declaration (const Identifier = () => ...)
   * in the same file and extracts it as a node.
   */
  private extractExportDefaultIdentifier(
    exportNode: Parser.SyntaxNode,
    file: string,
    source: string,
    framework: FrameworkInfo
  ): { nodes: GraphNode[]; callEdges: GraphEdge[] } | null {
    // Check if this is an export default with an identifier
    const isDefault = exportNode.children.some(c => c.type === 'default');
    if (!isDefault) return null;

    // Story 12.19: Handle export default HOC(Component) — e.g. export default withAuth(Dashboard)
    const valueNode = exportNode.childForFieldName('value');
    if (valueNode?.type === 'call_expression' && this.isHOCWrapper(valueNode)) {
      // Find the wrapped component name (the identifier argument to the HOC)
      const args = valueNode.childForFieldName('arguments');
      const wrappedIdent = args?.namedChildren.find((c: Parser.SyntaxNode) => c.type === 'identifier');
      if (wrappedIdent) {
        // Look up the wrapped component in the file
        const root = exportNode.parent;
        if (root) {
          for (const child of root.children) {
            if (child.type === 'function_declaration') {
              const nameNode = child.childForFieldName('name');
              if (nameNode?.text === wrappedIdent.text) {
                // Already handled by extractFunction — the function declaration was extracted separately
                // Just return null so we don't create a duplicate
                return null;
              }
            }
          }
        }
      }
    }

    // Find the exported identifier name
    const identifiers = exportNode.descendantsOfType('identifier');
    let exportedName: string | null = null;
    for (const id of identifiers) {
      if (id.text !== 'default' && id.text !== 'export') {
        exportedName = id.text;
        break;
      }
    }
    if (!exportedName) return null;

    // Search the file root for the corresponding declaration
    const root = exportNode.parent;
    if (!root) return null;

    for (const child of root.children) {
      // const Name = () => ... or const Name = function() ...
      if (child.type === 'lexical_declaration' || child.type === 'variable_declaration') {
        const declarators = child.descendantsOfType('variable_declarator');
        for (const dec of declarators) {
          const nameNode = dec.childForFieldName('name');
          const valueNode = dec.childForFieldName('value');
          if (!nameNode || nameNode.text !== exportedName || !valueNode) continue;

          const isArrowOrFunc = this.isArrowOrFuncValue(valueNode);
          if (!isArrowOrFunc) continue;

          const unwrapped = this.unwrapHOC(valueNode);
          const name = nameNode.text;
          const line = dec.startPosition.row + 1;
          const id = generateNodeId(file, name, line);
          const nodeType = this.determineNodeType(unwrapped ?? valueNode, name, file, framework);
          const params = (unwrapped ?? valueNode).childForFieldName('parameters')?.text ?? '()';
          const signature = `const ${name} = ${params} =>`;

          const nodes: GraphNode[] = [{
            id, name, type: nodeType, language: Language.TypeScript,
            file, line, signature, repo: this.repoName,
          }];
          const callEdges = this.extractCallsFromBody(unwrapped ?? valueNode, id, file);
          return { nodes, callEdges };
        }
      }

      // function Name() { ... } (non-exported, then export default Name)
      if (child.type === 'function_declaration') {
        const nameNode = child.childForFieldName('name');
        if (nameNode && nameNode.text === exportedName) {
          const name = nameNode.text;
          const line = child.startPosition.row + 1;
          const id = generateNodeId(file, name, line);
          const nodeType = this.determineNodeType(child, name, file, framework);
          const params = child.childForFieldName('parameters')?.text ?? '()';
          const signature = `function ${name}${params}`;

          const nodes: GraphNode[] = [{
            id, name, type: nodeType, language: Language.TypeScript,
            file, line, signature, repo: this.repoName,
          }];
          const callEdges = this.extractCallsFromBody(child, id, file);
          return { nodes, callEdges };
        }
      }
    }

    return null;
  }

  private extractClass(
    node: Parser.SyntaxNode,
    file: string,
    _source: string,
    framework: FrameworkInfo
  ): { node: GraphNode; callEdges: GraphEdge[] } | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = nameNode.text;
    const line = node.startPosition.row + 1;
    const id = generateNodeId(file, name, line);

    // Check if it extends React.Component or Component
    const heritageNodes = node.descendantsOfType('class_heritage');
    const heritageText = heritageNodes.length > 0 ? heritageNodes[0]?.text ?? '' : '';
    const isReactClass = heritageText.includes('React.Component') ||
      heritageText.includes('Component');

    const isExported = node.parent?.type === 'export_statement';
    if (!isExported) return null;

    const nodeType = (isReactClass && framework.hasReact) ? NodeType.Component : NodeType.Function;
    const signature = `class ${name}${heritageText ? ` ${heritageText}` : ''}`;

    const graphNode: GraphNode = {
      id,
      name,
      type: nodeType,
      language: Language.TypeScript,
      file,
      line,
      signature,
      repo: this.repoName,
    };

    const callEdges = this.extractCallsFromBody(node, id, file);

    return { node: graphNode, callEdges };
  }

  // ─── Component Detection ────────────────────────────────

  private looksLikeComponent(
    node: Parser.SyntaxNode,
    name: string,
    framework: FrameworkInfo
  ): boolean {
    if (!framework.hasReact) return false;

    // Component names are PascalCase
    if (!/^[A-Z]/.test(name)) return false;

    // Check for JSX in body (direct JSX return)
    const body = node.childForFieldName('body');
    if (body) {
      const hasJsx = body.descendantsOfType('jsx_element').length > 0 ||
        body.descendantsOfType('jsx_self_closing_element').length > 0 ||
        body.descendantsOfType('jsx_fragment').length > 0;
      if (hasJsx) return true;
    }

    // Check for React.FC / React.FunctionComponent type annotation
    // Pattern: export const X: React.FC = () => ...
    const parent = node.parent;
    if (parent) {
      const typeAnnotation = parent.descendantsOfType('type_annotation');
      for (const ta of typeAnnotation) {
        if (ta && (ta.text.includes('React.FC') || ta.text.includes('FunctionComponent') || ta.text.includes('React.Component'))) {
          return true;
        }
      }
    }

    // HOC-wrapped component: withAuth(Dashboard), connect(mapState)(UserProfile)
    // The node itself is the call_expression — no JSX body to check, but PascalCase + HOC wrapper = component
    if (node.type === 'call_expression' && this.isHOCWrapper(node)) {
      return true;
    }

    // File-based heuristic: PascalCase function in .tsx file inside components/ directory
    // These are almost certainly React components even without direct JSX (e.g. using dynamic imports)
    return false;
  }

  private isReactHook(name: string): boolean {
    // React hook: starts with "use" + next char uppercase (useBooking, useAuth, useState)
    return /^use[A-Z]/.test(name);
  }

  private determineNodeType(node: Parser.SyntaxNode, name: string, file: string, framework: FrameworkInfo): NodeType {
    if (this.looksLikeComponent(node, name, framework)) return NodeType.Component;
    if (this.isNextApiHandler(file, name)) return NodeType.Handler;
    if (this.isReactHook(name)) return NodeType.Hook;
    return NodeType.Function;
  }

  /**
   * Normalize path for Next.js routing detection.
   * Strips everything before app/ or pages/ to handle:
   * - src/app/ → app/
   * - apps/web/src/app/ → app/  (monorepo)
   * - apps/backend/app/ → app/  (monorepo)
   * - pages/ → pages/ (no change)
   */
  private normalizePath(file: string): string {
    const f = file.replace(/\\/g, '/');
    // Find the last occurrence of /app/ or leading app/
    const appIdx = f.lastIndexOf('/app/');
    if (appIdx >= 0) return f.substring(appIdx + 1); // strip prefix before /app/
    if (f.startsWith('app/')) return f;
    // Find pages/
    const pagesIdx = f.lastIndexOf('/pages/');
    if (pagesIdx >= 0) return f.substring(pagesIdx + 1);
    if (f.startsWith('pages/')) return f;
    // Fallback: strip src/ prefix
    if (f.startsWith('src/')) return f.substring(4);
    return f;
  }

  /** For App Router handlers named GET/POST/etc, include the route path for clarity */
  private enhanceHandlerName(name: string, file: string): string {
    const httpMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
    if (!httpMethods.includes(name)) return name;

    const nf = this.normalizePath(file);
    const basename = path.basename(nf, path.extname(nf));
    if (basename === 'route' && (nf.startsWith('app/') || nf.startsWith('app\\'))) {
      const routePath = this.filePathToRoute(nf, 'app/');
      return `${name} ${routePath}`;
    }
    return name;
  }

  private isNextApiHandler(file: string, name: string): boolean {
    const f = this.normalizePath(file);
    // Pages Router: pages/api/**
    if (f.includes('pages/api/') || f.includes('pages\\api\\')) return true;

    // App Router: app/**/route.ts — named exports GET, POST, etc.
    const basename = path.basename(f, path.extname(f));
    if (basename === 'route' && (f.startsWith('app/') || f.startsWith('app\\'))) {
      const httpMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
      return httpMethods.includes(name);
    }

    return false;
  }

  // ─── Next.js Route Extraction ───────────────────────────

  private extractNextRoutes(
    tree: Parser.Tree,
    file: string,
    source: string
  ): RouteRegistration[] {
    const routes: RouteRegistration[] = [];

    // Normalize: src/app/ → app/, src/pages/ → pages/
    const nf = this.normalizePath(file);

    // Pages Router: pages/api/[...].ts → route from file path
    if (nf.startsWith('pages/api/') || nf.startsWith('pages\\api\\')) {
      const routePath = this.filePathToRoute(nf, 'pages/');
      const defaultExport = this.findDefaultExportName(tree.rootNode);
      if (defaultExport) {
        routes.push({
          method: 'ANY',
          path: routePath,
          handlerName: defaultExport,
          line: 1,
          file,
        });
      }
    }

    // App Router: app/**/route.ts → route from file path + named exports
    const basename = path.basename(nf, path.extname(nf));
    if (basename === 'route' && (nf.startsWith('app/') || nf.startsWith('app\\'))) {
      const routePath = this.filePathToRoute(nf, 'app/');
      const httpExports = this.findHttpMethodExports(tree.rootNode);
      for (const { name, line } of httpExports) {
        routes.push({
          method: name,
          path: routePath,
          handlerName: `${name} ${routePath}`,
          line,
          file,
        });
      }
    }

    // App Router: app/**/page.tsx → page route (GET)
    if (basename === 'page' && (nf.startsWith('app/') || nf.startsWith('app\\'))) {
      const routePath = this.filePathToRoute(nf, 'app/');
      const defaultExport = this.findDefaultExportName(tree.rootNode);
      if (defaultExport) {
        routes.push({
          method: 'GET',
          path: routePath || '/',
          handlerName: defaultExport,
          line: 1,
          file,
        });
      }
    }

    // App Router: app/**/layout.tsx → layout route
    if (basename === 'layout' && (nf.startsWith('app/') || nf.startsWith('app\\'))) {
      const routePath = this.filePathToRoute(nf, 'app/');
      const defaultExport = this.findDefaultExportName(tree.rootNode);
      if (defaultExport) {
        routes.push({
          method: 'LAYOUT',
          path: routePath || '/',
          handlerName: defaultExport,
          line: 1,
          file,
        });
      }
    }

    // Pages Router: pages/*.tsx (non-api) → page route (GET)
    if (nf.startsWith('pages/') && !nf.startsWith('pages/api/') && !nf.startsWith('pages\\_')) {
      const routePath = this.filePathToRoute(nf, 'pages/');
      const defaultExport = this.findDefaultExportName(tree.rootNode);
      if (defaultExport) {
        routes.push({
          method: 'GET',
          path: routePath || '/',
          handlerName: defaultExport,
          line: 1,
          file,
        });
      }
    }

    return routes;
  }

  /**
   * Extract routes from config object pattern: { path: '/...', component: ComponentName }
   * Supports React Router v5 config objects and similar declarative route configs.
   */
  /**
   * Extract React.lazy declarations as Component nodes.
   * Pattern: const ComponentName = React.lazy(() => import('./Path'))
   */
  private extractLazyComponents(source: string, file: string, nodes: GraphNode[], edges: GraphEdge[]): void {
    const lazyRe = /(?:const|let|var)\s+(\w+)\s*=\s*React\.lazy\s*\(\s*\(\)\s*=>\s*import\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\)/g;
    const existingNames = new Set(nodes.map(n => n.name));
    let match;
    while ((match = lazyRe.exec(source)) !== null) {
      const name = match[1];
      const importPath = match[2];
      if (existingNames.has(name)) continue;
      const line = source.substring(0, match.index).split('\n').length;
      const nodeId = generateNodeId(file, name, line);
      nodes.push({
        id: nodeId,
        name,
        type: NodeType.Component,
        language: Language.TypeScript,
        file,
        line,
        signature: `React.lazy(() => import('${importPath}'))`,
        repo: this.repoName,
      });
      existingNames.add(name);

      // Create import edge from lazy component → actual component file
      // Resolve relative import path to find the default export node
      const dir = path.dirname(file);
      let resolvedPath = path.join(dir, importPath).replace(/\\/g, '/');
      // Try common extensions and index patterns
      const candidates = [
        resolvedPath,
        resolvedPath + '/index',
        resolvedPath + '.js',
        resolvedPath + '.tsx',
        resolvedPath + '.ts',
        resolvedPath + '.jsx',
      ];
      for (const candidate of candidates) {
        const normalizedCandidate = candidate.replace(/\\/g, '/');
        // Find a node whose file matches this path
        const targetNode = nodes.find(n =>
          n.file.replace(/\\/g, '/').replace(/\.(js|jsx|ts|tsx)$/, '').replace(/\/index$/, '') ===
          normalizedCandidate.replace(/\.(js|jsx|ts|tsx)$/, '').replace(/\/index$/, '')
        );
        if (targetNode) {
          edges.push({
            source: nodeId,
            target: targetNode.id,
            type: EdgeType.Imports,
            protocol: Protocol.Internal,
            metadata: { lazy: 'true' },
          });
          break;
        }
      }
    }
  }

  /** Link React.lazy component nodes to their actual default-export component nodes */
  private resolveLazyImports(nodes: GraphNode[], edges: GraphEdge[]): void {
    const lazyNodes = nodes.filter(n => n.signature.startsWith('React.lazy'));
    if (lazyNodes.length === 0) return;

    for (const lazyNode of lazyNodes) {
      // Extract import path from signature: React.lazy(() => import('./SeatmapList'))
      const importMatch = lazyNode.signature.match(/import\('([^']+)'\)/);
      if (!importMatch) continue;

      const importPath = importMatch[1];
      const dir = path.dirname(lazyNode.file);
      const resolvedBase = path.join(dir, importPath).replace(/\\/g, '/');

      // Find a node in the target file (default export component)
      const targetNode = nodes.find(n => {
        if (n.id === lazyNode.id) return false;
        const nFile = n.file.replace(/\\/g, '/').replace(/\.(js|jsx|ts|tsx)$/, '').replace(/\/index$/, '');
        const rBase = resolvedBase.replace(/\.(js|jsx|ts|tsx)$/, '').replace(/\/index$/, '');
        return nFile === rBase && (n.type === 'component' || n.type === 'function');
      });

      if (targetNode) {
        // Use Calls type (not Imports) because target is already a resolved node ID
        // Imports edges go through file-path resolution which would drop this
        edges.push({
          source: lazyNode.id,
          target: targetNode.id,
          type: EdgeType.Calls,
          protocol: Protocol.Internal,
          metadata: { lazy: 'true' },
        });
      }
    }
  }

  private extractRouteConfigObjects(source: string, file: string): RouteRegistration[] {
    const routes: RouteRegistration[] = [];

    // Extract individual object blocks that contain both path: and component:
    // This handles multi-line configs and any property order
    const blockRe = /\{[^{}]*?\bpath:\s*['"]([^'"]+)['"][^{}]*?\bcomponent:\s*(\w+)[^{}]*?\}/gs;
    let match;
    while ((match = blockRe.exec(source)) !== null) {
      routes.push({
        method: 'ANY',
        path: match[1],
        handlerName: match[2],
        line: source.substring(0, match.index).split('\n').length,
        file,
      });
    }

    // Also handle reverse order: component before path
    const blockRe2 = /\{[^{}]*?\bcomponent:\s*(\w+)[^{}]*?\bpath:\s*['"]([^'"]+)['"][^{}]*?\}/gs;
    while ((match = blockRe2.exec(source)) !== null) {
      // Avoid duplicates
      if (!routes.some(r => r.path === match[2])) {
        routes.push({
          method: 'ANY',
          path: match[2],
          handlerName: match[1],
          line: source.substring(0, match.index).split('\n').length,
          file,
        });
      }
    }

    return routes;
  }

  /**
   * Extract Express/Fastify/Hono/Koa/Gaman-like route registrations.
   * Matches patterns like:
   *   app.get('/path', handler)
   *   router.post('/path', (req, res) => { ... })
   *   r.get('/path', [Controller, 'method'])
   *   r.group('prefix', (v1) => { v1.get('/nested', handler) })
   */
  private extractExpressLikeRoutes(source: string, file: string): RouteRegistration[] {
    const routes: RouteRegistration[] = [];
    const httpMethods = 'get|post|put|delete|patch|head|options|all';

    // Step 1: Detect route groups and collect prefix mappings
    // Pattern: variable.group('prefix', (paramName) => { ... })
    const groupRe = /\b(\w+)\.group\s*\(\s*['"]([^'"]+)['"]\s*,\s*\((\w+)\)/g;
    const groupPrefixMap = new Map<string, string>(); // paramName → prefix
    let groupMatch;
    while ((groupMatch = groupRe.exec(source)) !== null) {
      const prefix = groupMatch[2];
      const paramName = groupMatch[3];
      groupPrefixMap.set(paramName, '/' + prefix.replace(/^\//, ''));
    }

    // Step 2: Extract basic routes: variable.METHOD('/path', handler)
    const routeRe = new RegExp(
      `\\b(\\w+)\\.(${httpMethods})\\s*\\(\\s*['\"]([^'\"]+)['\"]`,
      'g'
    );
    // Skip: HTTP client libraries (API calls) and non-router objects
    const skipVariables = new Set([
      'axios', 'http', 'https', 'request', 'superagent', 'ky', 'got', 'fetch',  // HTTP clients
      'ctx', 'context', 'req', 'res', 'response', 'headers', 'params', 'query',  // Request objects
      'env', 'process', 'config', 'this', 'self', 'map', 'set', 'storage',       // Non-route objects
      'cache', 'store', 'session', 'cookie', 'localStorage', 'sessionStorage',
      'console', 'document', 'window', 'JSON', 'Object', 'Array', 'Math',
    ]);

    let match;
    while ((match = routeRe.exec(source)) !== null) {
      const variable = match[1];
      if (skipVariables.has(variable)) continue;

      const method = match[2].toUpperCase();
      let routePath = match[3];

      // Only match actual route paths (must start with / or be a relative path)
      if (!routePath.startsWith('/')) continue;
      const line = source.substring(0, match.index).split('\n').length;

      // Check if the variable is a group parameter — prepend group prefix
      const groupPrefix = groupPrefixMap.get(variable);
      if (groupPrefix) {
        routePath = groupPrefix + (routePath === '/' ? '' : routePath);
        if (!routePath) routePath = '/';
      }

      // Extract handler name from what follows the path string
      const afterPath = source.substring(match.index + match[0].length);

      // Try to extract handler info: [Controller, 'method'], named function, or anonymous
      let handlerName = 'anonymous';
      // Pattern: , [Controller, 'method']
      const controllerArrayMatch = afterPath.match(/^['"]\s*,\s*\[\s*(\w+)\s*,\s*['"](\w+)['"]\s*\]/);
      if (controllerArrayMatch) {
        handlerName = `${controllerArrayMatch[1]}.${controllerArrayMatch[2]}`;
      } else {
        // Pattern: , handlerName) or , handlerName,
        const namedHandlerMatch = afterPath.match(/^['"]\s*,\s*(?:\[.*?\]\s*,\s*)?(\w+(?:\.\w+)?)\s*[,)]/);
        if (namedHandlerMatch && !/^(?:async|function|\()/.test(namedHandlerMatch[1])) {
          handlerName = namedHandlerMatch[1];
        }
      }

      routes.push({ method, path: routePath, handlerName, line, file });
    }

    return routes;
  }

  private filePathToRoute(file: string, prefix: string): string {
    // Remove prefix and extension
    let route = file;
    const prefixIdx = route.indexOf(prefix);
    if (prefixIdx >= 0) {
      route = route.substring(prefixIdx + prefix.length);
    }

    // Remove file extension
    route = route.replace(/\.(ts|tsx|js|jsx)$/, '');

    // Remove /route suffix (App Router API)
    route = route.replace(/\/route$/, '');

    // Remove /page or standalone page suffix (App Router pages)
    route = route.replace(/\/page$/, '');
    if (route === 'page') route = '';

    // Remove /layout or standalone layout suffix (App Router layouts)
    route = route.replace(/\/layout$/, '');
    if (route === 'layout') route = '';

    // Remove /index suffix
    route = route.replace(/\/index$/, '');

    // Convert dynamic segments
    // [[...slug]] → :slug? (optional catch-all)
    route = route.replace(/\[\[\.\.\.(\w+)]]/g, ':$1?');
    // [...slug] → *slug (catch-all)
    route = route.replace(/\[\.\.\.(\w+)]/g, '*$1');
    // [id] → :id (dynamic segment)
    route = route.replace(/\[(\w+)]/g, ':$1');
    // Remove route groups: (group) → nothing (both /(...) and leading (...))
    route = route.replace(/\/?\([^)]+\)/g, '');

    // Clean up: remove leading slashes, then double slashes
    route = route.replace(/^\/+/, '');
    route = route.replace(/\/\//g, '/');

    return '/' + route;
  }

  private findDefaultExportName(root: Parser.SyntaxNode): string | null {
    const exports = root.descendantsOfType('export_statement');
    for (const exp of exports) {
      // export default function Name()
      if (exp.text.includes('default')) {
        const funcDecl = exp.descendantsOfType('function_declaration')[0];
        if (funcDecl) {
          return funcDecl.childForFieldName('name')?.text ?? null;
        }
        // export default Name (identifier)
        const identifier = exp.descendantsOfType('identifier');
        for (const id of identifier) {
          if (id.text !== 'default' && id.text !== 'export') return id.text;
        }
      }
    }
    return null;
  }

  private findHttpMethodExports(root: Parser.SyntaxNode): { name: string; line: number }[] {
    const httpMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
    const results: { name: string; line: number }[] = [];

    const exports = root.descendantsOfType('export_statement');
    for (const exp of exports) {
      // export function GET() or export async function GET()
      const funcDecl = exp.descendantsOfType('function_declaration')[0];
      if (funcDecl) {
        const name = funcDecl.childForFieldName('name')?.text;
        if (name && httpMethods.includes(name)) {
          results.push({ name, line: funcDecl.startPosition.row + 1 });
        }
      }
    }

    return results;
  }

  // ─── API Call Extraction (fetch/axios) ──────────────────
  // Spec 1.1: Only extract string-literal URLs. Skip dynamic/template literal args.

  private extractApiCall(node: Parser.SyntaxNode, file: string, axiosInstances: AxiosInstance[] = []): GraphEdge | null {
    const funcRef = node.childForFieldName('function');
    if (!funcRef) return null;

    const args = node.childForFieldName('arguments');
    if (!args) return null;
    const firstArg = args.namedChildren[0];
    if (!firstArg) return null;

    // fetch('/api/path') — only string literal URLs
    if (funcRef.type === 'identifier' && funcRef.text === 'fetch') {
      if (firstArg.type !== 'string' && firstArg.type !== 'string_fragment') return null;
      const url = this.extractStringLiteral(firstArg);
      if (!url) return null;

      let method = 'GET';
      const optionsArg = args.namedChildren[1];
      if (optionsArg?.type === 'object') {
        const methodProp = this.findObjectProperty(optionsArg, 'method');
        if (methodProp) method = methodProp.toUpperCase();
      }

      return this.buildApiEdge(node, file, method, url);
    }

    // axios.get('/api/path'), axios.post('/api/path', data) — only string literal URLs
    if (funcRef.type === 'member_expression') {
      const obj = funcRef.childForFieldName('object');
      const prop = funcRef.childForFieldName('property');
      if (!obj || !prop) return null;

      const methodMap: Record<string, string> = {
        get: 'GET', post: 'POST', put: 'PUT', delete: 'DELETE', patch: 'PATCH',
      };
      const method = methodMap[prop.text];
      if (!method) return null;

      // Only string literal first arg
      if (firstArg.type !== 'string' && firstArg.type !== 'string_fragment') return null;
      const url = this.extractStringLiteral(firstArg);
      if (!url) return null;

      // Accept axios.verb() directly
      if (obj.type === 'identifier' && obj.text === 'axios') {
        return this.buildApiEdge(node, file, method, url);
      }

      // Story 12.22: Check for axios.create instances with baseURL composition
      if (obj.type === 'identifier') {
        const axiosInst = axiosInstances.find(a => a.variableName === obj.text);
        if (axiosInst) {
          const composedUrl = this.composeBaseURL(axiosInst.baseURL, url);
          return this.buildApiEdge(node, file, method, composedUrl);
        }

        // Accept known HTTP client patterns: apiClient.get(), tkbClient.post(), etc.
        const httpClientPattern = /axios|client|api|fetcher|http|request/i;
        if (httpClientPattern.test(obj.text)) {
          return this.buildApiEdge(node, file, method, url, `[${obj.text}] `);
        }
      }
    }

    return null;
  }

  /**
   * Build a REST API edge with common boilerplate.
   * Uses enclosing function's declaration line (not call-site line) for source ID.
   */
  private buildApiEdge(
    node: Parser.SyntaxNode,
    file: string,
    method: string,
    url: string,
    prefix = ''
  ): GraphEdge {
    const enclosing = this.findEnclosingFuncInfo(node);
    const sourceId = enclosing
      ? generateNodeId(file, enclosing.name, enclosing.line)
      : generateNodeId(file, '__module__', 0);

    const displayPath = `${prefix}${url}`;

    return {
      source: sourceId,
      target: displayPath,
      type: EdgeType.Calls,
      protocol: Protocol.REST,
      metadata: { method, path: displayPath },
      callLine: node.startPosition.row + 1,
    };
  }

  // ─── Import Extraction ──────────────────────────────────

  private extractImport(node: Parser.SyntaxNode, file: string): GraphEdge | null {
    const sourceNode = node.childForFieldName('source');
    if (!sourceNode) return null;

    const importPath = this.extractStringLiteral(sourceNode);
    if (!importPath) return null;

    // Skip external packages (no ./ or ../ or @/ prefix)
    if (!importPath.startsWith('.') && !importPath.startsWith('/') && !importPath.startsWith('@/')) return null;

    const sourceId = generateNodeId(file, '__module__', 0);

    return {
      source: sourceId,
      target: importPath, // resolved later via file-path matching
      type: EdgeType.Imports,
      protocol: Protocol.Internal,
      metadata: { sourceFile: file },
      callLine: node.startPosition.row + 1,
    };
  }

  /**
   * Extract CJS require('./path') → imports edge
   */
  private extractRequire(node: Parser.SyntaxNode, file: string): GraphEdge | null {
    const funcRef = node.childForFieldName('function');
    if (!funcRef || funcRef.type !== 'identifier' || funcRef.text !== 'require') return null;

    const args = node.childForFieldName('arguments');
    if (!args) return null;
    const firstArg = args.namedChildren[0];
    if (!firstArg) return null;

    const requirePath = this.extractStringLiteral(firstArg);
    if (!requirePath) return null;

    // Skip external packages
    if (!requirePath.startsWith('.') && !requirePath.startsWith('/') && !requirePath.startsWith('@/')) return null;

    const sourceId = generateNodeId(file, '__module__', 0);

    return {
      source: sourceId,
      target: requirePath,
      type: EdgeType.Imports,
      protocol: Protocol.Internal,
      metadata: { sourceFile: file },
      callLine: node.startPosition.row + 1,
    };
  }

  /**
   * Extract dynamic import() expressions:
   *   dynamic(() => import("@/components/X"))
   *   React.lazy(() => import("./X"))
   *   import("./X")
   */
  private extractDynamicImport(node: Parser.SyntaxNode, file: string): GraphEdge[] {
    const edges: GraphEdge[] = [];

    // Find all call_expression nodes that are dynamic import() calls
    // In tree-sitter, import("path") has first child of type 'import' (not 'function' field)
    const allCalls = node.descendantsOfType('call_expression');
    for (const call of allCalls) {
      // Check if first child is the 'import' keyword
      const firstChild = call.firstChild;
      if (!firstChild || firstChild.type !== 'import') continue;

      const args = call.childForFieldName('arguments');
      if (!args) continue;
      const firstArg = args.namedChildren[0];
      if (!firstArg) continue;

      const importPath = this.extractStringLiteral(firstArg);
      if (!importPath) continue;

      // Skip external packages
      if (!importPath.startsWith('.') && !importPath.startsWith('/') && !importPath.startsWith('@/')) continue;

      const sourceId = generateNodeId(file, '__module__', 0);
      edges.push({
        source: sourceId,
        target: importPath,
        type: EdgeType.Imports,
        protocol: Protocol.Internal,
        metadata: { sourceFile: file },
        callLine: call.startPosition.row + 1,
      });
    }

    return edges;
  }

  // ─── Call Extraction from Function Bodies ────────────────

  private extractCallsFromBody(funcNode: Parser.SyntaxNode, sourceId: string, file: string, _axiosInstances: AxiosInstance[] = []): GraphEdge[] {
    const edges: GraphEdge[] = [];
    const body = funcNode.childForFieldName('body');
    if (!body) return edges;

    const callExpressions = body.descendantsOfType('call_expression');
    const seenTargets = new Set<string>();

    for (const callExpr of callExpressions) {
      // Skip fetch/axios — handled separately as API calls
      const funcRef = callExpr.childForFieldName('function');
      if (!funcRef) continue;

      let targetName = '';
      if (funcRef.type === 'identifier') {
        if (funcRef.text === 'fetch' || funcRef.text === 'require') continue;
        targetName = funcRef.text;
      } else if (funcRef.type === 'member_expression') {
        const obj = funcRef.childForFieldName('object');
        const prop = funcRef.childForFieldName('property');
        if (obj?.text === 'axios') continue;
        if (prop) targetName = prop.text;
      }

      if (targetName && !seenTargets.has(targetName)) {
        seenTargets.add(targetName);
        edges.push({
          source: sourceId,
          target: targetName,
          type: EdgeType.Calls,
          protocol: Protocol.Internal,
          callLine: callExpr.startPosition.row + 1,
        });
      }
    }

    return edges;
  }

  // ─── Story 12.19: HOC/memo/forwardRef Detection ─────────

  /**
   * Check if a value node is a function (arrow, function expression)
   * OR a call_expression wrapping one (memo, forwardRef, HOC).
   */
  private isArrowOrFuncValue(valueNode: Parser.SyntaxNode): boolean {
    if (valueNode.type === 'arrow_function' ||
        valueNode.type === 'function_expression' ||
        valueNode.type === 'function') return true;
    // call_expression wrapping: memo(() => ...), forwardRef((props, ref) => ...),
    // withAuth(Dashboard), connect(mapState)(UserProfile)
    if (valueNode.type === 'call_expression') {
      return this.isHOCWrapper(valueNode);
    }
    return false;
  }

  /**
   * Check if a call_expression is a known HOC/wrapper pattern.
   */
  private isHOCWrapper(node: Parser.SyntaxNode): boolean {
    if (node.type !== 'call_expression') return false;
    const funcRef = node.childForFieldName('function');
    if (!funcRef) return false;

    if (funcRef.type === 'identifier') {
      return this.isWrapperName(funcRef.text);
    }
    if (funcRef.type === 'member_expression') {
      return this.isWrapperName(funcRef.text);
    }
    // Chained HOC: connect(mapState)(Component) — funcRef is itself a call_expression
    if (funcRef.type === 'call_expression') {
      return this.isHOCWrapper(funcRef);
    }
    return false;
  }

  private isWrapperName(name: string): boolean {
    return /^(memo|forwardRef|React\.memo|React\.forwardRef)$/.test(name) ||
      /^(with[A-Z]|connect|styled)/.test(name);
  }

  /**
   * Unwrap HOC/memo/forwardRef to find the inner function.
   * Returns the inner arrow/function node, or null if the argument is an identifier
   * (e.g. withAuth(Dashboard) — the wrapping is detected but there's no inner function to unwrap).
   */
  private unwrapHOC(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    if (node.type !== 'call_expression') return null;
    if (!this.isHOCWrapper(node)) return null;

    const args = node.childForFieldName('arguments');
    if (!args) return null;

    // Find the inner function argument
    for (const arg of args.namedChildren) {
      if (arg.type === 'arrow_function' || arg.type === 'function_expression' ||
          arg.type === 'function_declaration' || arg.type === 'function') {
        return arg;
      }
    }

    // Identifier argument: withAuth(Dashboard) — no inner function to unwrap
    // The variable name (const X = withAuth(Dashboard)) becomes the node name
    return null;
  }

  // ─── Story 12.17: React Router Extraction ──────────────

  /**
   * Walk the full AST to find all top-level <Route> elements and extract routes recursively.
   */
  private extractAllJsxRoutes(root: Parser.SyntaxNode, file: string): RouteRegistration[] {
    const routes: RouteRegistration[] = [];

    // Find all JSX elements that are <Route> — but only process top-level ones
    // (nested ones are handled by recursive extractJsxRoutes)
    const allElements = [
      ...root.descendantsOfType('jsx_element'),
      ...root.descendantsOfType('jsx_self_closing_element'),
    ];

    for (const el of allElements) {
      const tagName = this.getJsxTagName(el);
      if (tagName !== 'Route') continue;

      // Skip if parent is also a <Route> (will be handled recursively)
      const parent = el.parent;
      if (parent) {
        const parentTag = parent.type === 'jsx_element' ? this.getJsxTagName(parent) : '';
        if (parentTag === 'Route') continue;
      }

      routes.push(...this.extractJsxRoutes(el, file, ''));
    }

    return routes;
  }

  /**
   * Extract JSX <Route> elements recursively.
   * parentPath is accumulated for nested routes.
   */
  private extractJsxRoutes(node: Parser.SyntaxNode, file: string, parentPath: string): RouteRegistration[] {
    const routes: RouteRegistration[] = [];
    const tagName = this.getJsxTagName(node);
    if (tagName !== 'Route') return routes;

    // Extract path and element props
    const pathProp = this.getJsxAttribute(node, 'path');
    const elementProp = this.getJsxAttribute(node, 'element');

    if (pathProp) {
      const fullPath = this.composeRoutePath(parentPath, pathProp);

      if (elementProp) {
        // Extract component name from element={<ComponentName />}
        const componentName = this.extractComponentFromJsx(elementProp);
        if (componentName) {
          routes.push({
            method: 'GET',
            path: fullPath,
            handlerName: componentName,
            line: node.startPosition.row + 1,
            file,
          });
        }
      }

      // Recurse into children for nested routes
      const children = this.getJsxChildren(node);
      for (const child of children) {
        routes.push(...this.extractJsxRoutes(child, file, fullPath));
      }
    }

    return routes;
  }

  private getJsxTagName(node: Parser.SyntaxNode): string {
    if (node.type === 'jsx_self_closing_element') {
      const nameNode = node.childForFieldName('name');
      return nameNode?.text ?? '';
    }
    if (node.type === 'jsx_element') {
      const openTag = node.children.find(c => c.type === 'jsx_opening_element');
      const nameNode = openTag?.childForFieldName('name');
      return nameNode?.text ?? '';
    }
    return '';
  }

  private getJsxAttribute(node: Parser.SyntaxNode, attrName: string): string | null {
    // Get direct attributes: for self-closing elements they're on the node itself,
    // for jsx_element they're on the jsx_opening_element child
    let attrParent = node;
    if (node.type === 'jsx_element') {
      const openTag = node.children.find(c => c.type === 'jsx_opening_element');
      if (openTag) attrParent = openTag;
    }

    for (const child of attrParent.children) {
      if (child.type !== 'jsx_attribute') continue;

      // First child is property_identifier (attribute name)
      const nameNode = child.children.find(c => c.type === 'property_identifier');
      if (!nameNode || nameNode.text !== attrName) continue;

      // Value can be string or jsx_expression
      const valueNode = child.children.find(c => c.type === 'string' || c.type === 'jsx_expression');
      if (valueNode?.type === 'string') {
        return this.extractStringLiteral(valueNode);
      }
      if (valueNode?.type === 'jsx_expression') {
        return valueNode.text; // e.g., {<ComponentName />}
      }
    }
    return null;
  }

  private extractComponentFromJsx(elementText: string): string | null {
    // Extract component name from JSX expression like {<UserList />} or {<Dashboard />}
    const match = elementText.match(/<(\w+)/);
    return match ? match[1] : null;
  }

  private getJsxChildren(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
    const children: Parser.SyntaxNode[] = [];
    // For jsx_element, direct children are between opening and closing tags
    for (const child of node.children) {
      if (child.type === 'jsx_element' || child.type === 'jsx_self_closing_element') {
        children.push(child);
      }
    }
    return children;
  }

  private composeRoutePath(parent: string, child: string): string {
    if (child.startsWith('/')) return child;
    const base = parent.endsWith('/') ? parent : parent + '/';
    return base + child;
  }

  /**
   * Extract routes from createBrowserRouter([...]) data router config.
   */
  private extractDataRouterRoutes(root: Parser.SyntaxNode, file: string): RouteRegistration[] {
    const routes: RouteRegistration[] = [];
    const calls = root.descendantsOfType('call_expression');

    for (const call of calls) {
      const funcRef = call.childForFieldName('function');
      if (!funcRef) continue;
      if (funcRef.text !== 'createBrowserRouter' && funcRef.text !== 'createHashRouter' && funcRef.text !== 'createMemoryRouter') continue;

      const args = call.childForFieldName('arguments');
      if (!args) continue;
      const arrayArg = args.namedChildren.find(c => c.type === 'array');
      if (!arrayArg) continue;

      this.parseRouteArray(arrayArg, file, '', routes);
    }

    return routes;
  }

  private parseRouteArray(arrayNode: Parser.SyntaxNode, file: string, parentPath: string, routes: RouteRegistration[]): void {
    const objects = arrayNode.namedChildren.filter(c => c.type === 'object');
    for (const obj of objects) {
      this.parseRouteObject(obj, file, parentPath, routes);
    }
  }

  private parseRouteObject(obj: Parser.SyntaxNode, file: string, parentPath: string, routes: RouteRegistration[]): void {
    const pathValue = this.findObjectProperty(obj, 'path');
    const fullPath = pathValue ? this.composeRoutePath(parentPath, pathValue) : parentPath;

    // Extract element → component name
    const elementPair = obj.descendantsOfType('pair').find(p => p.childForFieldName('key')?.text === 'element');
    if (elementPair) {
      const value = elementPair.childForFieldName('value');
      if (value) {
        const componentName = this.extractComponentFromJsx(value.text);
        if (componentName && pathValue) {
          routes.push({
            method: 'GET',
            path: fullPath,
            handlerName: componentName,
            line: obj.startPosition.row + 1,
            file,
          });
        }
      }
    }

    // Extract loader → calls edge (stored as route for resolution)
    const loaderPair = obj.descendantsOfType('pair').find(p => p.childForFieldName('key')?.text === 'loader');
    if (loaderPair && pathValue) {
      const loaderValue = loaderPair.childForFieldName('value');
      if (loaderValue?.type === 'identifier') {
        routes.push({
          method: 'LOADER',
          path: fullPath,
          handlerName: loaderValue.text,
          line: loaderPair.startPosition.row + 1,
          file,
        });
      }
    }

    // Extract action → calls edge
    const actionPair = obj.descendantsOfType('pair').find(p => p.childForFieldName('key')?.text === 'action');
    if (actionPair && pathValue) {
      const actionValue = actionPair.childForFieldName('value');
      if (actionValue?.type === 'identifier') {
        routes.push({
          method: 'ACTION',
          path: fullPath,
          handlerName: actionValue.text,
          line: actionPair.startPosition.row + 1,
          file,
        });
      }
    }

    // Extract lazy → imports edge
    const lazyPair = obj.descendantsOfType('pair').find(p => p.childForFieldName('key')?.text === 'lazy');
    if (lazyPair && pathValue) {
      // lazy: () => import('./pages/Settings')
      const dynamicImports = lazyPair.descendantsOfType('call_expression');
      for (const di of dynamicImports) {
        const firstChild = di.firstChild;
        if (firstChild?.type === 'import') {
          const diArgs = di.childForFieldName('arguments');
          const firstArg = diArgs?.namedChildren[0];
          if (firstArg) {
            const importPath = this.extractStringLiteral(firstArg);
            if (importPath) {
              routes.push({
                method: 'LAZY',
                path: fullPath,
                handlerName: `__lazy__${importPath}`,
                line: lazyPair.startPosition.row + 1,
                file,
              });
            }
          }
        }
      }
    }

    // Recurse into children array
    const childrenPair = obj.descendantsOfType('pair').find(p => p.childForFieldName('key')?.text === 'children');
    if (childrenPair) {
      const childrenArray = childrenPair.childForFieldName('value');
      if (childrenArray?.type === 'array') {
        this.parseRouteArray(childrenArray, file, fullPath, routes);
      }
    }
  }

  // ─── Story 12.18: API Service Object Extraction ────────

  /**
   * Extract methods from object literal: const api = { getUsers: () => fetch(...) }
   */
  private extractObjectMethods(
    objNode: Parser.SyntaxNode,
    objectName: string,
    file: string,
    framework: FrameworkInfo,
    axiosInstances: AxiosInstance[] = []
  ): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    const pairs = objNode.children.filter(c => c.type === 'pair');
    let hasAnyMethod = false;

    for (const pair of pairs) {
      const key = pair.childForFieldName('key');
      const value = pair.childForFieldName('value');
      if (!key || !value) continue;

      const isFunc = value.type === 'arrow_function' || value.type === 'function_expression' || value.type === 'function';
      if (!isFunc) continue;
      hasAnyMethod = true;

      const methodName = key.text;
      const line = pair.startPosition.row + 1;
      const fullName = `${objectName}.${methodName}`;
      const id = generateNodeId(file, fullName, line);
      const params = value.childForFieldName('parameters')?.text ?? '()';

      nodes.push({
        id,
        name: fullName,
        type: NodeType.Function,
        language: Language.TypeScript,
        file,
        line,
        signature: `${methodName}: ${params} =>`,
        repo: this.repoName,
      });

      // Extract API calls within the method body, attributing to this method node
      const body = value.childForFieldName('body');
      if (body) {
        const callExprs = body.descendantsOfType('call_expression');
        for (const callExpr of callExprs) {
          const apiEdge = this.extractApiCall(callExpr, file, axiosInstances);
          if (apiEdge) {
            apiEdge.source = id; // Re-attribute to method node
            edges.push(apiEdge);
          }
        }
      }

      // Also extract internal function calls
      edges.push(...this.extractCallsFromBody(value, id, file));
    }

    if (!hasAnyMethod) return { nodes: [], edges: [] };
    return { nodes, edges };
  }

  // ─── Story 12.20: Barrel Re-exports ────────────────────

  /**
   * Extract re-export edges: export { X } from './path', export * from './path'
   */
  private extractReExport(node: Parser.SyntaxNode, file: string): GraphEdge[] {
    const edges: GraphEdge[] = [];

    // Check for source (from clause)
    const sourceNode = node.childForFieldName('source');
    if (!sourceNode) return edges;

    const importPath = this.extractStringLiteral(sourceNode);
    if (!importPath) return edges;

    // Skip external packages
    if (!importPath.startsWith('.') && !importPath.startsWith('/') && !importPath.startsWith('@/')) return edges;

    const sourceId = generateNodeId(file, '__module__', 0);

    // export { X, Y } from './path'  OR  export * from './path'  OR  export { default as X } from './path'
    edges.push({
      source: sourceId,
      target: importPath,
      type: EdgeType.Imports,
      protocol: Protocol.Internal,
      metadata: { sourceFile: file },
      callLine: node.startPosition.row + 1,
    });

    return edges;
  }

  // ─── Story 12.21: Redux/Zustand Extraction ─────────────

  /**
   * Extract Redux createSlice → Service node + Function sub-nodes for reducers
   */
  private extractReduxSlice(
    valueNode: Parser.SyntaxNode,
    varName: string,
    file: string
  ): { nodes: GraphNode[]; edges: GraphEdge[] } | null {
    if (valueNode.type !== 'call_expression') return null;
    const funcRef = valueNode.childForFieldName('function');
    if (!funcRef || funcRef.text !== 'createSlice') return null;

    const args = valueNode.childForFieldName('arguments');
    if (!args) return null;
    const configObj = args.namedChildren.find(c => c.type === 'object');
    if (!configObj) return null;

    const sliceName = this.findObjectProperty(configObj, 'name') ?? varName;
    const line = valueNode.startPosition.row + 1;
    const sliceId = generateNodeId(file, sliceName, line);

    const nodes: GraphNode[] = [{
      id: sliceId,
      name: sliceName,
      type: NodeType.Service,
      language: Language.TypeScript,
      file,
      line,
      signature: `createSlice({ name: '${sliceName}' })`,
      repo: this.repoName,
      metadata: { framework: 'redux' },
    }];

    const edges: GraphEdge[] = [];

    // Extract reducers
    const reducersPair = configObj.descendantsOfType('pair').find(p => p.childForFieldName('key')?.text === 'reducers');
    if (reducersPair) {
      const reducersObj = reducersPair.childForFieldName('value');
      if (reducersObj?.type === 'object') {
        const pairs = reducersObj.children.filter(c => c.type === 'pair');
        for (const pair of pairs) {
          const key = pair.childForFieldName('key');
          const value = pair.childForFieldName('value');
          if (!key || !value) continue;

          const reducerName = key.text;
          const rLine = pair.startPosition.row + 1;
          const reducerId = generateNodeId(file, `${sliceName}.${reducerName}`, rLine);

          nodes.push({
            id: reducerId,
            name: `${sliceName}.${reducerName}`,
            type: NodeType.Function,
            language: Language.TypeScript,
            file,
            line: rLine,
            signature: `${reducerName}: (state, action) =>`,
            repo: this.repoName,
            metadata: { framework: 'redux', parentSlice: sliceName },
          });

          // Edge from slice → reducer
          edges.push({
            source: sliceId,
            target: reducerId,
            type: EdgeType.Calls,
            protocol: Protocol.Internal,
            callLine: rLine,
          });
        }
      }
    }

    return { nodes, edges };
  }

  /**
   * Extract Zustand create() store → Hook node + Function sub-nodes for actions
   */
  private extractZustandStore(
    valueNode: Parser.SyntaxNode,
    varName: string,
    file: string
  ): { nodes: GraphNode[]; edges: GraphEdge[] } | null {
    if (valueNode.type !== 'call_expression') return null;
    const funcRef = valueNode.childForFieldName('function');
    if (!funcRef || funcRef.text !== 'create') return null;

    const args = valueNode.childForFieldName('arguments');
    if (!args) return null;

    // Zustand: create((set) => ({ count: 0, increment: () => set(...) }))
    const callback = args.namedChildren.find(c => c.type === 'arrow_function' || c.type === 'function_expression');
    if (!callback) return null;

    const line = valueNode.startPosition.row + 1;
    const storeId = generateNodeId(file, varName, line);

    const nodes: GraphNode[] = [{
      id: storeId,
      name: varName,
      type: NodeType.Hook,
      language: Language.TypeScript,
      file,
      line,
      signature: `const ${varName} = create(...)`,
      repo: this.repoName,
      metadata: { framework: 'zustand' },
    }];

    const edges: GraphEdge[] = [];

    // Find the returned object from the callback
    const body = callback.childForFieldName('body');
    if (!body) return { nodes, edges };

    // Look for object in parenthesized expression: (set) => ({ ... })
    const objects = body.descendantsOfType('object');
    const returnObj = objects[0];
    if (!returnObj) return { nodes, edges };

    const pairs = returnObj.children.filter(c => c.type === 'pair');
    for (const pair of pairs) {
      const key = pair.childForFieldName('key');
      const value = pair.childForFieldName('value');
      if (!key || !value) continue;

      const isFunc = value.type === 'arrow_function' || value.type === 'function_expression';
      if (!isFunc) continue;

      const actionName = key.text;
      const aLine = pair.startPosition.row + 1;
      const actionId = generateNodeId(file, `${varName}.${actionName}`, aLine);

      nodes.push({
        id: actionId,
        name: `${varName}.${actionName}`,
        type: NodeType.Function,
        language: Language.TypeScript,
        file,
        line: aLine,
        signature: `${actionName}: () =>`,
        repo: this.repoName,
        metadata: { framework: 'zustand', parentStore: varName },
      });

      edges.push({
        source: storeId,
        target: actionId,
        type: EdgeType.Calls,
        protocol: Protocol.Internal,
        callLine: aLine,
      });
    }

    return { nodes, edges };
  }

  // ─── Story 12.22: Axios baseURL Composition ────────────

  /**
   * Detect axios.create({ baseURL: '...' }) and extract the instance info.
   */
  private extractAxiosCreate(nameNode: Parser.SyntaxNode, valueNode: Parser.SyntaxNode): AxiosInstance | null {
    if (valueNode.type !== 'call_expression') return null;
    const funcRef = valueNode.childForFieldName('function');
    if (!funcRef) return null;

    // axios.create(...)
    if (funcRef.type !== 'member_expression') return null;
    const obj = funcRef.childForFieldName('object');
    const prop = funcRef.childForFieldName('property');
    if (!obj || !prop) return null;
    if (obj.text !== 'axios' || prop.text !== 'create') return null;

    const args = valueNode.childForFieldName('arguments');
    if (!args) return null;
    const configObj = args.namedChildren.find(c => c.type === 'object');
    if (!configObj) return null;

    // Find baseURL property
    const pairs = configObj.descendantsOfType('pair');
    for (const pair of pairs) {
      const key = pair.childForFieldName('key');
      if (key?.text !== 'baseURL') continue;
      const val = pair.childForFieldName('value');
      if (!val) continue;

      // String literal baseURL
      const strVal = this.extractStringLiteral(val);
      if (strVal) {
        return { variableName: nameNode.text, baseURL: strVal };
      }

      // process.env.X → ${X}
      if (val.type === 'member_expression' && val.text.startsWith('process.env.')) {
        const envVar = val.text.replace('process.env.', '');
        return { variableName: nameNode.text, baseURL: `\${${envVar}}` };
      }
    }

    return null;
  }

  private composeBaseURL(baseURL: string, path: string): string {
    const base = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
    const p = path.startsWith('/') ? path : '/' + path;
    return base + p;
  }

  // ─── Helpers ────────────────────────────────────────────

  private extractStringLiteral(node: Parser.SyntaxNode): string | null {
    if (node.type === 'string' || node.type === 'string_fragment') {
      // Remove quotes
      return node.text.replace(/^['"`]|['"`]$/g, '');
    }
    // Try child string_fragment for template strings without interpolation
    const fragment = node.descendantsOfType('string_fragment')[0];
    if (fragment) return fragment.text;
    return null;
  }

  private findObjectProperty(node: Parser.SyntaxNode, key: string): string | null {
    const pairs = node.descendantsOfType('pair');
    for (const pair of pairs) {
      const k = pair.childForFieldName('key');
      const v = pair.childForFieldName('value');
      if (k?.text === key && v) {
        return this.extractStringLiteral(v) ?? v.text;
      }
    }
    return null;
  }

  /**
   * Find the enclosing function/method declaration node and return its name + line.
   * Uses declaration line (not call-site) so generated IDs match function node IDs.
   */
  // ─── NestJS Extraction (Stories 12.11-12.13) ──────────────────────

  private extractNestJS(
    source: string,
    file: string,
    nodes: GraphNode[],
    edges: GraphEdge[]
  ): void {
    // Helper: find existing node by name+file and patch it, or create new
    const patchOrCreate = (
      name: string,
      type: NodeType,
      line: number,
      signature: string,
      metadata: Record<string, string>
    ): GraphNode => {
      const existing = nodes.find(n => n.name === name && n.file === file);
      if (existing) {
        existing.type = type;
        existing.signature = signature;
        existing.metadata = { ...existing.metadata, ...metadata };
        return existing;
      }
      const id = generateNodeId(file, name, line);
      const node: GraphNode = {
        id, name, type, language: Language.TypeScript,
        file, line, signature, repo: this.repoName, metadata,
      };
      nodes.push(node);
      return node;
    };

    // Story 12.12: @Module() detection
    const moduleRe = /@Module\s*\([^)]*\)\s*(?:export\s+)?class\s+(\w+)/g;
    let match;
    while ((match = moduleRe.exec(source)) !== null) {
      const name = match[1];
      const line = source.substring(0, match.index).split('\n').length;
      patchOrCreate(name, NodeType.Module, line, `@Module() class ${name}`, { framework: 'nestjs' });
    }

    // Story 12.12: @Controller() detection with route extraction
    // Match @Controller('prefix') or @Controller({ path: 'prefix', version: 'v' }) or @Controller()
    // Allow other decorators (e.g. @UseGuards) between @Controller() and class keyword
    const controllerBlockRe = /@Controller\s*\(\s*(?:'([^']*)'|"([^"]*)"|(\{[^}]*\}))?\s*\)[\s\S]*?(?:export\s+)?class\s+(\w+)\s*\{/g;
    while ((match = controllerBlockRe.exec(source)) !== null) {
      const prefix = match[1] ?? match[2] ?? '';
      const objBlock = match[3];
      const className = match[4];
      const classStartIndex = match.index;
      const classLine = source.substring(0, classStartIndex).split('\n').length;

      let controllerPath = prefix;
      let version = '';

      // Parse object-style @Controller({ path: '...', version: '...' })
      if (objBlock) {
        const pathMatch = objBlock.match(/path:\s*['"]([^'"]*)['"]/);
        const versionMatch = objBlock.match(/version:\s*['"]([^'"]*)['"]/);
        if (pathMatch) controllerPath = pathMatch[1];
        if (versionMatch) version = versionMatch[1];
      }

      // Build route prefix
      let routePrefix = '';
      if (version) {
        routePrefix = `/v${version}`;
      }
      if (controllerPath) {
        routePrefix += `/${controllerPath}`;
      }

      const controllerNode = patchOrCreate(
        className, NodeType.Service, classLine,
        `@Controller('${controllerPath}') class ${className}`,
        { framework: 'nestjs', role: 'controller' }
      );
      const controllerId = controllerNode.id;

      // Find the class body: from the opening { after class declaration to matching }
      const classBodyStart = source.indexOf('{', classStartIndex + match[0].length - 1);
      if (classBodyStart === -1) continue;

      // Find matching closing brace
      let braceCount = 1;
      let pos = classBodyStart + 1;
      while (pos < source.length && braceCount > 0) {
        if (source[pos] === '{') braceCount++;
        else if (source[pos] === '}') braceCount--;
        pos++;
      }
      const classBody = source.substring(classBodyStart, pos);

      // Extract HTTP method decorators
      const httpMethodRe = /@(Get|Post|Put|Delete|Patch|Head|Options|All)\s*\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/g;
      let methodMatch;
      while ((methodMatch = httpMethodRe.exec(classBody)) !== null) {
        const httpMethod = methodMatch[1].toUpperCase();
        const subPath = methodMatch[2] ?? methodMatch[3] ?? '';

        // Assemble full route path
        let fullPath = routePrefix;
        if (subPath) {
          fullPath += `/${subPath}`;
        }
        // Ensure path starts with /
        if (!fullPath.startsWith('/')) fullPath = '/' + fullPath;
        // Normalize double slashes
        fullPath = fullPath.replace(/\/+/g, '/');
        // Convert NestJS :param to Express-style :param (already compatible)

        const handlerName = `${httpMethod} ${fullPath}`;
        const handlerLine = source.substring(0, classBodyStart + methodMatch.index).split('\n').length;
        const handlerId = generateNodeId(file, handlerName, handlerLine);

        nodes.push({
          id: handlerId, name: handlerName, type: NodeType.Handler, language: Language.TypeScript,
          file, line: handlerLine, signature: `@${methodMatch[1]}('${subPath}')`,
          repo: this.repoName,
          metadata: { framework: 'nestjs', method: httpMethod, path: fullPath },
        });

        // Create routes-to edge from controller to handler
        edges.push({
          source: controllerId, target: handlerId,
          type: EdgeType.RoutesTo, protocol: Protocol.REST,
          metadata: { method: httpMethod, path: fullPath },
        });
      }

      // Story 12.13: Extract constructor DI from controller
      this.extractConstructorDI(classBody, classBodyStart, source, file, controllerId, edges);
    }

    // Story 12.13: @Injectable() service detection
    // Allow implements/extends clauses between class name and {
    const injectableRe = /@Injectable\s*\(\s*\)\s*(?:export\s+)?class\s+(\w+)[\s\S]*?\{/g;
    while ((match = injectableRe.exec(source)) !== null) {
      const className = match[1];
      const classStartIndex = match.index;
      const classLine = source.substring(0, classStartIndex).split('\n').length;

      // Skip if already processed as a controller
      const existingNode = nodes.find(n => n.name === className && n.file === file);
      if (existingNode && existingNode.metadata?.role === 'controller') continue;

      const serviceNode = patchOrCreate(
        className, NodeType.Service, classLine,
        `@Injectable() class ${className}`,
        { framework: 'nestjs', role: 'service' }
      );
      const serviceId = serviceNode.id;

      // Find the class body
      const classBodyStart = source.indexOf('{', classStartIndex + match[0].length - 1);
      if (classBodyStart === -1) continue;

      let braceCount = 1;
      let pos = classBodyStart + 1;
      while (pos < source.length && braceCount > 0) {
        if (source[pos] === '{') braceCount++;
        else if (source[pos] === '}') braceCount--;
        pos++;
      }
      const classBody = source.substring(classBodyStart, pos);

      // Extract constructor DI
      this.extractConstructorDI(classBody, classBodyStart, source, file, serviceId, edges);
    }

    // Story 12.14: @Module() with imports/controllers/providers/exports parsing
    const moduleDetailRe = /@Module\s*\((\{[\s\S]*?\})\s*\)\s*(?:export\s+)?class\s+(\w+)/g;
    while ((match = moduleDetailRe.exec(source)) !== null) {
      const moduleBody = match[1];
      const moduleName = match[2];
      const moduleLine = source.substring(0, match.index).split('\n').length;

      // Check for @Global() decorator before @Module
      const beforeModule = source.substring(0, match.index);
      const isGlobal = /@Global\s*\(\s*\)\s*$/.test(beforeModule.trimEnd());

      const moduleNode = patchOrCreate(
        moduleName, NodeType.Module, moduleLine,
        `@Module() class ${moduleName}`,
        { framework: 'nestjs', ...(isGlobal ? { isGlobal: 'true' } : {}) }
      );
      const moduleId = moduleNode.id;

      // Parse array fields from module decorator body
      const parseArrayField = (field: string): string[] => {
        const re = new RegExp(`${field}\\s*:\\s*\\[([^\\]]*)]`);
        const m = moduleBody.match(re);
        if (!m) return [];
        return m[1].split(',').map(s => s.trim()).filter(Boolean);
      };

      const imports = parseArrayField('imports');
      const controllers = parseArrayField('controllers');
      const providers = parseArrayField('providers');
      const exports = parseArrayField('exports');

      // Store exports in module node metadata
      if (exports.length > 0) {
        const moduleNode = nodes.find(n => n.id === moduleId);
        if (moduleNode) {
          moduleNode.metadata = { ...moduleNode.metadata, exports: exports.join(',') };
        }
      }

      for (const imp of imports) {
        edges.push({
          source: moduleId, target: imp,
          type: EdgeType.Imports, protocol: Protocol.Internal,
          metadata: { relationship: 'module-import' },
        });
      }

      for (const ctrl of controllers) {
        edges.push({
          source: moduleId, target: ctrl,
          type: EdgeType.Imports, protocol: Protocol.Internal,
          metadata: { relationship: 'provides' },
        });
      }

      for (const prov of providers) {
        edges.push({
          source: moduleId, target: prov,
          type: EdgeType.Imports, protocol: Protocol.Internal,
          metadata: { relationship: 'provides' },
        });
      }
    }

    // Story 12.15: @UseGuards and @UseInterceptors
    // Re-scan controller blocks to find class-level and method-level guards/interceptors
    const controllerBlockRe2 = /@Controller\s*\(\s*(?:'([^']*)'|"([^"]*)"|(\{[^}]*\}))?\s*\)[\s\S]*?(?:export\s+)?class\s+(\w+)\s*\{/g;
    while ((match = controllerBlockRe2.exec(source)) !== null) {
      const className = match[4];
      const classStartIndex = match.index;

      // Find the class body
      const classBodyStart = source.indexOf('{', classStartIndex + match[0].length - 1);
      if (classBodyStart === -1) continue;
      let braceCount = 1;
      let pos = classBodyStart + 1;
      while (pos < source.length && braceCount > 0) {
        if (source[pos] === '{') braceCount++;
        else if (source[pos] === '}') braceCount--;
        pos++;
      }
      const classBody = source.substring(classBodyStart, pos);

      // Check the area BEFORE class body for class-level decorators
      const beforeClass = source.substring(0, classBodyStart);

      // Class-level @UseGuards
      const classGuardRe = /@UseGuards\s*\(\s*(\w+)\s*\)/g;
      let guardMatch;
      const classGuards: string[] = [];
      // Look in the decorator area (between last non-decorator line and class declaration)
      const decoratorArea = beforeClass.substring(Math.max(0, beforeClass.lastIndexOf('\n@')));
      while ((guardMatch = classGuardRe.exec(decoratorArea)) !== null) {
        classGuards.push(guardMatch[1]);
      }

      // Class-level @UseInterceptors
      const classInterceptorRe = /@UseInterceptors\s*\(\s*(\w+)\s*\)/g;
      let interceptorMatch;
      const classInterceptors: string[] = [];
      while ((interceptorMatch = classInterceptorRe.exec(decoratorArea)) !== null) {
        classInterceptors.push(interceptorMatch[1]);
      }

      // Create guard nodes for class-level guards
      for (const guardName of classGuards) {
        const existingGuard = nodes.find(n => n.name === guardName);
        if (!existingGuard) {
          const guardLine = source.substring(0, match.index).split('\n').length;
          patchOrCreate(guardName, NodeType.Guard, guardLine, `class ${guardName}`, { framework: 'nestjs' });
        }
      }

      // Create interceptor nodes for class-level interceptors
      for (const intName of classInterceptors) {
        const existingInt = nodes.find(n => n.name === intName);
        if (!existingInt) {
          const intLine = source.substring(0, match.index).split('\n').length;
          patchOrCreate(intName, NodeType.Interceptor, intLine, `class ${intName}`, { framework: 'nestjs' });
        }
      }

      // Find all handler methods in this controller to apply class-level guards/interceptors
      // First, collect all HTTP method decorator positions and the surrounding decorator areas
      const httpMethodRe2 = /@(Get|Post|Put|Delete|Patch|Head|Options|All)\s*\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/g;
      let methodMatch2;
      const methodPositions: { index: number; endIndex: number; httpMethod: string; subPath: string }[] = [];
      while ((methodMatch2 = httpMethodRe2.exec(classBody)) !== null) {
        methodPositions.push({
          index: methodMatch2.index,
          endIndex: methodMatch2.index + methodMatch2[0].length,
          httpMethod: methodMatch2[1].toUpperCase(),
          subPath: methodMatch2[2] ?? methodMatch2[3] ?? '',
        });
      }

      for (let i = 0; i < methodPositions.length; i++) {
        const mp = methodPositions[i];

        // Re-derive the route prefix from the controller match
        const controllerPrefix = match[1] ?? match[2] ?? '';
        let fullPath = controllerPrefix ? `/${controllerPrefix}` : '';
        if (mp.subPath) fullPath += `/${mp.subPath}`;
        if (!fullPath.startsWith('/')) fullPath = '/' + fullPath;
        fullPath = fullPath.replace(/\/+/g, '/');

        const handlerName = `${mp.httpMethod} ${fullPath}`;
        const handlerNode = nodes.find(n => n.name === handlerName && n.file === file);
        if (!handlerNode) continue;

        // Determine the decorator area for this method:
        // From the current HTTP method decorator to the next HTTP method decorator (or end of class body)
        // This captures decorators that appear between the HTTP verb and the method name (e.g. @UseInterceptors)
        const nextStart = i < methodPositions.length - 1 ? methodPositions[i + 1].index : classBody.length;
        const methodDecoratorArea = classBody.substring(mp.index, nextStart);

        // Method-level @UseGuards
        const methodGuardRe = /@UseGuards\s*\(\s*(\w+)\s*\)/g;
        let mg;
        while ((mg = methodGuardRe.exec(methodDecoratorArea)) !== null) {
          const gName = mg[1];
          const existingG = nodes.find(n => n.name === gName);
          if (!existingG) {
            const gLine = source.substring(0, classBodyStart + mp.index).split('\n').length;
            patchOrCreate(gName, NodeType.Guard, gLine, `class ${gName}`, { framework: 'nestjs' });
          }
          const guardNode = nodes.find(n => n.name === gName);
          if (guardNode) {
            edges.push({
              source: handlerNode.id, target: guardNode.id,
              type: EdgeType.Calls, protocol: Protocol.Internal,
              metadata: { relationship: 'guards' },
            });
          }
        }

        // Method-level @UseInterceptors
        const methodInterceptorRe = /@UseInterceptors\s*\(\s*(\w+)\s*\)/g;
        let mi;
        while ((mi = methodInterceptorRe.exec(methodDecoratorArea)) !== null) {
          const iName = mi[1];
          const existingI = nodes.find(n => n.name === iName);
          if (!existingI) {
            const iLine = source.substring(0, classBodyStart + mp.index).split('\n').length;
            patchOrCreate(iName, NodeType.Interceptor, iLine, `class ${iName}`, { framework: 'nestjs' });
          }
          const intNode = nodes.find(n => n.name === iName);
          if (intNode) {
            edges.push({
              source: handlerNode.id, target: intNode.id,
              type: EdgeType.Calls, protocol: Protocol.Internal,
              metadata: { relationship: 'intercepts' },
            });
          }
        }

        // Apply class-level guards to ALL handler methods
        for (const guardName of classGuards) {
          const guardNode = nodes.find(n => n.name === guardName);
          if (guardNode) {
            edges.push({
              source: handlerNode.id, target: guardNode.id,
              type: EdgeType.Calls, protocol: Protocol.Internal,
              metadata: { relationship: 'guards' },
            });
          }
        }

        // Apply class-level interceptors to ALL handler methods
        for (const intName of classInterceptors) {
          const intNode = nodes.find(n => n.name === intName);
          if (intNode) {
            edges.push({
              source: handlerNode.id, target: intNode.id,
              type: EdgeType.Calls, protocol: Protocol.Internal,
              metadata: { relationship: 'intercepts' },
            });
          }
        }
      }
    }

    // Story 12.16: @WebSocketGateway detection
    const wsGatewayRe = /@WebSocketGateway\s*\(([^)]*)\)\s*(?:export\s+)?class\s+(\w+)\s*\{/g;
    while ((match = wsGatewayRe.exec(source)) !== null) {
      const args = match[1];
      const gatewayName = match[2];
      const gatewayStartIndex = match.index;
      const gatewayLine = source.substring(0, gatewayStartIndex).split('\n').length;

      // Parse port and namespace from args
      const portMatch = args.match(/^(\d+)/);
      const nsMatch = args.match(/namespace:\s*['"]([^'"]*)['"]/);
      const port = portMatch ? portMatch[1] : '';
      const namespace = nsMatch ? nsMatch[1] : '';

      const gatewayNode = patchOrCreate(
        gatewayName, NodeType.Handler, gatewayLine,
        `@WebSocketGateway(${args.trim()}) class ${gatewayName}`,
        { framework: 'nestjs', protocol: 'WebSocket', ...(port ? { port } : {}), ...(namespace ? { namespace } : {}) }
      );
      const gatewayId = gatewayNode.id;

      // Find class body
      const classBodyStart = source.indexOf('{', gatewayStartIndex + match[0].length - 1);
      if (classBodyStart === -1) continue;
      let braceCount = 1;
      let pos = classBodyStart + 1;
      while (pos < source.length && braceCount > 0) {
        if (source[pos] === '{') braceCount++;
        else if (source[pos] === '}') braceCount--;
        pos++;
      }
      const classBody = source.substring(classBodyStart, pos);

      // Extract @SubscribeMessage handlers
      const subMsgRe = /@SubscribeMessage\s*\(\s*['"]([^'"]*)['"]\s*\)/g;
      let subMatch;
      while ((subMatch = subMsgRe.exec(classBody)) !== null) {
        const eventName = subMatch[1];
        const handlerLine = source.substring(0, classBodyStart + subMatch.index).split('\n').length;
        const handlerName = `WS ${eventName}`;
        const handlerId = generateNodeId(file, handlerName, handlerLine);

        nodes.push({
          id: handlerId, name: handlerName, type: NodeType.Handler, language: Language.TypeScript,
          file, line: handlerLine, signature: `@SubscribeMessage('${eventName}')`,
          repo: this.repoName,
          metadata: { framework: 'nestjs', event: eventName, protocol: 'WebSocket' },
        });

        edges.push({
          source: gatewayId, target: handlerId,
          type: EdgeType.RoutesTo, protocol: Protocol.WebSocket,
          metadata: { event: eventName },
        });
      }
    }

    // Story 12.16: @MessagePattern detection
    const msgPatternRe = /@MessagePattern\s*\(\s*(?:\{\s*cmd:\s*['"]([^'"]*)['"]\s*\}|['"]([^'"]*)['"]\s*)\)/g;
    while ((match = msgPatternRe.exec(source)) !== null) {
      const patternName = match[1] ?? match[2];
      const handlerLine = source.substring(0, match.index).split('\n').length;
      const handlerName = `MSG ${patternName}`;
      const handlerId = generateNodeId(file, handlerName, handlerLine);

      // Find the method name after the decorator
      const afterDecorator = source.substring(match.index + match[0].length);
      const methodNameMatch = afterDecorator.match(/\s*(\w+)\s*\(/);
      const methodSig = methodNameMatch ? methodNameMatch[1] : handlerName;

      nodes.push({
        id: handlerId, name: handlerName, type: NodeType.Handler, language: Language.TypeScript,
        file, line: handlerLine, signature: `@MessagePattern('${patternName}') ${methodSig}()`,
        repo: this.repoName,
        metadata: { framework: 'nestjs', pattern: patternName, protocol: 'MessageBus' },
      });

      // Create routes-to edge for MessagePattern
      edges.push({
        source: handlerId, target: handlerId,
        type: EdgeType.RoutesTo, protocol: Protocol.MessageBus,
        metadata: { pattern: patternName, event: `cmd:${patternName}` },
      });
    }

    // Story 12.16: @EventPattern detection
    const eventPatternRe = /@EventPattern\s*\(\s*['"]([^'"]*)['"]\s*\)/g;
    while ((match = eventPatternRe.exec(source)) !== null) {
      const eventName = match[1];
      const handlerLine = source.substring(0, match.index).split('\n').length;
      const handlerName = `EVT ${eventName}`;
      const handlerId = generateNodeId(file, handlerName, handlerLine);

      // Find the method name after the decorator
      const afterDecorator = source.substring(match.index + match[0].length);
      const methodNameMatch = afterDecorator.match(/\s*(\w+)\s*\(/);
      const methodSig = methodNameMatch ? methodNameMatch[1] : handlerName;

      nodes.push({
        id: handlerId, name: handlerName, type: NodeType.Handler, language: Language.TypeScript,
        file, line: handlerLine, signature: `@EventPattern('${eventName}') ${methodSig}()`,
        repo: this.repoName,
        metadata: { framework: 'nestjs', event: eventName, protocol: 'MessageBus' },
      });

      // Create routes-to edge for EventPattern
      edges.push({
        source: handlerId, target: handlerId,
        type: EdgeType.RoutesTo, protocol: Protocol.MessageBus,
        metadata: { pattern: eventName, event: eventName },
      });
    }
  }

  /**
   * Extract constructor dependency injection parameters and create calls edges.
   * Handles: constructor(private bookingService: BookingService, @Inject('TOKEN') private token: TokenType)
   */
  private extractConstructorDI(
    classBody: string,
    classBodyOffset: number,
    source: string,
    file: string,
    sourceNodeId: string,
    edges: GraphEdge[]
  ): void {
    // Use balanced paren matching for constructor params (handles @Inject('TOKEN') inside)
    const ctorStart = classBody.indexOf('constructor');
    if (ctorStart === -1) return;
    const parenStart = classBody.indexOf('(', ctorStart);
    if (parenStart === -1) return;
    let depth = 0;
    let parenEnd = -1;
    for (let i = parenStart; i < classBody.length; i++) {
      if (classBody[i] === '(') depth++;
      if (classBody[i] === ')') { depth--; if (depth === 0) { parenEnd = i; break; } }
    }
    if (parenEnd === -1) return;

    const params = classBody.substring(parenStart + 1, parenEnd);
    if (!params.trim()) return;

    // Parse each parameter: handle @Inject('TOKEN') private name: Type patterns
    // Split by comma, but be careful with generic types
    const paramList = this.splitConstructorParams(params);

    for (const param of paramList) {
      const trimmed = param.trim();
      if (!trimmed) continue;

      // Check for @Inject('TOKEN') pattern
      const injectMatch = trimmed.match(/@Inject\s*\(\s*['"]([^'"]+)['"]\s*\)/);

      // Extract type annotation: the last `: TypeName` in the parameter
      const typeMatch = trimmed.match(/:\s*(\w+)\s*$/);
      if (!typeMatch && !injectMatch) continue;

      const targetName = typeMatch ? typeMatch[1] : (injectMatch ? injectMatch[1] : '');
      if (!targetName) continue;

      const ctorLine = source.substring(0, classBodyOffset).split('\n').length;

      edges.push({
        source: sourceNodeId, target: targetName,
        type: EdgeType.Imports, protocol: Protocol.Internal,
        callLine: ctorLine,
        metadata: {
          relationship: 'injects',
          ...(injectMatch ? { token: injectMatch[1] } : {}),
        },
      });
    }
  }

  /**
   * Split constructor parameters, handling nested generics like Map<string, number>
   */
  private splitConstructorParams(params: string): string[] {
    const result: string[] = [];
    let depth = 0;
    let current = '';
    for (const ch of params) {
      if (ch === '<') depth++;
      else if (ch === '>') depth--;
      else if (ch === ',' && depth === 0) {
        result.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim()) result.push(current);
    return result;
  }

  private findEnclosingFuncInfo(node: Parser.SyntaxNode): { name: string; line: number } | null {
    let current = node.parent;
    while (current) {
      if (current.type === 'function_declaration' ||
          current.type === 'variable_declarator' ||
          current.type === 'method_definition') {
        const name = current.childForFieldName('name')?.text;
        if (name) {
          return { name, line: current.startPosition.row + 1 };
        }
      }
      current = current.parent;
    }
    return null;
  }
}
