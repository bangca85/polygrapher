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
  // 'package.json': Language.TypeScript,  // Release 1.1
  // 'pubspec.yaml': Language.Dart,        // Release 1.2
};

const UNSUPPORTED_CONFIG_MAP: Record<string, string> = {
  'package.json': 'TypeScript/JavaScript (coming in Release 1.1)',
  'pubspec.yaml': 'Dart/Flutter (coming in Release 1.2)',
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

  const entries = fs.readdirSync(rootPath);

  for (const entry of entries) {
    if (LANGUAGE_CONFIG_MAP[entry]) {
      const lang = LANGUAGE_CONFIG_MAP[entry];
      if (!supported.includes(lang)) {
        supported.push(lang);
      }
    }
    if (UNSUPPORTED_CONFIG_MAP[entry]) {
      unsupported.push({
        file: entry,
        language: UNSUPPORTED_CONFIG_MAP[entry],
      });
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
