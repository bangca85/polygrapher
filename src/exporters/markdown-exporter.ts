import fs from 'node:fs';
import path from 'node:path';
import type { SystemMap } from '../types/graph.types.js';
import { parseGoMod, parsePackageJson, getGitContext } from '../scanner/tech-stack-detector.js';
import type { TechStackInfo, GitContext } from '../scanner/tech-stack-detector.js';

function safeWriteFile(filePath: string, content: string): void {
  // M-3 security fix: refuse to write if target is a symlink
  if (fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()) {
    throw new Error(`Refusing to write to symlink: ${filePath}`);
  }
  fs.writeFileSync(filePath, content, 'utf-8');
}

function collectTechStacks(targetPath: string): TechStackInfo | null {
  // Search root and immediate subdirectories for tech stack files (monorepo support)
  const dirsToScan = [targetPath];
  try {
    const entries = fs.readdirSync(targetPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'vendor') {
        dirsToScan.push(path.join(targetPath, entry.name));
      }
    }
  } catch { /* ignore */ }

  const merged: TechStackInfo = { dependencies: [] };
  const seenPkgs = new Set<string>();

  for (const dir of dirsToScan) {
    const goInfo = parseGoMod(dir);
    const jsInfo = parsePackageJson(dir);
    const dartInfo = parsePubspecYaml(dir);

    for (const info of [goInfo, jsInfo, dartInfo]) {
      if (!info) continue;
      if (info.runtimeVersion && !merged.runtimeVersion) merged.runtimeVersion = info.runtimeVersion;
      if (info.modulePath && !merged.modulePath) merged.modulePath = info.modulePath;
      for (const dep of info.dependencies) {
        if (!seenPkgs.has(dep.package)) {
          seenPkgs.add(dep.package);
          merged.dependencies.push(dep);
        }
      }
    }
  }

  return merged.dependencies.length > 0 || merged.runtimeVersion ? merged : null;
}

function parsePubspecYaml(dir: string): TechStackInfo | null {
  const pubspecPath = path.join(dir, 'pubspec.yaml');
  if (!fs.existsSync(pubspecPath)) return null;

  const content = fs.readFileSync(pubspecPath, 'utf-8');
  const info: TechStackInfo = { dependencies: [] };

  // Extract package name
  const nameMatch = content.match(/^name:\s*(\S+)/m);
  if (nameMatch) info.modulePath = nameMatch[1];

  // Extract dependencies
  const dartCategories: Record<string, string> = {
    'flutter_bloc': 'State Management (BLoC)',
    'bloc': 'State Management (BLoC)',
    'flutter_riverpod': 'State Management (Riverpod)',
    'riverpod': 'State Management (Riverpod)',
    'hooks_riverpod': 'State Management (Riverpod)',
    'provider': 'State Management (Provider)',
    'get': 'State Management (GetX)',
    'getx': 'State Management (GetX)',
    'dio': 'HTTP Client (Dio)',
    'http': 'HTTP Client (http)',
    'go_router': 'Routing (GoRouter)',
    'auto_route': 'Routing (AutoRoute)',
    'get_it': 'Dependency Injection (GetIt)',
    'injectable': 'Dependency Injection (Injectable)',
    'freezed_annotation': 'Code Generation (Freezed)',
    'json_annotation': 'Code Generation (JsonSerializable)',
    'floor': 'Database (Floor)',
    'drift': 'Database (Drift)',
    'firebase_core': 'Backend (Firebase)',
    'firebase_auth': 'Auth (Firebase)',
    'cloud_firestore': 'Database (Firestore)',
    'retrofit': 'API Client (Retrofit)',
    'mobx': 'State Management (MobX)',
  };

  const lines = content.split('\n');
  let inDeps = false;
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed === 'dependencies:' || trimmed === 'dev_dependencies:') {
      inDeps = true;
      continue;
    }
    if (inDeps && trimmed.length > 0 && line[0] !== ' ' && line[0] !== '\t') {
      inDeps = false;
    }
    if (!inDeps) continue;

    // Match "  package_name: ^version" or "  package_name:"
    const depMatch = trimmed.match(/^(\w+):\s*(.*)/);
    if (depMatch) {
      const pkg = depMatch[1];
      const version = depMatch[2].replace(/['"]/g, '').trim() || '*';
      const category = dartCategories[pkg];
      if (category) {
        info.dependencies.push({ package: pkg, version, category });
      }
    }
  }

  return info.dependencies.length > 0 ? info : null;
}

