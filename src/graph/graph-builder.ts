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

  return {
    meta,
    nodes: Array.from(nodeMap.values()),
    edges: allEdges,
  };
}
