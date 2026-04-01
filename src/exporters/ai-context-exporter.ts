import fs from 'node:fs';
import path from 'node:path';
import type { SystemMap, GraphNode, GraphEdge } from '../types/graph.types.js';
import { safeWriteFile, collectTechStacks, getGitContext } from './shared.js';
import type { TechStackInfo, GitContext } from './shared.js';

export const MAX_MODULE_NODES = 500;
export const MAX_INDEX_TOKENS = 8_000;
export const MAX_MODULE_TOKENS = 12_000;
const MAX_DEPTH = 5;

/**
 * Build a set of directories that directly contain source files.
 * Used to distinguish "grouping-only" dirs from "real module" dirs.
 */
export function buildDirsWithFiles(allFilePaths: string[]): Set<string> {
  const dirs = new Set<string>();
  for (const fp of allFilePaths) {
    const segments = fp.split('/');
    if (segments.length > 1) {
      dirs.add(segments.slice(0, -1).join('/'));
    }
  }
  return dirs;
}

/**
 * Find the module key for a file.
 *
 * Strategy: if the file's immediate parent has files, use it (most specific
 * grouping). Otherwise, walk from root to find the shallowest ancestor
 * that has files — this groups descendant files under the first meaningful
 * boundary (e.g., Flutter lib/features/booking groups bloc/ and ui/ subdirs
 * when those subdirs have no sibling files at the feature level).
 *
 * This naturally handles:
 * - NestJS: src/booking/ctrl.ts → src/booking (parent has files)
 * - NestJS root: src/app.module.ts → src (parent has files)
 * - Flutter feature: lib/features/booking/bloc/bloc.dart →
 *     lib/features/booking (parent bloc/ has files, but walk from root
 *     finds booking/ first since bloc/ parent is NOT grouping-only)
 *
 * The small-module merge (≤ 3 nodes) handles cases where immediate-parent
 * grouping creates tiny modules.
 */
export function getModuleKey(filePath: string, dirsWithFiles: Set<string>): string {
  const segments = filePath.split('/');
  if (segments.length <= 1) return '(root)';

  const dirs = segments.slice(0, -1); // remove filename
  const fileParent = dirs.join('/');

  // Primary: if file's immediate parent has files, use it (capped at MAX_DEPTH)
  if (dirsWithFiles.has(fileParent)) {
    if (dirs.length <= MAX_DEPTH) {
      return fileParent;
    }
    // Parent exceeds MAX_DEPTH — fall through to walk from root
  }

  // File's parent is grouping-only. Walk from root to find shallowest real dir.
  for (let depth = 1; depth <= Math.min(dirs.length, MAX_DEPTH); depth++) {
    const candidate = dirs.slice(0, depth).join('/');
    if (dirsWithFiles.has(candidate)) {
      return candidate;
    }
  }

  // Fallback: cap at MAX_DEPTH
  return dirs.slice(0, MAX_DEPTH).join('/');
}

/**
 * Convert module key to collision-free filename.
 * "/" → "--", "(root)" → "_root"
 */
export function slugifyModuleKey(moduleKey: string): string {
  if (moduleKey === '(root)') return '_root';
  return moduleKey.replace(/\//g, '--');
}

/**
 * Group nodes into modules, merge small modules, then split oversized ones.
 */
export function groupNodesByModule(
  nodes: GraphNode[],
  dirsWithFiles: Set<string>
): Map<string, GraphNode[]> {
  // Initial grouping
  const modules = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const key = getModuleKey(node.file, dirsWithFiles);
    const group = modules.get(key) || [];
    group.push(node);
    modules.set(key, group);
  }

  // Split oversized modules
  const split = splitOversizedModules(modules, 0);

  // Merge small modules (≤ 3 nodes) into nearest parent
  return mergeSmallModules(split);
}

