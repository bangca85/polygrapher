import fs from 'node:fs';
import path from 'node:path';
import type { SystemMap } from '../types/graph.types.js';
import { parseGoMod, getGitContext } from '../scanner/tech-stack-detector.js';
import type { TechStackInfo, GitContext } from '../scanner/tech-stack-detector.js';

function safeWriteFile(filePath: string, content: string): void {
  // M-3 security fix: refuse to write if target is a symlink
  if (fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()) {
    throw new Error(`Refusing to write to symlink: ${filePath}`);
  }
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function exportMarkdown(systemMap: SystemMap, outputDir: string, targetPath?: string): string {
  const outputPath = path.join(outputDir, 'system-map.md');
  const techStack = targetPath ? parseGoMod(targetPath) : null;
  const gitCtx = targetPath ? getGitContext(targetPath) : null;
  const md = generateMarkdown(systemMap, techStack, gitCtx);
  safeWriteFile(outputPath, md);
  return outputPath;
}

function generateMarkdown(map: SystemMap, techStack: TechStackInfo | null, gitCtx: GitContext | null): string {
  const lines: string[] = [];

  // ── Header ──────────────────────────────────────────────────────
  lines.push(`# System Map: ${map.meta.repo}`);
  lines.push('');
  lines.push(`Generated: ${map.meta.generatedAt}`);
  lines.push(`Languages: ${map.meta.languages.join(', ')}`);
  lines.push(`Nodes: ${map.nodes.length} | Edges: ${map.edges.length}`);

  if (gitCtx) {
    lines.push(`Branch: ${gitCtx.branch}`);
    lines.push(`Commit: \`${gitCtx.commitHash}\` — "${gitCtx.commitMessage}"`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  // ── Tech Stack ──────────────────────────────────────────────────
  if (techStack) {
    lines.push('## Tech Stack');
    lines.push('');

    lines.push('### Language & Runtime');
    if (techStack.goVersion) {
      lines.push(`- **Go** ${techStack.goVersion} (from go.mod)`);
    }
    if (techStack.modulePath) {
      lines.push(`- Module: \`${techStack.modulePath}\``);
    }
    lines.push('');

    if (techStack.dependencies.length > 0) {
      lines.push('### Dependencies');
      lines.push('| Package | Version | Category |');
      lines.push('|---------|---------|----------|');
      for (const dep of techStack.dependencies) {
        lines.push(`| ${dep.package} | ${dep.version} | ${dep.category} |`);
      }
      lines.push('');
    }
  }

  // ── Architecture Summary ────────────────────────────────────────
  const counts = {
    functions: 0,
    handlers: 0,
    grpc: 0,
    structs: 0,
    workers: 0,
    restRoutes: 0,
    grpcEndpoints: 0,
    callRelationships: 0,
  };

  for (const node of map.nodes) {
    switch (node.type) {
      case 'function': counts.functions++; break;
      case 'handler': counts.handlers++; break;
      case 'grpc': counts.grpc++; break;
      case 'struct': counts.structs++; break;
      case 'worker': counts.workers++; break;
    }
  }

  for (const edge of map.edges) {
    if (edge.type === 'routes-to') counts.restRoutes++;
    if (edge.type === 'calls') counts.callRelationships++;
  }
  counts.grpcEndpoints = counts.grpc;

  lines.push('## Architecture Summary');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Functions | ${counts.functions} |`);
  lines.push(`| HTTP Handlers | ${counts.handlers} |`);
  lines.push(`| gRPC Endpoints | ${counts.grpcEndpoints} |`);
  lines.push(`| Workers | ${counts.workers} |`);
  lines.push(`| Structs | ${counts.structs} |`);
  lines.push(`| REST Routes | ${counts.restRoutes} |`);
  lines.push(`| Call Relationships | ${counts.callRelationships} |`);
  lines.push('');

  // ── Detected Patterns ───────────────────────────────────────────
  const patterns: string[] = [];

  if (techStack) {
    const deps = techStack.dependencies;
    const httpFramework = deps.find(d => d.category.startsWith('HTTP Framework'));
    if (httpFramework && counts.handlers > 0) {
      const framework = httpFramework.category.match(/\((.+)\)/)?.[1] || 'Unknown';
      patterns.push(`- HTTP Framework: **${framework}** (${counts.handlers} handlers, ${counts.restRoutes} routes)`);
    }

    const grpcDep = deps.find(d => d.category.includes('gRPC'));
    if (grpcDep && counts.grpc > 0) {
      patterns.push(`- gRPC: **${counts.grpc} endpoints**`);
    } else if (counts.grpc > 0) {
      patterns.push(`- gRPC: **${counts.grpc} endpoints** (detected from code)`);
    }

    const dbDeps = deps.filter(d => d.category.startsWith('Database') || d.category.startsWith('ORM'));
    for (const db of dbDeps) {
      patterns.push(`- Database: ${db.category}`);
    }

    const cacheDeps = deps.filter(d => d.category.startsWith('Cache'));
    for (const cache of cacheDeps) {
      patterns.push(`- Cache: ${cache.category}`);
    }

    const mqDeps = deps.filter(d => d.category.startsWith('Message Queue'));
    for (const mq of mqDeps) {
      patterns.push(`- Message Queue: ${mq.category}`);
    }

    if (counts.workers > 0) {
      patterns.push(`- Workers: **${counts.workers}** background consumers`);
    }
  } else {
    // No go.mod but still have graph data
    if (counts.handlers > 0) patterns.push(`- HTTP Handlers: ${counts.handlers}`);
    if (counts.grpc > 0) patterns.push(`- gRPC Endpoints: ${counts.grpc}`);
    if (counts.workers > 0) patterns.push(`- Workers: ${counts.workers}`);
  }

  if (patterns.length > 0) {
    lines.push('### Detected Patterns');
    lines.push(...patterns);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // ── Functions (existing) ────────────────────────────────────────
  const byFile = new Map<string, typeof map.nodes>();
  for (const node of map.nodes) {
    const group = byFile.get(node.file) || [];
    group.push(node);
    byFile.set(node.file, group);
  }

  lines.push('## Functions');
  lines.push('');

  for (const [file, nodes] of byFile) {
    lines.push(`### ${file}`);
    lines.push('');
    for (const node of nodes) {
      lines.push(`- **${node.name}** (${node.file}:${node.line}) — ${node.type}`);
      if (node.signature) {
        lines.push(`  \`${node.signature}\``);
      }
    }
    lines.push('');
  }

  // ── Connections (existing) ──────────────────────────────────────
  if (map.edges.length > 0) {
    lines.push('## Connections');
    lines.push('');

    const idToName = new Map(map.nodes.map(n => [n.id, n.name]));

    for (const edge of map.edges) {
      const sourceName = idToName.get(edge.source) || edge.source;
      const targetName = idToName.get(edge.target) || edge.target;
      const meta = edge.metadata
        ? ` [${Object.entries(edge.metadata).map(([k, v]) => `${k}: ${v}`).join(', ')}]`
        : '';
      lines.push(`- ${sourceName} -> ${targetName} (${edge.type})${meta}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
