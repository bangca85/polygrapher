import fs from 'node:fs';
import path from 'node:path';
import { createParser, parseSource } from '../parser/tree-sitter-engine.js';
import { generateNodeId } from '../graph/node-id.js';
import { Language, NodeType, EdgeType, Protocol } from '../types/graph.types.js';
import type { GraphNode, GraphEdge } from '../types/graph.types.js';
import type { LanguageExtractor, ExtractorResult, ParseError } from '../types/extractor.types.js';

export interface DartFrameworkInfo {
  hasFlutter: boolean;
  hasBloc: boolean;
  hasRiverpod: boolean;
  hasGoRouter: boolean;
  hasAutoRoute: boolean;
  hasDio: boolean;
  hasGetX: boolean;
  hasGetIt: boolean;
  hasRetrofit: boolean;
  hasFreezed: boolean;
  hasFloorDrift: boolean;
  hasMobX: boolean;
}

export class DartExtractor implements LanguageExtractor {
  readonly language = Language.Dart;
  readonly configFiles = ['pubspec.yaml'];

  private rootPath = '';
  private repoName = '';
  private framework: DartFrameworkInfo = {
    hasFlutter: false,
    hasBloc: false,
    hasRiverpod: false,
    hasGoRouter: false,
    hasAutoRoute: false,
    hasDio: false,
    hasGetX: false,
    hasGetIt: false,
    hasRetrofit: false,
    hasFreezed: false,
    hasFloorDrift: false,
    hasMobX: false,
  };

  async detect(rootPath: string): Promise<boolean> {
    return fs.existsSync(path.join(rootPath, 'pubspec.yaml'));
  }

  detectFramework(rootPath?: string): DartFrameworkInfo {
    const root = rootPath || this.rootPath;

    // Search for pubspec.yaml at root and in immediate subdirectories (monorepo support)
    let pubspecPath = path.join(root, 'pubspec.yaml');
    if (!fs.existsSync(pubspecPath)) {
      try {
        const entries = fs.readdirSync(root, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const subPath = path.join(root, entry.name, 'pubspec.yaml');
            if (fs.existsSync(subPath)) {
              pubspecPath = subPath;
              break;
            }
          }
        }
      } catch { /* ignore */ }
    }

    const info: DartFrameworkInfo = {
      hasFlutter: false,
      hasBloc: false,
      hasRiverpod: false,
      hasGoRouter: false,
      hasAutoRoute: false,
      hasDio: false,
      hasGetX: false,
      hasGetIt: false,
      hasRetrofit: false,
      hasFreezed: false,
      hasFloorDrift: false,
      hasMobX: false,
    };

    if (!fs.existsSync(pubspecPath)) return info;

    const content = fs.readFileSync(pubspecPath, 'utf-8');

    // Simple YAML dependency detection via line-based parsing
    // We look for dependency names under dependencies: or dev_dependencies:
    const depPatterns: [keyof DartFrameworkInfo, string[]][] = [
      ['hasFlutter', ['flutter:']],
      ['hasBloc', ['bloc:', 'flutter_bloc:']],
      ['hasRiverpod', ['riverpod:', 'flutter_riverpod:', 'hooks_riverpod:']],
      ['hasGoRouter', ['go_router:']],
      ['hasAutoRoute', ['auto_route:']],
      ['hasDio', ['dio:']],
      ['hasGetX', ['get:', 'getx:']],
      ['hasGetIt', ['get_it:']],
      ['hasRetrofit', ['retrofit:']],
      ['hasFreezed', ['freezed:', 'freezed_annotation:']],
      ['hasFloorDrift', ['floor:', 'drift:']],
      ['hasMobX', ['mobx:', 'flutter_mobx:']],
    ];

    // Parse dependencies section - look for indented package names
    const lines = content.split('\n');
    let inDepsSection = false;

    for (const line of lines) {
      const trimmed = line.trimStart();

      // Track if we're in a dependencies section
      if (trimmed === 'dependencies:' || trimmed === 'dev_dependencies:') {
        inDepsSection = true;
        continue;
      }

      // Exit deps section when we hit a non-indented, non-empty line
      if (inDepsSection && trimmed.length > 0 && line[0] !== ' ' && line[0] !== '\t') {
        inDepsSection = false;
      }

      if (!inDepsSection) continue;

      // Check each pattern against current line
      for (const [key, patterns] of depPatterns) {
        for (const pattern of patterns) {
          // Match "  package_name:" with indentation
          if (trimmed.startsWith(pattern)) {
            info[key] = true;
          }
        }
      }
    }

    // Special case: flutter SDK dependency uses "flutter:" under "sdk: flutter"
    if (!info.hasFlutter && content.includes('sdk: flutter')) {
      info.hasFlutter = true;
    }

