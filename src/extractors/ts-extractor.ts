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
      } catch (error) {
        errors.push({
          file,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

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
        }
        // Drop unresolved call edges (stdlib, external)
      } else if (edge.type === EdgeType.Imports) {
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
      if (!handlerNodes || handlerNodes.length === 0) continue;

      // Prefer handler in the same file (important for GET/POST which appear in many files)
      const sameFileHandler = handlerNodes.find(h => h.file === route.file);
      const handler = sameFileHandler ?? handlerNodes[0];

      const enclosingNode = this.findEnclosingFunction(allNodes, route.file, route.line);
      const sourceId = enclosingNode?.id ?? generateNodeId(route.file, 'route-setup', 0);

      if (!enclosingNode) {
        const existing = allNodes.find(n => n.id === sourceId);
        if (!existing) {
          allNodes.push({
            id: sourceId,
            name: 'route-setup',
            type: NodeType.Function,
            language: Language.TypeScript,
            file: route.file,
            line: 0,
            signature: '',
            repo: this.repoName,
          });
        }
      }

      // Rename generic handler names (GET, POST, etc.) to include route path
      const httpMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
      if (httpMethods.includes(handler.name) && route.path) {
        handler.name = `${handler.name} ${route.path}`;
        handler.signature = `${handler.signature} // ${route.path}`;
      }

      resolvedEdges.push({
        source: sourceId || handler.id,
        target: handler.id,
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
    const info: FrameworkInfo = { hasNext: false, hasReact: false, hasReactRouter: false, hasRedux: false, hasZustand: false };

    // Check root package.json
    this.checkPackageJson(path.join(this.rootPath, 'package.json'), info);

    // Monorepo: also check sub-app package.json files (apps/*/package.json, packages/*/package.json)
    if (!info.hasNext) {
      for (const dir of ['apps', 'packages']) {
        const dirPath = path.join(this.rootPath, dir);
        try {
          const entries = fs.readdirSync(dirPath, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              this.checkPackageJson(path.join(dirPath, entry.name, 'package.json'), info);
              if (info.hasNext) break;
            }
          }
        } catch { /* dir doesn't exist */ }
        if (info.hasNext) break;
      }
    }

    return info;
  }

  private checkPackageJson(pkgPath: string, info: FrameworkInfo): void {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if ('next' in allDeps) info.hasNext = true;
      if ('react' in allDeps || info.hasNext) info.hasReact = true;
      if ('react-router-dom' in allDeps) info.hasReactRouter = true;
      if ('@reduxjs/toolkit' in allDeps) info.hasRedux = true;
      if ('zustand' in allDeps) info.hasZustand = true;
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