function splitOversizedModules(
  modules: Map<string, GraphNode[]>,
  currentRecursion: number
): Map<string, GraphNode[]> {
  if (currentRecursion >= MAX_DEPTH) return modules;

  const result = new Map<string, GraphNode[]>();
  let didSplit = false;

  for (const [key, nodes] of modules) {
    const currentDepth = key === '(root)' ? 0 : key.split('/').length;

    // Don't split if we'd exceed MAX_DEPTH in absolute path depth
    if (nodes.length > MAX_MODULE_NODES && currentDepth < MAX_DEPTH) {
      didSplit = true;
      const subModules = new Map<string, GraphNode[]>();
      for (const node of nodes) {
        const segments = node.file.split('/');
        const dirs = segments.slice(0, -1);
        const newDepth = Math.min(currentDepth + 1, dirs.length, MAX_DEPTH);
        const newKey = newDepth === 0 ? '(root)' : dirs.slice(0, newDepth).join('/');
        const finalKey = newKey === key ? key : newKey;
        const group = subModules.get(finalKey) || [];
        group.push(node);
        subModules.set(finalKey, group);
      }
      for (const [subKey, subNodes] of subModules) {
        result.set(subKey, subNodes);
      }
    } else {
      result.set(key, nodes);
    }
  }

  if (didSplit) {
    return splitOversizedModules(result, currentRecursion + 1);
  }
  return result;
}

function mergeSmallModules(
  modules: Map<string, GraphNode[]>
): Map<string, GraphNode[]> {
  const smallKeys: string[] = [];
  for (const [key, nodes] of modules) {
    if (nodes.length <= 3) {
      smallKeys.push(key);
    }
  }

  for (const key of smallKeys) {
    const nodes = modules.get(key)!;
    // Find nearest parent module
    const segments = key === '(root)' ? [] : key.split('/');
    let merged = false;

    for (let depth = segments.length - 1; depth >= 1; depth--) {
      const parentKey = segments.slice(0, depth).join('/');
      if (modules.has(parentKey) && parentKey !== key) {
        modules.get(parentKey)!.push(...nodes);
        modules.delete(key);
        merged = true;
        break;
      }
    }

    if (!merged && key !== '(root)') {
      // Merge into (root)
      const rootNodes = modules.get('(root)') || [];
      rootNodes.push(...nodes);
      modules.set('(root)', rootNodes);
      modules.delete(key);
    }
  }

  return modules;
}

/**
 * Build a map from node ID → module key for edge classification.
 */
export function buildNodeModuleMap(
  modules: Map<string, GraphNode[]>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [moduleKey, nodes] of modules) {
    for (const node of nodes) {
      map.set(node.id, moduleKey);
    }
  }
  return map;
}

/**
 * Categorized edges for a module: internal, outgoing, incoming, unresolved.
 */
export interface ModuleEdges {
  internal: GraphEdge[];
  outgoing: { edge: GraphEdge; targetModule: string }[];
  incoming: { edge: GraphEdge; sourceModule: string }[];
  unresolved: GraphEdge[];
}

/**
 * Categorize all edges relative to a specific module.
 */
export function categorizeEdges(
  moduleKey: string,
  edges: GraphEdge[],
  nodeModuleMap: Map<string, string>,
  dirsWithFiles?: Set<string>
): ModuleEdges {
  const result: ModuleEdges = { internal: [], outgoing: [], incoming: [], unresolved: [] };

  for (const edge of edges) {
    const sourceModule = nodeModuleMap.get(edge.source);
    const targetModule = nodeModuleMap.get(edge.target);

    if (sourceModule === moduleKey && targetModule === moduleKey) {
      result.internal.push(edge);
    } else if (sourceModule === moduleKey && targetModule !== undefined) {
      result.outgoing.push({ edge, targetModule: targetModule! });
    } else if (targetModule === moduleKey && sourceModule !== undefined) {
      result.incoming.push({ edge, sourceModule: sourceModule! });
    } else if (sourceModule === moduleKey && targetModule === undefined) {
      // Target doesn't resolve — unresolved external reference
      result.unresolved.push(edge);
    } else if (sourceModule === undefined || targetModule === undefined) {
      // One side doesn't resolve — try fallback via metadata.sourceFile
      const fallbackSource = sourceModule ?? (
        edge.metadata?.sourceFile && dirsWithFiles
          ? getModuleKey(edge.metadata.sourceFile, dirsWithFiles)
          : undefined
      );

      if (fallbackSource === undefined) continue; // can't determine source module

      if (fallbackSource === moduleKey && targetModule === undefined) {
        result.unresolved.push(edge);
      } else if (fallbackSource === moduleKey && targetModule !== undefined && targetModule !== moduleKey) {
        result.outgoing.push({ edge, targetModule });
      } else if (targetModule === moduleKey && fallbackSource !== moduleKey) {
        result.incoming.push({ edge, sourceModule: fallbackSource });
      } else if (fallbackSource === moduleKey && targetModule === moduleKey) {
        result.internal.push(edge);
      }
    }
  }

  return result;
}