export function exportMarkdown(systemMap: SystemMap, outputDir: string, targetPath?: string): string {
  const outputPath = path.join(outputDir, 'system-map.md');
  const techStack = targetPath ? collectTechStacks(targetPath) : null;
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
    if (techStack.runtimeVersion) {
      lines.push(`- **Go** ${techStack.runtimeVersion} (from go.mod)`);
    }
    if (techStack.modulePath) {
      // Detect if this is a Go module or npm package
      const isNpm = !techStack.runtimeVersion;
      lines.push(`- ${isNpm ? 'Package' : 'Module'}: \`${techStack.modulePath}\``);
    }
    // Show detected languages/frameworks from dependencies
    const tsDetected = techStack.dependencies.some(d => d.category.includes('TypeScript'));
    const reactDetected = techStack.dependencies.some(d => d.category.includes('React'));
    const nextDetected = techStack.dependencies.some(d => d.category.includes('Next.js'));
    const flutterDetected = map.meta.languages.includes('dart' as any);
    const blocDetected = techStack.dependencies.some(d => d.category.includes('BLoC'));
    const riverpodDetected = techStack.dependencies.some(d => d.category.includes('Riverpod'));
    if (nextDetected) lines.push('- **Next.js** (from package.json)');
    else if (reactDetected) lines.push('- **React** (from package.json)');
    if (tsDetected) lines.push('- **TypeScript** (from package.json)');
    if (flutterDetected) {
      lines.push('- **Dart/Flutter** (from pubspec.yaml)');
      if (blocDetected) lines.push('- **BLoC** state management');
      if (riverpodDetected) lines.push('- **Riverpod** state management');
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
  // Count nodes by type dynamically
  const typeCounts = new Map<string, number>();
  for (const node of map.nodes) {
    typeCounts.set(node.type, (typeCounts.get(node.type) || 0) + 1);
  }

  let restRoutes = 0;
  let callRelationships = 0;
  let importRelationships = 0;
  for (const edge of map.edges) {
    if (edge.type === 'routes-to') restRoutes++;
    else if (edge.type === 'calls') callRelationships++;
    else if (edge.type === 'imports') importRelationships++;
  }

  // Display labels for node types
  const typeLabels: Record<string, string> = {
    function: 'Functions',
    handler: 'HTTP Handlers',
    component: 'Components',
    service: 'Services',
    bloc: 'BLoC/Cubit',
    hook: 'Hooks',
    grpc: 'gRPC Endpoints',
    route: 'Routes',
    struct: 'Structs',
    worker: 'Workers',
    entity: 'Entities',
    model: 'Models',
    module: 'Modules',
    guard: 'Guards',
    interceptor: 'Interceptors',
  };

  lines.push('## Architecture Summary');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');

  // Show node types that have data (ordered by label config)
  for (const [type, label] of Object.entries(typeLabels)) {
    const count = typeCounts.get(type) || 0;
    if (count > 0) {
      lines.push(`| ${label} | ${count} |`);
    }
  }

  if (restRoutes > 0) lines.push(`| REST Routes | ${restRoutes} |`);
  if (callRelationships > 0) lines.push(`| Call Relationships | ${callRelationships} |`);
  if (importRelationships > 0) lines.push(`| Import Relationships | ${importRelationships} |`);
  lines.push('');

  // Keep backward-compat vars for Detected Patterns section
  const counts = {
    functions: typeCounts.get('function') || 0,
    handlers: typeCounts.get('handler') || 0,
    grpc: typeCounts.get('grpc') || 0,
    workers: typeCounts.get('worker') || 0,
    restRoutes,
    components: typeCounts.get('component') || 0,
    services: typeCounts.get('service') || 0,
    blocs: typeCounts.get('bloc') || 0,
  };

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

  // Dart/Flutter patterns (always check, regardless of techStack source)
  if (counts.blocs > 0) patterns.push(`- BLoC/Cubit: **${counts.blocs}** state managers`);
  if (counts.components > 0) patterns.push(`- Components/Widgets: **${counts.components}**`);
  if (counts.services > 0) patterns.push(`- Services: **${counts.services}** (Repository, Provider, UseCase, etc.)`);


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
