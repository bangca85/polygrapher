import type { ExtractorResult } from '../types/extractor.types.js';
import type { SystemMap, MapMeta } from '../types/graph.types.js';

export function buildGraph(
  results: ExtractorResult[],
  meta: MapMeta
): SystemMap {
  const nodeMap = new Map<string, (typeof results)[0]['nodes'][0]>();
  const allEdges = [];
  const allErrors = [];

  for (const result of results) {
    for (const node of result.nodes) {
      // Deduplicate by node ID
      if (!nodeMap.has(node.id)) {
        nodeMap.set(node.id, node);
      }
    }
    allEdges.push(...result.edges);
    allErrors.push(...result.errors);
  }

  // Cross-language matching: resolve REST call URL targets to route handler nodes
  // Build route path → handler node ID index from routes-to edges
  const routePathToHandler = new Map<string, string>();
  for (const edge of allEdges) {
    if (edge.type === 'routes-to' && edge.metadata?.path) {
      // Index by full path (e.g. "/api/booking", "/v1/users/:id")
      routePathToHandler.set(edge.metadata.path, edge.target);
      // Also index method-specific: "GET /api/booking"
      if (edge.metadata.method) {
        routePathToHandler.set(`${edge.metadata.method} ${edge.metadata.path}`, edge.target);
      }
    }
  }

  // Resolve REST call edges: if URL matches a known route, point edge target to handler
  // Supports exact match, prefix-stripped partial match, and unresolved marking
  const resolvedEdges = allEdges.map(edge => {
    if (edge.type === 'calls' && edge.protocol === 'REST' && edge.metadata?.path) {
      const urlPath = edge.metadata.path;
      const method = edge.metadata.method;

      // Try exact match (method-specific first, then path-only)
      const methodSpecific = method ? routePathToHandler.get(`${method} ${urlPath}`) : null;
      if (methodSpecific) {
        return { ...edge, target: methodSpecific, matchConfidence: 'exact' as const };
      }

      const pathOnly = routePathToHandler.get(urlPath);
      if (pathOnly) {
        return { ...edge, target: pathOnly, matchConfidence: 'exact' as const };
      }

      // Try partial match: strip common prefixes (/api, /api/v1, /api/v2, etc.)
      const prefixes = ['/api', '/api/v1', '/api/v2', '/api/v3'];
      for (const prefix of prefixes) {
        if (urlPath.startsWith(prefix)) {
          const stripped = urlPath.substring(prefix.length) || '/';
          const strippedMethodMatch = method ? routePathToHandler.get(`${method} ${stripped}`) : null;
          if (strippedMethodMatch) {
            return { ...edge, target: strippedMethodMatch, matchConfidence: 'partial' as const };
          }
          const strippedPathMatch = routePathToHandler.get(stripped);
          if (strippedPathMatch) {
            return { ...edge, target: strippedPathMatch, matchConfidence: 'partial' as const };
          }
        }
      }

      // Try inferred match: parameterized path matching
      // e.g., /api/users/123 matches route /api/users/:id
      for (const [routePath, handlerId] of routePathToHandler.entries()) {
        if (routePath.includes(':')) {
          // Convert route pattern to regex: /users/:id → /users/[^/]+
          const routeRegex = new RegExp('^' + routePath.replace(/:[^/]+/g, '[^/]+') + '$');
          if (routeRegex.test(urlPath)) {
            return { ...edge, target: handlerId, matchConfidence: 'inferred' as const };
          }
        }
      }

      // No match found — mark as unresolved
      return { ...edge, matchConfidence: 'none' as const };
    }
    return edge;
  });

  return {
    meta,
    nodes: Array.from(nodeMap.values()),
    edges: resolvedEdges,
  };
}
