import fs from 'node:fs';
import path from 'node:path';
import ignore from 'ignore';
import { Language } from '../types/graph.types.js';
import { LANGUAGE_EXTENSIONS } from './language-detector.js';

const DEFAULT_IGNORES = [
  'vendor/',
  'node_modules/',
  'testdata/',
  '.git/',
  'dist/',
  'build/',
  '*.g.dart',
  '*.freezed.dart',
];

function loadGitignore(rootPath: string): ReturnType<typeof ignore> {
  const ig = ignore();
  ig.add(DEFAULT_IGNORES);

  const gitignorePath = path.join(rootPath, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    ig.add(content);
  }

  return ig;
}

export function scanFiles(rootPath: string, language: Language): string[] {
  const extensions = LANGUAGE_EXTENSIONS[language];
  if (!extensions) {
    return [];
  }

  const ig = loadGitignore(rootPath);
  const files: string[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      // M-3 security fix: skip symlinks to prevent traversal outside target directory
      if (entry.isSymbolicLink()) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(rootPath, fullPath);

      if (ig.ignores(relativePath + (entry.isDirectory() ? '/' : ''))) {
        continue;
      }

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  walk(rootPath);
  return files.sort();
}