/**
 * Get internal edges for a module (backward compat helper).
 */
export function getInternalEdges(
  moduleKey: string,
  edges: GraphEdge[],
  nodeModuleMap: Map<string, string>
): GraphEdge[] {
  return categorizeEdges(moduleKey, edges, nodeModuleMap).internal;
}

/**
 * Estimate token count from content string.
 * Conservative heuristic: 1 token ≈ 4 characters.
 */
export function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

/**
 * Format an edge's relationship label.
 * Priority: metadata.relationship > protocol (non-internal) > edge.type
 */
export function formatRelationship(edge: GraphEdge): string {
  if (edge.metadata?.relationship) {
    return edge.metadata.relationship;
  }
  if (edge.protocol && edge.protocol !== 'internal') {
    return `${edge.type} (${edge.protocol})`;
  }
  return edge.type;
}

/**
 * Generate markdown content for a single module file.
 * If truncateSignatures is true, omits signature lines to reduce token count.
 */
export function generateModuleFile(
  moduleKey: string,
  nodes: GraphNode[],
  moduleEdges: ModuleEdges,
  allNodes: GraphNode[],
  truncateSignatures: boolean = false
): string {
  const lines: string[] = [];
  const idToName = new Map(allNodes.map(n => [n.id, n.name]));

  // Header
  const crossModuleCount = moduleEdges.outgoing.length + moduleEdges.incoming.length;
  lines.push(`# Module: ${moduleKey}`);
  lines.push('');

  const uniqueFiles = new Set(nodes.map(n => n.file));
  lines.push(`Module path: ${moduleKey}`);
  lines.push(`Files: ${uniqueFiles.size} | Nodes: ${nodes.length} | Internal Edges: ${moduleEdges.internal.length} | Cross-module Edges: ${crossModuleCount}`);
  lines.push('');

  if (truncateSignatures) {
    lines.push(`> ⚠️ Large module — ${nodes.length} nodes shown without signatures. See system-map.md for full detail.`);
    lines.push('');
  }

  // Symbols grouped by file
  lines.push('## Symbols');
  lines.push('');

  const byFile = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const group = byFile.get(node.file) || [];
    group.push(node);
    byFile.set(node.file, group);
  }

  for (const [file, fileNodes] of byFile) {
    lines.push(`### ${file}`);
    lines.push('');
    for (const node of fileNodes) {
      lines.push(`- **${node.name}** (${node.file}:${node.line}) — ${node.type}`);
      if (!truncateSignatures && node.signature) {
        lines.push(`  \`${node.signature}\``);
      }
    }
    lines.push('');
  }

  // Internal Connections
  if (moduleEdges.internal.length > 0) {
    lines.push('## Internal Connections');
    lines.push('');
    for (const edge of moduleEdges.internal) {
      const sourceName = idToName.get(edge.source) || edge.source;
      const targetName = idToName.get(edge.target) || edge.target;
      const meta = edge.metadata
        ? ` [${Object.entries(edge.metadata).map(([k, v]) => `${k}: ${v}`).join(', ')}]`
        : '';
      lines.push(`- ${sourceName} → ${targetName} (${edge.type})${meta}`);
    }
    lines.push('');
  }

  // Outgoing Connections
  if (moduleEdges.outgoing.length > 0) {
    lines.push('## Outgoing Connections');
    lines.push('');
    for (const { edge, targetModule } of moduleEdges.outgoing) {
      const sourceName = idToName.get(edge.source) || edge.source;
      const targetName = idToName.get(edge.target) || edge.target;
      lines.push(`- ${sourceName} → ${targetName} (${formatRelationship(edge)}) [to: ${targetModule}]`);
    }
    lines.push('');
  }

  // Incoming Connections
  if (moduleEdges.incoming.length > 0) {
    lines.push('## Incoming Connections');
    lines.push('');
    for (const { edge, sourceModule } of moduleEdges.incoming) {
      const sourceName = idToName.get(edge.source) || edge.source;
      const targetName = idToName.get(edge.target) || edge.target;
      lines.push(`- ${sourceName} → ${targetName} (${formatRelationship(edge)}) [from: ${sourceModule}]`);
    }
    lines.push('');
  }

  // Unresolved External References
  if (moduleEdges.unresolved.length > 0) {
    lines.push('## Unresolved External References');
    lines.push('');
    for (const edge of moduleEdges.unresolved) {
      const sourceName = idToName.get(edge.source) || edge.source;
      const confidence = edge.matchConfidence ? ` [matchConfidence: ${edge.matchConfidence}]` : '';
      lines.push(`- ${sourceName} → ${edge.target} (${edge.type})${confidence}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Get top N node types by count for a module, formatted as "TypeLabel(count)".
 */
function getKeyTypes(nodes: GraphNode[], topN: number = 3): string {
  const typeCounts = new Map<string, number>();
  for (const node of nodes) {
    typeCounts.set(node.type, (typeCounts.get(node.type) || 0) + 1);
  }
  return [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([type, count]) => `${type}(${count})`)
    .join(', ');
}

/**
 * Generate index.md content — AI architecture summary.
 * When compact=true, omits the Module Map table to reduce token count.
 */
export function generateIndex(
  systemMap: SystemMap,
  modules: Map<string, GraphNode[]>,
  targetPath: string,
  compact: boolean = false,
  nodeModuleMap?: Map<string, string>,
  dirsWithFiles?: Set<string>
): string {
  const lines: string[] = [];
  const techStack = collectTechStacks(targetPath);
  const gitCtx = getGitContext(targetPath);

  // Header
  lines.push(`# Project: ${systemMap.meta.repo}`);
  lines.push('');
  const headerParts = [
    `Generated: ${systemMap.meta.generatedAt}`,
    `Languages: ${systemMap.meta.languages.join(', ')}`,
    `Polygrapher: ${systemMap.meta.polygrapher}`,
  ];
  lines.push(headerParts.join(' | '));
  if (gitCtx) {
    lines.push(`Branch: ${gitCtx.branch} | Commit: \`${gitCtx.commitHash}\``);
  }
  lines.push('');

  // Tech Stack
  if (techStack) {
    lines.push('## Tech Stack');
    lines.push('');
    if (techStack.runtimeVersion) {
      lines.push(`- Runtime: ${techStack.runtimeVersion}`);
    }
    if (techStack.modulePath) {
      lines.push(`- Module: \`${techStack.modulePath}\``);
    }
    if (techStack.dependencies.length > 0) {
      lines.push('');
      lines.push('| Package | Version | Category |');
      lines.push('|---------|---------|----------|');
      for (const dep of techStack.dependencies) {
        lines.push(`| ${dep.package} | ${dep.version} | ${dep.category} |`);
      }
    }
    lines.push('');
  }

  // Architecture Overview
  lines.push('## Architecture Overview');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Modules | ${modules.size} |`);
  lines.push(`| Total Nodes | ${systemMap.nodes.length} |`);
  lines.push(`| Total Edges | ${systemMap.edges.length} |`);

  const typeCounts = new Map<string, number>();
  for (const node of systemMap.nodes) {
    typeCounts.set(node.type, (typeCounts.get(node.type) || 0) + 1);
  }
  for (const [type, count] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${type} | ${count} |`);
  }
  lines.push('');

  // Module Map (omitted in compact mode to save tokens)
  if (!compact) {
    lines.push('## Module Map');
    lines.push('');
    lines.push('| Module | Nodes | Key Types | Files |');
    lines.push('|--------|-------|-----------|-------|');
    for (const [moduleKey, nodes] of [...modules.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const uniqueFiles = new Set(nodes.map(n => n.file));
      const keyTypes = getKeyTypes(nodes);
      lines.push(`| ${moduleKey} | ${nodes.length} | ${keyTypes} | ${uniqueFiles.size} |`);
    }
    lines.push('');
  }

  // Cross-Module Dependencies (Story 3.2) — always shown, even in compact mode
  if (nodeModuleMap) {
    const crossModulePairs = new Map<string, { edges: GraphEdge[]; count: number }>();
    let unresolvedCount = 0;

    for (const edge of systemMap.edges) {
      const sourceModule = nodeModuleMap.get(edge.source);
      const targetModule = nodeModuleMap.get(edge.target);

      if (sourceModule && targetModule && sourceModule !== targetModule) {
        const pairKey = `${sourceModule}→${targetModule}`;
        const pair = crossModulePairs.get(pairKey) || { edges: [], count: 0 };
        pair.edges.push(edge);
        pair.count++;
        crossModulePairs.set(pairKey, pair);
      } else if (sourceModule && !targetModule) {
        unresolvedCount++;
      }
    }

    if (crossModulePairs.size > 0 || unresolvedCount > 0) {
      lines.push('## Cross-Module Dependencies');
      lines.push('');

      if (crossModulePairs.size > 0) {
        lines.push('| From | To | Count | Relationship |');
        lines.push('|------|-----|-------|-------------|');

        for (const [pairKey, { edges: pairEdges, count }] of [...crossModulePairs.entries()].sort((a, b) => b[1].count - a[1].count)) {
          const [from, to] = pairKey.split('→');
          const relationship = aggregateRelationship(pairEdges);
          lines.push(`| ${from} | ${to} | ${count} | ${relationship} |`);
        }
      }

      if (unresolvedCount > 0) {
        lines.push('');
        lines.push(`Unresolved external references: ${unresolvedCount} (see module files for details)`);
      }
      lines.push('');
    }
  }

  // Entry Points (Story 3.3)
  if (nodeModuleMap) {
    const entryPoints = detectEntryPoints(systemMap, nodeModuleMap);
    if (entryPoints.length > 0) {
      lines.push('## Entry Points');
      lines.push('');
      const maxEntries = 30;
      const shown = entryPoints.slice(0, maxEntries);
      for (const node of shown) {
        lines.push(`- **${node.name}** (${node.file}:${node.line}) — ${node.type}`);
      }
      if (entryPoints.length > maxEntries) {
        lines.push(`- ... and ${entryPoints.length - maxEntries} more entry points (see module files for complete list)`);
      }
      lines.push('');
    }
  }

  // Module Index with links
  lines.push('## Module Index');
  lines.push('');
  for (const [moduleKey, nodes] of [...modules.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const slug = slugifyModuleKey(moduleKey);
    if (compact) {
      lines.push(`- [${moduleKey}](modules/${slug}.md) — ${nodes.length} nodes`);
    } else {
      const keyTypes = getKeyTypes(nodes);
      lines.push(`- [${moduleKey}](modules/${slug}.md) — ${nodes.length} nodes: ${keyTypes}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Aggregate relationship labels for a set of edges between a module pair.
 * Shows dominant type + secondary types with counts.
 * Example: "calls (REST) +2 imports" not "calls (REST) +2 more"
 */
export function aggregateRelationship(edges: GraphEdge[]): string {
  const counts = new Map<string, number>();
  for (const edge of edges) {
    const label = formatRelationship(edge);
    counts.set(label, (counts.get(label) || 0) + 1);
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 1) return sorted[0][0];

  const dominant = sorted[0][0];
  const others = sorted.slice(1).map(([label, count]) => `${count} ${label}`);
  return `${dominant} +${others.join(', ')}`;
}

/**
 * Detect entry points using extractor-verified criteria.
 * Sorted by: handlers → routes-to targets → grpc → workers → blocs → main
 * Deduplicated by node ID.
 */
function detectEntryPoints(
  systemMap: SystemMap,
  nodeModuleMap: Map<string, string>
): GraphNode[] {
  const entryNodeIds = new Set<string>();
  const entryNodes: GraphNode[] = [];

  const addNode = (node: GraphNode) => {
    if (!entryNodeIds.has(node.id)) {
      entryNodeIds.add(node.id);
      entryNodes.push(node);
    }
  };

  // Priority order for sorting
  const typePriority: Record<string, number> = {
    handler: 1,
    grpc: 3,
    worker: 4,
    bloc: 5,
  };

  // Criterion: node types
  for (const node of systemMap.nodes) {
    if (node.type === 'handler' || node.type === 'grpc' ||
        node.type === 'worker' || node.type === 'bloc') {
      addNode(node);
    }
    if (node.name === 'main' || node.name === 'Main') {
      addNode(node);
    }
  }

  // Criterion: targets of routes-to edges with metadata.path
  const routeTargetIds = new Set<string>();
  for (const edge of systemMap.edges) {
    if (edge.type === 'routes-to' && edge.metadata?.path) {
      routeTargetIds.add(edge.target);
    }
  }
  for (const node of systemMap.nodes) {
    if (routeTargetIds.has(node.id)) {
      addNode(node);
    }
  }

  // Sort: by priority (handlers first), then alphabetically
  return entryNodes.sort((a, b) => {
    const pa = typePriority[a.type] || (a.name === 'main' || a.name === 'Main' ? 6 : 2);
    const pb = typePriority[b.type] || (b.name === 'main' || b.name === 'Main' ? 6 : 2);
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Ensure a directory exists and is not a symlink.
 */
function safeMkdir(dirPath: string): void {
  if (fs.existsSync(dirPath) && fs.lstatSync(dirPath).isSymbolicLink()) {
    throw new Error(`Refusing to write to symlink directory: ${dirPath}`);
  }
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export interface AiContextResult {
  paths: string[];
  warnings: string[];
}

/**
 * Main export function: generates index.md + modules/*.md
 * Returns generated file paths and any token budget warnings.
 */
export function exportAiContext(
  systemMap: SystemMap,
  outputDir: string,
  targetPath: string
): AiContextResult {
  const allFilePaths = systemMap.nodes.map(n => n.file);
  const dirsWithFiles = buildDirsWithFiles(allFilePaths);
  const modules = groupNodesByModule(systemMap.nodes, dirsWithFiles);
  const nodeModuleMap = buildNodeModuleMap(modules);

  const generatedPaths: string[] = [];

  // Create modules/ directory with symlink protection
  const modulesDir = path.join(outputDir, 'modules');
  safeMkdir(modulesDir);

  const warnings: string[] = [];

  // Generate module files with token budget enforcement
  for (const [moduleKey, nodes] of modules) {
    const modEdges = categorizeEdges(moduleKey, systemMap.edges, nodeModuleMap, dirsWithFiles);

    // First pass: full content
    let content = generateModuleFile(moduleKey, nodes, modEdges, systemMap.nodes, false);
    let tokens = estimateTokens(content);

    // If over budget, truncate signatures
    if (tokens > MAX_MODULE_TOKENS) {
      content = generateModuleFile(moduleKey, nodes, modEdges, systemMap.nodes, true);
      tokens = estimateTokens(content);

      // Best-effort: if still over budget after truncation, emit warning
      if (tokens > MAX_MODULE_TOKENS) {
        warnings.push(`Module ${moduleKey}: ${tokens} tokens (budget: ${MAX_MODULE_TOKENS}) — still over budget after signature truncation`);
      }
    }

    const slug = slugifyModuleKey(moduleKey);
    const filePath = path.join(modulesDir, `${slug}.md`);
    safeWriteFile(filePath, content);
    generatedPaths.push(filePath);
  }

  // Generate index.md with token budget enforcement
  let indexContent = generateIndex(systemMap, modules, targetPath, false, nodeModuleMap, dirsWithFiles);
  let indexTokens = estimateTokens(indexContent);

  if (indexTokens > MAX_INDEX_TOKENS) {
    // Compact mode: drop Module Map table, shorten Module Index
    indexContent = generateIndex(systemMap, modules, targetPath, true, nodeModuleMap, dirsWithFiles);
    indexTokens = estimateTokens(indexContent);

    if (indexTokens > MAX_INDEX_TOKENS) {
      warnings.push(`index.md: ${indexTokens} tokens (budget: ${MAX_INDEX_TOKENS}) — still over budget after compaction`);
    }
  }
  const indexPath = path.join(outputDir, 'index.md');
  safeWriteFile(indexPath, indexContent);
  generatedPaths.unshift(indexPath);

  return { paths: generatedPaths, warnings };
}
