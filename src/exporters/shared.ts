import fs from 'node:fs';
import path from 'node:path';
import { parseGoMod, parsePackageJson } from '../scanner/tech-stack-detector.js';
import type { TechStackInfo } from '../scanner/tech-stack-detector.js';

// Re-export types for convenience
export type { TechStackInfo, GitContext } from '../scanner/tech-stack-detector.js';
export { getGitContext } from '../scanner/tech-stack-detector.js';

export function safeWriteFile(filePath: string, content: string): void {
  // M-3 security fix: refuse to write if target is a symlink
  if (fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()) {
    throw new Error(`Refusing to write to symlink: ${filePath}`);
  }
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function collectTechStacks(targetPath: string): TechStackInfo | null {
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

export function parsePubspecYaml(dir: string): TechStackInfo | null {
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
