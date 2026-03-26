import fs from 'node:fs';
import path from 'node:path';
import { Language } from '../types/graph.types.js';

interface DetectionResult {
  supported: Language[];
  unsupported: { file: string; language: string }[];
}

// Only languages with implemented extractors go here
const LANGUAGE_CONFIG_MAP: Record<string, Language> = {
  'go.mod': Language.Go,
  'package.json': Language.TypeScript,
  'pubspec.yaml': Language.Dart,
};

const UNSUPPORTED_CONFIG_MAP: Record<string, string> = {
  'requirements.txt': 'Python',
  'Cargo.toml': 'Rust',
  'pom.xml': 'Java',
  'build.gradle': 'Java/Kotlin',
  'Gemfile': 'Ruby',
  'composer.json': 'PHP',
};

export function detectLanguages(rootPath: string): DetectionResult {
  const supported: Language[] = [];
  const unsupported: { file: string; language: string }[] = [];

  // Scan root directory and immediate subdirectories for config files
  // This supports monorepo layouts like: backend/go.mod, web/package.json, mobile/pubspec.yaml
  const dirsToScan = [rootPath];
  try {
    const rootEntries = fs.readdirSync(rootPath, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'vendor') {
        dirsToScan.push(path.join(rootPath, entry.name));
      }
    }
  } catch { /* ignore read errors */ }

  for (const dir of dirsToScan) {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (LANGUAGE_CONFIG_MAP[entry]) {
        const lang = LANGUAGE_CONFIG_MAP[entry];
        if (!supported.includes(lang)) {
          supported.push(lang);
        }
      }
      if (UNSUPPORTED_CONFIG_MAP[entry]) {
        const alreadyReported = unsupported.some(u => u.file === entry);
        if (!alreadyReported) {
          unsupported.push({
            file: entry,
            language: UNSUPPORTED_CONFIG_MAP[entry],
          });
        }
      }
    }
  }

  return { supported, unsupported };
}

const LANGUAGE_EXTENSIONS: Record<Language, string[]> = {
  [Language.Go]: ['.go'],
  [Language.TypeScript]: ['.ts', '.tsx', '.js', '.jsx'],
  [Language.Dart]: ['.dart'],
};

export { DetectionResult, LANGUAGE_EXTENSIONS };
