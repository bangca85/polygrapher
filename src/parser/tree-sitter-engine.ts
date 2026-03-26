import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type TreeSitterType from 'web-tree-sitter';
import TreeSitterModule from 'web-tree-sitter';
import { Language } from '../types/graph.types.js';

// web-tree-sitter exports CJS; handle both default and namespace import at runtime
const Parser = (TreeSitterModule as unknown as { default?: typeof TreeSitterModule }).default ?? TreeSitterModule;

const GRAMMAR_FILES: Record<Language, string> = {
  [Language.Go]: 'tree-sitter-go.wasm',
  [Language.TypeScript]: 'tree-sitter-typescript.wasm',
  [Language.Dart]: 'tree-sitter-dart.wasm',
};

// SHA-256 hashes for WASM integrity verification (L-2 security fix)
const GRAMMAR_HASHES: Record<string, string> = {
  'tree-sitter-go.wasm': '6dfc8eacdad0a54d0cad0d888851bd19cdd14d82582f110f888bbf6f9e5e2d64',
};

let initialized = false;

function findProjectRoot(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  let dir = __dirname;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return __dirname;
}

/**
 * Verify WASM file integrity via SHA-256 hash.
 * Throws if hash doesn't match (tampered file).
 * Skips check if no known hash (new/untested grammars).
 */
function verifyGrammarIntegrity(grammarPath: string, grammarFile: string): void {
  const expectedHash = GRAMMAR_HASHES[grammarFile];
  if (!expectedHash) return; // no hash registered — skip check

  const fileBuffer = fs.readFileSync(grammarPath);
  const actualHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  if (actualHash !== expectedHash) {
    throw new Error(
      `WASM integrity check failed for ${grammarFile}.\n` +
      `  Expected: ${expectedHash}\n` +
      `  Actual:   ${actualHash}\n` +
      `The grammar file may have been tampered with.`
    );
  }
}

export async function initTreeSitter(): Promise<void> {
  if (!initialized) {
    await Parser.init();
    initialized = true;
  }
}

export async function createParser(language: Language): Promise<TreeSitterType> {
  await initTreeSitter();

  const grammarFile = GRAMMAR_FILES[language];
  if (!grammarFile) {
    throw new Error(`No grammar available for language: ${language}`);
  }

  const projectRoot = findProjectRoot();
  const grammarPath = path.join(projectRoot, 'grammars', grammarFile);

  verifyGrammarIntegrity(grammarPath, grammarFile);

  const parser = new Parser();
  const lang = await Parser.Language.load(grammarPath);
  parser.setLanguage(lang);

  return parser;
}

export function parseSource(parser: TreeSitterType, source: string): TreeSitterType.Tree {
  return parser.parse(source);
}