    return info;
  }

  async parse(files: string[], rootPath?: string): Promise<ExtractorResult> {
    this.rootPath = rootPath || path.dirname(files[0] || '.');
    this.repoName = path.basename(this.rootPath);
    this.framework = this.detectFramework();

    const allNodes: GraphNode[] = [];
    const allEdges: GraphEdge[] = [];
    const errors: ParseError[] = [];

    const parser = await createParser(Language.Dart);

    for (const file of files) {
      try {
        const source = fs.readFileSync(file, 'utf-8');
        const relFile = path.relative(this.rootPath, file);
        const tree = parseSource(parser, source);

        const result = this.extractFromTree(tree, relFile, source);
        allNodes.push(...result.nodes);
        allEdges.push(...result.edges);
      } catch (error) {
        errors.push({
          file: path.relative(this.rootPath, file),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Detect architecture pattern and tag nodes
    this.detectArchitecture(allNodes, files);

    // Post-extraction: resolve symbolic edge targets to actual node IDs
    this.resolveEdgeTargets(allNodes, allEdges);

    return { nodes: allNodes, edges: allEdges, errors };
  }

  /**
   * Resolve symbolic edge targets/sources to actual node IDs.
   * - Route edges: widget name → widget node ID
   * - BLoC call edges: "receiver.method" → matching node ID
   * - Riverpod ref edges: provider name → provider node ID
   */
  private resolveEdgeTargets(nodes: GraphNode[], edges: GraphEdge[]): void {
    // Build name→ID index
    const nameToId = new Map<string, string>();
    for (const node of nodes) {
      nameToId.set(node.name, node.id);
    }

    // Build method-suffix index for fuzzy matching: "getBookings" → node with name ending in ".getBookings"
    const methodToId = new Map<string, string>();
    for (const node of nodes) {
      const dotIdx = node.name.lastIndexOf('.');
      if (dotIdx !== -1) {
        const methodName = node.name.substring(dotIdx + 1);
        methodToId.set(methodName, node.id);
      }
    }

    for (let i = edges.length - 1; i >= 0; i--) {
      const edge = edges[i];

      // Resolve symbolic sources (e.g., extends/implements edges have interface name as source)
      if (edge.source && !nodes.some(n => n.id === edge.source)) {
        const resolvedSrc = nameToId.get(edge.source);
        if (resolvedSrc) {
          edge.source = resolvedSrc;
        }
      }

      // Skip REST edges — their targets are URL paths resolved by graph-builder cross-language matcher
      if (edge.protocol === Protocol.REST) continue;

      // Resolve target if it's a symbolic name (not already an ID)
      if (edge.target && !nodes.some(n => n.id === edge.target)) {
        // Try exact name match first
        let resolved = nameToId.get(edge.target);

        // Try "receiver.method" pattern → find node with name "*.method"
        if (!resolved && edge.target.includes('.')) {
          const method = edge.target.split('.').pop()!;
          resolved = methodToId.get(method);
        }

        if (resolved) {
          edge.target = resolved;
        }
        // Keep unresolvable edges as-is — they may resolve cross-file at graph-builder level
      }
    }
  }

  private static readonly SERVICE_SUFFIXES = ['Service', 'Repository', 'UseCase', 'DataSource', 'Impl'];
  private static readonly PROVIDER_TYPES = [
    'Provider', 'StateNotifierProvider', 'NotifierProvider',
    'FutureProvider', 'StreamProvider', 'StateProvider',
    'ChangeNotifierProvider', 'AsyncNotifierProvider',
  ];
  private static readonly WIDGET_TYPES = [
    'StatelessWidget', 'StatefulWidget', 'HookWidget',
    'ConsumerWidget', 'HookConsumerWidget',
  ];

  private extractFromTree(
    tree: ReturnType<typeof parseSource>,
    relFile: string,
    source: string,
  ): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const root = tree.rootNode;

    for (let i = 0; i < root.childCount; i++) {
      const child = root.child(i)!;

      if (child.type === 'class_definition') {
        this.extractClass(child, relFile, nodes, edges);
      } else if (child.type === 'function_signature') {
        // Check if preceded by @riverpod annotation
        const prev = i > 0 ? root.child(i - 1) : null;
        const isRiverpod = prev?.type === 'marker_annotation' && prev.text === '@riverpod';
        if (isRiverpod) {
          const body = i + 1 < root.childCount ? root.child(i + 1) : null;
          this.extractRiverpodAnnotatedFunction(child, body, relFile, nodes, edges);
        } else {
          this.extractTopLevelFunction(child, relFile, nodes);
        }
      } else if (child.type === 'final_builtin') {
        // Provider declarations: final providerName = XxxProvider(...)
        // final_builtin is followed by static_final_declaration_list
        const declList = i + 1 < root.childCount ? root.child(i + 1) : null;
        if (declList?.type === 'static_final_declaration_list') {
          this.extractProviderDeclaration(declList, relFile, nodes, edges);
          i++; // Skip the declaration_list since we just processed it
        }
      }
    }

    // Extract Dio/http API calls from source text
    if (this.framework.hasDio || /http\.(get|post|put|delete|patch)\(/.test(source)) {
      this.extractHttpCalls(source, relFile, nodes, edges);
    }

    // Extract GoRouter routes from source text
    if (this.framework.hasGoRouter) {
      this.extractGoRoutes(source, relFile, nodes, edges);
    }

    // Extract AutoRoute annotations from AST
    if (this.framework.hasAutoRoute) {
      this.extractAutoRoutes(root, source, relFile, nodes, edges);
    }

    // Extract GetIt DI registration/lookup patterns from source text
    if (this.framework.hasGetIt) {
      this.extractGetItCalls(source, relFile, nodes, edges);
    }

    // Extract GetX DI patterns (Get.put, Get.find) from source text
    if (this.framework.hasGetX) {
      this.extractGetXCalls(source, relFile, nodes, edges);
    }

    // Extract Dio baseURL resolution + interceptor chains
    if (this.framework.hasDio) {
      this.extractDioBaseUrl(source, relFile, nodes, edges);
    }

    return { nodes, edges };
  }

  /** Find the enclosing node (class or function) for a given line number in a file.
   * If no matching node exists, creates a file-level synthetic node. */
  private findEnclosingNode(nodes: GraphNode[], relFile: string, callLine: number): string {
    const fileNodes = nodes
      .filter(n => n.file === relFile)
      .sort((a, b) => b.line - a.line); // Sort descending by line
    // Find the closest node whose line is <= callLine
    for (const node of fileNodes) {
      if (node.line <= callLine) return node.id;
    }
    if (fileNodes.length > 0) return fileNodes[fileNodes.length - 1].id;

    // No nodes in this file — create a file-level node
    const fileName = path.basename(relFile, '.dart');
    const fileNodeId = generateNodeId(relFile, fileName, 1);
    nodes.push({
      id: fileNodeId,
      name: fileName,
      type: NodeType.Function,
      language: Language.Dart,
      file: relFile,
      line: 1,
      signature: relFile,
      repo: this.repoName,
    });
    return fileNodeId;
  }

  private extractHttpCalls(
    source: string,
    relFile: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    const seen = new Set<string>();

    const addEdge = (method: string, urlPath: string, matchIndex: number) => {
      const key = `${method}:${urlPath}`;
      if (seen.has(key)) return;
      seen.add(key);

      const line = source.substring(0, matchIndex).split('\n').length;
      const enclosingId = this.findEnclosingNode(nodes, relFile, line);

      edges.push({
        source: enclosingId || generateNodeId(relFile, `dart-call:${key}`, line),
        target: urlPath,
        type: EdgeType.Calls,
        protocol: Protocol.REST,
        metadata: { method, path: urlPath },
        callLine: line,
      });
    };

    // Pattern 1: dio.get('/path'), dio.post('/path'), etc.
    const dioPattern = /dio\.(get|post|put|delete|patch)\(\s*'([^'$]+)'/gi;
    let match;
    while ((match = dioPattern.exec(source)) !== null) {
      addEdge(match[1].toUpperCase(), match[2], match.index);
    }

    // Also match double-quoted dio calls
    const dioDqPattern = /dio\.(get|post|put|delete|patch)\(\s*"([^"$]+)"/gi;
    while ((match = dioDqPattern.exec(source)) !== null) {
      addEdge(match[1].toUpperCase(), match[2], match.index);
    }

    // Pattern 2: dio.request('/path', options: Options(method: 'METHOD'))
    const requestPattern = /dio\.request\(\s*'([^'$]+)'[^)]*Options\s*\(\s*method:\s*'([^']+)'/gs;
    while ((match = requestPattern.exec(source)) !== null) {
      addEdge(match[2].toUpperCase(), match[1], match.index);
    }

    // Pattern 3: http.get(Uri.parse('https://example.com/path'))
    const httpPattern = /http\.(get|post|put|delete|patch)\(\s*Uri\.parse\(\s*'([^'$]+)'\s*\)/gi;
    while ((match = httpPattern.exec(source)) !== null) {
      let url = match[2];
      // Strip domain, keep path
      try {
        const parsed = new URL(url);
        url = parsed.pathname;
      } catch {
        // Not a full URL, use as-is
      }
      addEdge(match[1].toUpperCase(), url, match.index);
    }
  }

  private extractGetItCalls(
    source: string,
    relFile: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    // GetIt.instance.registerSingleton<Type>(Implementation())
    const registerRe = /GetIt\.instance\.(?:registerSingleton|registerFactory|registerLazySingleton)\s*<\s*(\w+)\s*>\s*\(\s*(\w+)/g;
    let match;
    while ((match = registerRe.exec(source)) !== null) {
      const line = source.substring(0, match.index).split('\n').length;
      const enclosingId = this.findEnclosingNode(nodes, relFile, line);
      edges.push({
        source: enclosingId,
        target: match[2], // Implementation class name
        type: EdgeType.Calls,
        protocol: Protocol.Internal,
        metadata: { diAction: 'register', interface: match[1], implementation: match[2] },
      });
    }

    // getIt<Type>() or GetIt.instance.get<Type>()
    const lookupRe = /(?:getIt|GetIt\.instance\.get)\s*<\s*(\w+)\s*>\s*\(\s*\)/g;
    while ((match = lookupRe.exec(source)) !== null) {
      const line = source.substring(0, match.index).split('\n').length;
      const enclosingId = this.findEnclosingNode(nodes, relFile, line);
      edges.push({
        source: enclosingId,
        target: match[1], // Lookup type
        type: EdgeType.Calls,
        protocol: Protocol.Internal,
        metadata: { diAction: 'lookup', type: match[1] },
      });
    }
  }

  private extractGetXCalls(
    source: string,
    relFile: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    // Get.put(ControllerName()) / Get.lazyPut(() => ControllerName())
    const putRe = /Get\.(?:put|lazyPut)\s*(?:<\s*\w+\s*>)?\s*\(\s*(?:\(\)\s*=>\s*)?(\w+)/g;
    let match;
    while ((match = putRe.exec(source)) !== null) {
      const line = source.substring(0, match.index).split('\n').length;
      const enclosingId = this.findEnclosingNode(nodes, relFile, line);
      edges.push({
        source: enclosingId,
        target: match[1],
        type: EdgeType.Calls,
        protocol: Protocol.Internal,
        metadata: { diAction: 'register', controller: match[1] },
      });
    }

    // Get.find<ControllerName>()
    const findRe = /Get\.find\s*<\s*(\w+)\s*>\s*\(\s*\)/g;
    while ((match = findRe.exec(source)) !== null) {
      const line = source.substring(0, match.index).split('\n').length;
      const enclosingId = this.findEnclosingNode(nodes, relFile, line);
      edges.push({
        source: enclosingId,
        target: match[1],
        type: EdgeType.Calls,
        protocol: Protocol.Internal,
        metadata: { diAction: 'lookup', controller: match[1] },
      });
    }
  }

  private extractDioBaseUrl(
    source: string,
    relFile: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    let baseUrl: string | null = null;

    // Pattern 1: Dio(BaseOptions(baseUrl: '...'))
    const baseOptionsRe = /BaseOptions\s*\([^)]*baseUrl:\s*'([^']+)'/;
    const m1 = source.match(baseOptionsRe);
    if (m1) baseUrl = m1[1];

    // Pattern 2: dio.options.baseUrl = '...'
    if (!baseUrl) {
      const assignRe = /\.options\.baseUrl\s*=\s*'([^']+)'/;
      const m2 = source.match(assignRe);
      if (m2) baseUrl = m2[1];
    }

    // Pattern 3: BaseOptions(baseUrl: variableName) — variable, not literal
    if (!baseUrl) {
      const varBaseUrlRe = /BaseOptions\s*\([^)]*baseUrl:\s*(\w+)/;
      const m3 = source.match(varBaseUrlRe);
      if (m3 && m3[1] !== 'null') {
        // Record as unresolved metadata on all REST edges in this file
        for (const edge of edges) {
          if (edge.protocol === Protocol.REST && edge.metadata) {
            edge.metadata.unresolvedBaseUrl = m3[1];
          }
        }
      }
    }

    if (baseUrl) {
      // Strip domain, keep path
      try {
        const parsed = new URL(baseUrl);
        baseUrl = parsed.pathname;
      } catch { /* not a full URL, use as-is */ }

      // Remove trailing slash for clean concatenation
      if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);

      // Resolve REST edges: combine baseUrl + endpoint path
      for (const edge of edges) {
        if (edge.protocol === Protocol.REST && edge.metadata?.path) {
          const p = edge.metadata.path;
          // Only combine if endpoint path doesn't already include the baseUrl
          if (baseUrl && baseUrl !== '/' && !p.startsWith(baseUrl)) {
            const endpointPath = p.startsWith('/') ? p : '/' + p;
            const combined = baseUrl + endpointPath;
            edge.metadata.path = combined;
            edge.target = combined;
          }
        }
      }
    }

    // Pattern 3: dio.interceptors.add(InterceptorClass())
    const interceptorRe = /\.interceptors\.add\(\s*(\w+)/g;
    let match;
    while ((match = interceptorRe.exec(source)) !== null) {
      const interceptorName = match[1];
      const line = source.substring(0, match.index).split('\n').length;
      const enclosingId = this.findEnclosingNode(nodes, relFile, line);
      edges.push({
        source: enclosingId,
        target: interceptorName,
        type: EdgeType.Calls,
        protocol: Protocol.Internal,
        metadata: { interceptor: interceptorName },
      });
    }
  }

  /** Build a map of route constants from classes like AppRoutes */
  private buildRouteConstantMap(source: string): Map<string, string> {
    const constants = new Map<string, string>();
    // Match patterns like: static const splash = '/splash';
    const constRe = /static\s+const\s+(\w+)\s*=\s*'([^']+)'/g;
    let m;
    while ((m = constRe.exec(source)) !== null) {
      constants.set(m[1], m[2]);
    }
    return constants;
  }

  private extractGoRoutes(
    source: string,
    relFile: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    // Build constant map for resolving AppRoutes.xxx references
    const routeConstants = this.buildRouteConstantMap(source);

    // Parse GoRoute declarations with nesting support
    interface RouteInfo { path: string; widget: string; startIdx: number; endIdx: number; line: number }
    const routes: RouteInfo[] = [];

    // Find each GoRoute( occurrence and extract path + builder
    const goRouteRe = /GoRoute\s*\(/g;
    let match;
    while ((match = goRouteRe.exec(source)) !== null) {
      const startIdx = match.index;
      const line = source.substring(0, startIdx).split('\n').length;

      // Find the end of this GoRoute's immediate parameter block
      // We need to find the matching close paren for GoRoute(
      let depth = 0;
      let endIdx = startIdx;
      for (let i = startIdx; i < source.length; i++) {
        if (source[i] === '(') depth++;
        if (source[i] === ')') {
          depth--;
          if (depth === 0) { endIdx = i; break; }
        }
      }

      // Extract from this GoRoute block only (not the rest of the file)
      // For path: find the FIRST path: within this block but before any nested GoRoute
      const blockText = source.substring(startIdx, endIdx + 1);
      // Find position of first nested GoRoute (if any) to limit our search
      const nestedGoRoute = blockText.indexOf('GoRoute', 10); // skip "GoRoute(" itself
      const searchText = nestedGoRoute > 0 ? blockText.substring(0, nestedGoRoute) : blockText;

      // Extract path — support both string literals and constant refs
      const pathLiteral = searchText.match(/path:\s*'([^']+)'/);
      const pathConstant = searchText.match(/path:\s*\w+\.(\w+)/);

      let routePath: string | null = null;
      if (pathLiteral) {
        routePath = pathLiteral[1];
      } else if (pathConstant) {
        routePath = routeConstants.get(pathConstant[1]) || null;
      }
      if (!routePath) continue;

      // Extract builder/pageBuilder widget name from this block
      const builderMatch = searchText.match(/(?:page)?[Bb]uilder:\s*\([^)]*\)\s*(?:=>|{[^}]*return)\s*(?:const\s+)?(?:NoTransitionPage\s*\(\s*child:\s*(?:const\s+)?)?(\w+)/);
      const widgetName = builderMatch ? builderMatch[1] : '';

      routes.push({ path: routePath, widget: widgetName, startIdx, endIdx, line });
    }

    // Resolve nesting: if a route's startIdx is within another route's range, it's a child
    for (const route of routes) {
      let fullPath = route.path;

      // Find parent route (route whose range contains this route's startIdx)
      if (!fullPath.startsWith('/')) {
        const parent = routes.find(
          r => r !== route && r.startIdx < route.startIdx && r.endIdx > route.startIdx
        );
        if (parent) {
          const parentPath = parent.path.endsWith('/') ? parent.path : parent.path + '/';
          fullPath = parentPath + route.path;
        }
      }

      const routeId = generateNodeId(relFile, `route:${fullPath}`, route.line);
      nodes.push({
        id: routeId,
        name: fullPath,
        type: NodeType.Route,
        language: Language.Dart,
        file: relFile,
        line: route.line,
        signature: `GoRoute(path: '${fullPath}')`,
        repo: this.repoName,
      });

      // Create routes-to edge to the widget
      if (route.widget) {
        edges.push({
          source: routeId,
          target: route.widget,
          type: EdgeType.RoutesTo,
          protocol: Protocol.Internal,
          metadata: { path: fullPath, widget: route.widget },
        });
      }
    }
  }

  private extractAutoRoutes(
    root: ReturnType<typeof parseSource>['rootNode'],
    source: string,
    relFile: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    // Detect @RoutePage() annotations on widget classes
    for (let i = 0; i < root.childCount; i++) {
      const child = root.child(i)!;
      if (child.type === 'class_definition') {
        // Check if preceded by @RoutePage annotation
        const prev = i > 0 ? root.child(i - 1) : null;
        const isRoutePage = prev?.type === 'annotation' && prev.text.includes('RoutePage')
          || prev?.type === 'marker_annotation' && prev.text.includes('RoutePage');
        if (!isRoutePage) continue;

        const nameNode = this.findChild(child, 'identifier');
        if (!nameNode) continue;

        const className = nameNode.text;
        const line = child.startPosition.row + 1;
        // Infer route path from class name: BookingPage → /booking
        const inferredPath = '/' + className.replace(/Page$/, '').replace(/([A-Z])/g, (_, c: string, idx: number) =>
          idx === 0 ? c.toLowerCase() : '-' + c.toLowerCase()
        );

        const routeId = generateNodeId(relFile, `route:${inferredPath}`, line);
        nodes.push({
          id: routeId,
          name: inferredPath,
          type: NodeType.Route,
          language: Language.Dart,
          file: relFile,
          line,
          signature: `@RoutePage() ${className}`,
          repo: this.repoName,
        });

        edges.push({
          source: routeId,
          target: className,
          type: EdgeType.RoutesTo,
          protocol: Protocol.Internal,
          metadata: { path: inferredPath, widget: className },
        });
      }
    }

    // Also parse AutoRoute config for explicit path mappings (supports both param orders)
    const autoRouteBlockRe = /AutoRoute\s*\(([^)]+)\)/gs;
    let m;
    while ((m = autoRouteBlockRe.exec(source)) !== null) {
      const block = m[1];
      const pathMatch = block.match(/path:\s*'([^']+)'/);
      const pageMatch = block.match(/page:\s*(\w+)/);
      if (!pathMatch || !pageMatch) continue;
      const routePath = pathMatch[1];
      const pageName = pageMatch[1];
      const line = source.substring(0, m.index).split('\n').length;

      const routeId = generateNodeId(relFile, `route:${routePath}`, line);
      // Avoid duplicate route nodes
      if (!nodes.find(n => n.name === routePath && n.type === NodeType.Route)) {
        nodes.push({
          id: routeId,
          name: routePath,
          type: NodeType.Route,
          language: Language.Dart,
          file: relFile,
          line,
          signature: `AutoRoute(path: '${routePath}')`,
          repo: this.repoName,
        });

        edges.push({
          source: routeId,
          target: pageName,
          type: EdgeType.RoutesTo,
          protocol: Protocol.Internal,
          metadata: { path: routePath, widget: pageName },
        });
      }
    }
  }

  /** Detect architecture pattern (Clean Architecture / Feature-first) from file paths */
  private detectArchitecture(nodes: GraphNode[], files: string[]): void {
    const relPaths = files.map(f => path.relative(this.rootPath, f));

    // Clean Architecture: lib/domain/, lib/data/, lib/presentation/
    const hasCleanArch = relPaths.some(p => /\blib\/domain\//.test(p) || /\blib\/data\//.test(p) || /\blib\/presentation\//.test(p));

    // Feature-first: lib/features/*/ or lib/modules/*/
    const hasFeatureFirst = relPaths.some(p => /\blib\/features\//.test(p) || /\blib\/modules\//.test(p));

    if (!hasCleanArch && !hasFeatureFirst) return;

    // Tag nodes with their architectural layer/feature for clustering
    for (const node of nodes) {
      const file = node.file;
      if (hasCleanArch) {
        if (file.includes('/domain/')) node.repo = `${this.repoName}:domain`;
        else if (file.includes('/data/')) node.repo = `${this.repoName}:data`;
        else if (file.includes('/presentation/')) node.repo = `${this.repoName}:presentation`;
      }
      if (hasFeatureFirst) {
        const featureMatch = file.match(/(?:features|modules)\/([^/]+)/);
        if (featureMatch) node.repo = `${this.repoName}:${featureMatch[1]}`;
      }
    }
  }

  private getChildIndex(node: ReturnType<typeof parseSource>['rootNode']): number {
    const parent = node.parent;
    if (!parent) return -1;
    // Compare by start position since tree-sitter may not return same object reference
    const startRow = node.startPosition.row;
    const startCol = node.startPosition.column;
    for (let i = 0; i < parent.childCount; i++) {
      const child = parent.child(i)!;
      if (child.startPosition.row === startRow && child.startPosition.column === startCol && child.type === node.type) {
        return i;
      }
    }
    return -1;
  }

  private getAnnotations(parentNode: ReturnType<typeof parseSource>['rootNode'] | null, classIdx: number): string[] {
    if (!parentNode || classIdx <= 0) return [];
    const annotations: string[] = [];
    // Walk backwards from classIdx to find annotation nodes
    for (let i = classIdx - 1; i >= 0; i--) {
      const sibling = parentNode.child(i)!;
      if (sibling.type === 'annotation' || sibling.type === 'marker_annotation') {
        // Extract annotation name: @freezed, @JsonSerializable(), @RestApi(baseUrl: ...)
        const text = sibling.text;
        const match = text.match(/@(\w+)/);
        if (match) annotations.push(match[1]);
      } else {
        break; // Stop at first non-annotation
      }
    }
    return annotations;
  }

  private getSuperclassName(classNode: ReturnType<typeof parseSource>['rootNode']): string | null {
    const superclass = this.findChild(classNode, 'superclass');
    if (!superclass) return null;
    const typeId = this.findChild(superclass, 'type_identifier');
    return typeId ? typeId.text : null;
  }

  private extractClass(
    classNode: ReturnType<typeof parseSource>['rootNode'],
    relFile: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    const nameNode = classNode.childForFieldName('name') ?? this.findChild(classNode, 'identifier');
    if (!nameNode) return;

    const className = nameNode.text;
    const line = classNode.startPosition.row + 1;
    const superclassName = this.getSuperclassName(classNode);

    // Skip private classes UNLESS they're MobX stores (pattern: abstract class _XxxStore with Store)
    const isMobXCandidate = className.startsWith('_') && classNode.text.includes('with Store');
    if (className.startsWith('_') && !isMobXCandidate) return;

    // Check for annotations on the class (preceding sibling nodes)
    const classIdx = this.getChildIndex(classNode);
    const parentNode = classNode.parent;
    const annotations = this.getAnnotations(parentNode, classIdx);

    // Determine class type — priority: annotation > superclass > naming convention
    const isBlocClass = superclassName === 'Bloc' || superclassName === 'Cubit';
    const isGetXController = superclassName === 'GetxController' || superclassName === 'GetController';
    const isWidgetClass = superclassName ? DartExtractor.WIDGET_TYPES.includes(superclassName) : false;
    const isServiceClass = DartExtractor.SERVICE_SUFFIXES.some(suffix => className.endsWith(suffix));
    const isFreezed = annotations.includes('freezed');
    const isJsonSerializable = annotations.includes('JsonSerializable');
    const isEntity = annotations.includes('Entity');
    const isModel = isFreezed || isJsonSerializable || isEntity;
    const isRestApi = annotations.includes('RestApi');
    const isDatabase = annotations.includes('Database') || annotations.includes('DriftDatabase');
    const isDao = annotations.includes('dao');
    const isInjectable = annotations.includes('injectable') || annotations.includes('singleton') || annotations.includes('module');
    const isMobXStore = classNode.text.includes('with Store');

    // Skip unrecognized classes
    if (!isBlocClass && !isGetXController && !isWidgetClass && !isServiceClass && !isModel && !isRestApi && !isDatabase && !isDao && !isInjectable && !isMobXStore) return;

    let nodeType: NodeType;
    if (isBlocClass) nodeType = NodeType.Bloc;
    else if (isWidgetClass) nodeType = NodeType.Component;
    else if (isModel) nodeType = NodeType.Model;
    else nodeType = NodeType.Service;

    // For MobX stores: use public name (strip _ prefix)
    const displayName = isMobXCandidate ? className.substring(1) : className;
    const classId = generateNodeId(relFile, displayName, line);

    // Build metadata from annotations and patterns
    const meta: Record<string, string> = {};
    if (isInjectable) {
      meta.di = annotations.includes('singleton') ? 'singleton' : annotations.includes('module') ? 'module' : 'injectable';
    }
    if (isMobXStore) {
      meta.pattern = 'mobx';
      // Record @observable and @computed fields
      const bodyText = classNode.text;
      const observables = bodyText.match(/@observable\s+\w+/g);
      const computeds = bodyText.match(/@computed\s+/g);
      if (observables) meta.observables = String(observables.length);
      if (computeds) meta.computeds = String(computeds.length);
    }
    if (isFreezed) meta.codegen = 'freezed';
    if (isJsonSerializable) meta.codegen = 'json_serializable';
    if (isGetXController) {
      meta.pattern = 'getx';
      // Record .obs reactive variables
      const bodyText = classNode.text;
      const obsVars = bodyText.match(/\.obs\b/g);
      if (obsVars) meta.observables = String(obsVars.length);
    }
    if (isDao) meta.pattern = 'dao';
    if (isDatabase) meta.pattern = 'database';

    // Extract implements clause — create edge from interface → implementation
    const interfacesNode = this.findChild(classNode, 'interfaces');
    if (interfacesNode) {
      const implType = this.findChild(interfacesNode, 'type_identifier');
      if (implType) {
        meta.implements = implType.text;
        // Edge: interface → this class (so upstream trace follows interface → impl)
        edges.push({
          source: implType.text,
          target: classId,
          type: EdgeType.Calls,
          protocol: Protocol.Internal,
          metadata: { relationship: 'implements' },
        });
      }
    }
    // Also link extends (non-Widget/Bloc) for abstract → concrete chains
    if (superclassName && !isBlocClass && !isWidgetClass && !isGetXController
      && superclassName !== 'Object' && superclassName !== 'Store') {
      edges.push({
        source: superclassName,
        target: classId,
        type: EdgeType.Calls,
        protocol: Protocol.Internal,
        metadata: { relationship: 'extends' },
      });
    }

    nodes.push({
      id: classId,
      name: displayName,
      type: nodeType,
      language: Language.Dart,
      file: relFile,
      line,
      signature: superclassName ? `class ${displayName} extends ${superclassName}` : `class ${displayName}`,
      repo: this.repoName,
      ...(Object.keys(meta).length > 0 ? { metadata: meta } : {}),
    });

    // Extract constructor dependencies: typed parameters create edges to dependency classes
    // Patterns: Constructor(TypeName this.field) or Constructor({required TypeName field})
    this.extractConstructorDeps(classNode, classId, edges);

    // Extract public methods and call edges from class body
    const body = this.findChild(classNode, 'class_body');
    if (!body) return;

    // For Retrofit: extract annotated method URLs as REST edges
    if (isRestApi) {
      this.extractRetrofitMethods(classNode, className, classId, relFile, nodes, edges, annotations);
    }

    for (let i = 0; i < body.childCount; i++) {
      const member = body.child(i)!;

      if (member.type === 'method_signature') {
        // Skip model classes — don't extract fromJson/toJson as separate nodes
        if (!isModel) {
          this.extractMethod(member, classNode, displayName, classId, relFile, nodes, edges);
        }
      }

      // For BLoC/Cubit, Widgets, GetX, MobX: extract dependency calls from method bodies
      if ((isBlocClass || isWidgetClass || isGetXController || isMobXStore) && member.type === 'function_body') {
        this.extractCallEdgesFromBody(member, classId, relFile, edges);
      }

      // For DAO: extract Entity references from method return types (e.g., Future<List<BookingEntity>>)
      if (isDao && (member.type === 'method_signature' || member.type === 'declaration')) {
        const sigText = member.text;
        const entityRefs = sigText.match(/(\w+Entity)\b/g);
        if (entityRefs) {
          const methodNode = nodes[nodes.length - 1]; // Last added node is the method
          for (const entityName of new Set(entityRefs)) {
            edges.push({
              source: methodNode?.id || classId,
              target: entityName,
              type: EdgeType.Calls,
              protocol: Protocol.Internal,
              metadata: { relationship: 'dao-entity' },
            });
          }
        }
      }
    }
  }

  private extractMethod(
    sigNode: ReturnType<typeof parseSource>['rootNode'],
    _classNode: ReturnType<typeof parseSource>['rootNode'],
    className: string,
    classId: string,
    relFile: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    // method_signature contains function_signature which has the identifier
    const funcSig = this.findChild(sigNode, 'function_signature') ?? sigNode;
    const nameNode = this.findChild(funcSig, 'identifier');
    if (!nameNode) return;

    const methodName = nameNode.text;

    // Skip private methods (start with _)
    if (methodName.startsWith('_')) return;

    // Skip constructors (name matches class name)
    if (methodName === className) return;

    const line = sigNode.startPosition.row + 1;
    const signature = sigNode.text.trim();
    const methodId = generateNodeId(relFile, `${className}.${methodName}`, line);

    nodes.push({
      id: methodId,
      name: `${className}.${methodName}`,
      type: NodeType.Function,
      language: Language.Dart,
      file: relFile,
      line,
      signature,
      repo: this.repoName,
    });

    // Create edge from class to method
    edges.push({
      source: classId,
      target: methodId,
      type: EdgeType.Calls,
      protocol: Protocol.Internal,
    });
  }

  private extractTopLevelFunction(
    sigNode: ReturnType<typeof parseSource>['rootNode'],
    relFile: string,
    nodes: GraphNode[],
  ): void {
    const nameNode = this.findChild(sigNode, 'identifier');
    if (!nameNode) return;

    const funcName = nameNode.text;

    // Skip private top-level functions
    if (funcName.startsWith('_')) return;

    const line = sigNode.startPosition.row + 1;
    const signature = sigNode.text.trim();

    nodes.push({
      id: generateNodeId(relFile, funcName, line),
      name: funcName,
      type: NodeType.Function,
      language: Language.Dart,
      file: relFile,
      line,
      signature,
      repo: this.repoName,
    });
  }

  private extractProviderDeclaration(
    declList: ReturnType<typeof parseSource>['rootNode'],
    relFile: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    const decl = this.findChild(declList, 'static_final_declaration');
    if (!decl) return;

    // Find provider name (first identifier) and check if RHS is a provider type
    const nameNode = this.findChild(decl, 'identifier');
    if (!nameNode) return;

    const providerName = nameNode.text;

    // Check if RHS is a provider type
    // Case 1: StateNotifierProvider<...>(...) — parsed as identifier + selector
    // Case 2: Provider<T>(...) — parsed as relational_expression
    const identifiers: string[] = [];
    for (let i = 0; i < decl.childCount; i++) {
      if (decl.child(i)!.type === 'identifier') identifiers.push(decl.child(i)!.text);
    }
    const providerType = identifiers.length >= 2 ? identifiers[1] : null;
    const isProviderByType = providerType ? DartExtractor.PROVIDER_TYPES.includes(providerType) : false;
    const isProviderByRelational = this.checkRelationalProvider(decl);

    if (!isProviderByType && !isProviderByRelational) return;

    const line = decl.startPosition.row + 1;
    const providerId = generateNodeId(relFile, providerName, line);

    nodes.push({
      id: providerId,
      name: providerName,
      type: NodeType.Service,
      language: Language.Dart,
      file: relFile,
      line,
      signature: `final ${providerName}`,
      repo: this.repoName,
    });

    // Extract ref.watch/ref.read calls from the provider body
    this.extractRefCalls(decl, providerId, edges);
  }

  private checkRelationalProvider(
    decl: ReturnType<typeof parseSource>['rootNode'],
  ): boolean {
    // When Provider<T> is parsed, it becomes a relational_expression
    // containing an identifier "Provider" or similar
    for (let i = 0; i < decl.childCount; i++) {
      const child = decl.child(i)!;
      if (child.type === 'relational_expression') {
        // Check nested for provider type identifier
        const text = child.text;
        return DartExtractor.PROVIDER_TYPES.some(pt => text.startsWith(pt));
      }
    }
    return false;
  }

  private extractRiverpodAnnotatedFunction(
    sigNode: ReturnType<typeof parseSource>['rootNode'],
    bodyNode: ReturnType<typeof parseSource>['rootNode'] | null,
    relFile: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    const nameNode = this.findChild(sigNode, 'identifier');
    if (!nameNode) return;

    const funcName = nameNode.text;
    // Code-gen naming convention: function "booking" → provider "bookingProvider"
    const providerName = `${funcName}Provider`;

    const line = sigNode.startPosition.row + 1;
    const providerId = generateNodeId(relFile, providerName, line);

    nodes.push({
      id: providerId,
      name: providerName,
      type: NodeType.Service,
      language: Language.Dart,
      file: relFile,
      line,
      signature: `@riverpod ${sigNode.text.trim()}`,
      repo: this.repoName,
    });

    // Extract ref.watch/ref.read from the function body
    if (bodyNode?.type === 'function_body') {
      this.extractRefCalls(bodyNode, providerId, edges);
    }
  }

  private extractRefCalls(
    node: ReturnType<typeof parseSource>['rootNode'],
    sourceId: string,
    edges: GraphEdge[],
  ): void {
    // Use regex on the node text to find ref.watch(provider) and ref.read(provider) patterns
    const text = node.text;
    const seen = new Set<string>();
    const refPattern = /ref\.(watch|read)\((\w+)\)/g;
    let match;

    while ((match = refPattern.exec(text)) !== null) {
      const refMethod = match[1];
      const providerRef = match[2];
      if (!seen.has(providerRef)) {
        seen.add(providerRef);
        edges.push({
          source: sourceId,
          target: providerRef,
          type: EdgeType.Calls,
          protocol: Protocol.Internal,
          metadata: { refMethod, provider: providerRef },
        });
      }
    }
  }

  /** Extract constructor parameter types as dependency edges.
   * Pattern: class Bloc(TypeName this.field) or class Bloc({required TypeName field})
   * Creates calls edges from this class to dependency type names. */
  private extractConstructorDeps(
    classNode: ReturnType<typeof parseSource>['rootNode'],
    classId: string,
    edges: GraphEdge[],
  ): void {
    // Get the class name to match constructors specifically
    const nameNode = classNode.childForFieldName('name') ?? this.findChild(classNode, 'identifier');
    if (!nameNode) return;
    const clsName = nameNode.text.replace(/^_/, '');

    // Search the class body for constructor declarations only
    const body = this.findChild(classNode, 'class_body');
    if (!body) return;

    const seen = new Set<string>();

    // Look for constructor declarations (type=declaration with constructor_signature)
    for (let i = 0; i < body.childCount; i++) {
      const member = body.child(i)!;
      if (member.type !== 'declaration' && member.type !== 'method_signature') continue;

      const text = member.text;
      // Must start with class name (constructor) — handle both ClassName(...) and _ClassName(...)
      if (!text.startsWith(clsName) && !text.startsWith('_' + clsName)) continue;

      const params = text;

      // Extract PascalCase type names from parameters
      // Match "TypeName this.field" or "required TypeName field" or just "TypeName field"
      const typeRe = /(?:required\s+)?([A-Z]\w+)\s+(?:this\.)?\w+/g;
      let typeMatch;
      while ((typeMatch = typeRe.exec(params)) !== null) {
        addDep(typeMatch[1]);
      }
    }

    // Also scan field declarations: "final TypeName fieldName;" or "TypeName fieldName;"
    // These are often the types for constructor parameters using "this.fieldName"
    for (let i = 0; i < body.childCount; i++) {
      const member = body.child(i)!;
      if (member.type === 'declaration') {
        const text = member.text;
        // Match "final TypeName fieldName", "late TypeName fieldName", or bare "TypeName fieldName"
        // Note: tree-sitter splits "TypeName field;" into declaration text "TypeName field" (no semicolon)
        const fieldRe = /(?:final\s+|late\s+)?([A-Z]\w+)\s+(\w+)\s*$/;
        const fm = text.match(fieldRe);
        if (fm && fm[2] !== 'extends' && fm[2] !== 'implements' && fm[2] !== 'with') {
          addDep(fm[1]);
        }
      }
    }

    function addDep(typeName: string) {
      const skipTypes = ['String', 'int', 'double', 'bool', 'List', 'Map', 'Set', 'Future', 'Stream',
        'Key', 'Widget', 'BuildContext', 'Function', 'Object', 'dynamic', 'VoidCallback',
        'Duration', 'DateTime', 'Color', 'TextStyle', 'Locale', 'GlobalKey', 'State',
        'AnimationController', 'ScrollController', 'TextEditingController', 'FocusNode',
        'Timer', 'Completer', 'StreamSubscription', 'ValueNotifier', 'ChangeNotifier'];
      if (skipTypes.includes(typeName) || seen.has(typeName)) return;
      seen.add(typeName);
      edges.push({
        source: classId,
        target: typeName,
        type: EdgeType.Calls,
        protocol: Protocol.Internal,
        metadata: { relationship: 'constructor-dep' },
      });
    }
  }

  private extractRetrofitMethods(
    classNode: ReturnType<typeof parseSource>['rootNode'],
    className: string,
    classId: string,
    relFile: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    classAnnotations: string[],
  ): void {
    // Get annotation + class text (annotation is a preceding sibling, not part of classNode.text)
    const parentNode = classNode.parent;
    const classIdx = this.getChildIndex(classNode);
    let annotationText = '';
    if (parentNode && classIdx > 0) {
      const prev = parentNode.child(classIdx - 1);
      if (prev && (prev.type === 'annotation' || prev.type === 'marker_annotation')) {
        annotationText = prev.text;
      }
    }

    // Extract baseUrl from @RestApi(baseUrl: '/api')
    const classText = annotationText + '\n' + classNode.text;
    const baseUrlMatch = classText.match(/@RestApi\s*\([^)]*baseUrl:\s*'([^']+)'/);
    const baseUrl = baseUrlMatch ? baseUrlMatch[1] : '';

    // Find HTTP method annotations: @GET('/path'), @POST('/path'), etc.
    const methodRe = /@(GET|POST|PUT|DELETE|PATCH)\s*\(\s*'([^']+)'\s*\)/g;
    let match;
    while ((match = methodRe.exec(classText)) !== null) {
      const httpMethod = match[1];
      let urlPath = match[2];

      // Combine baseUrl + method path
      if (baseUrl && !urlPath.startsWith('/')) {
        urlPath = baseUrl + '/' + urlPath;
      } else if (baseUrl && urlPath.startsWith('/')) {
        urlPath = baseUrl + urlPath;
      }

      // Normalize {param} to :param
      urlPath = urlPath.replace(/\{(\w+)\}/g, ':$1');

      const line = classNode.startPosition.row + classText.substring(0, match.index).split('\n').length;
      const methodId = generateNodeId(relFile, `${className}.${httpMethod}:${urlPath}`, line);

      nodes.push({
        id: methodId,
        name: `${httpMethod} ${urlPath}`,
        type: NodeType.Handler,
        language: Language.Dart,
        file: relFile,
        line,
        signature: `@${httpMethod}('${urlPath}')`,
        repo: this.repoName,
      });

      // Create a routes-to edge: viewer renders virtual route node between class and handler
      // Also enables cross-language matching via graph-builder
      edges.push({
        source: classId,
        target: methodId,
        type: EdgeType.RoutesTo,
        protocol: Protocol.REST,
        metadata: { method: httpMethod, path: urlPath },
      });
    }
  }

  private extractCallEdgesFromBody(
    bodyNode: ReturnType<typeof parseSource>['rootNode'],
    sourceId: string,
    _relFile: string,
    edges: GraphEdge[],
  ): void {
    // Walk the body looking for "identifier.method()" patterns
    // These represent dependency calls like repository.getBookings()
    const seen = new Set<string>();
    this.walkForCalls(bodyNode, sourceId, edges, seen);
  }

  private walkForCalls(
    node: ReturnType<typeof parseSource>['rootNode'],
    sourceId: string,
    edges: GraphEdge[],
    seen: Set<string>,
  ): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;

      // Pattern: identifier followed by selector with .methodName
      // e.g., repository.getBookings()
      if (child.type === 'identifier') {
        const next = node.child(i + 1);
        if (next && next.type === 'selector') {
          const assignable = this.findChild(next, 'unconditional_assignable_selector');
          if (assignable) {
            const methodIdNode = this.findChild(assignable, 'identifier');
            if (methodIdNode) {
              const receiverName = child.text;
              const methodName = methodIdNode.text;
              const callKey = `${receiverName}.${methodName}`;

              // Skip self-calls, framework calls, and already-seen
              const skipReceivers = ['emit', 'on', 'super', 'setState', 'Navigator', 'BlocProvider', 'context', 'Get', 'GetIt', 'print'];
              if (!seen.has(callKey) && !skipReceivers.includes(receiverName)) {
                seen.add(callKey);
                edges.push({
                  source: sourceId,
                  target: callKey, // Placeholder — resolved during graph building
                  type: EdgeType.Calls,
                  protocol: Protocol.Internal,
                  metadata: { receiver: receiverName, method: methodName },
                });
              }
            }
          }
        }
      }

      this.walkForCalls(child, sourceId, edges, seen);
    }
  }

  private findChild(
    node: ReturnType<typeof parseSource>['rootNode'],
    type: string,
  ): ReturnType<typeof parseSource>['rootNode'] | null {
    for (let i = 0; i < node.childCount; i++) {
      if (node.child(i)!.type === type) return node.child(i);
    }
    return null;
  }

  getFrameworkInfo(): DartFrameworkInfo {
    return { ...this.framework };
  }
}
