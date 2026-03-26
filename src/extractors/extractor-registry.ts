import { Language } from '../types/graph.types.js';
import type { LanguageExtractor } from '../types/extractor.types.js';
import { GoExtractor } from './go-extractor.js';
import { TypeScriptExtractor } from './ts-extractor.js';
import { DartExtractor } from './dart-extractor.js';

const EXTRACTORS: LanguageExtractor[] = [
  new GoExtractor(),
  new TypeScriptExtractor(),
  new DartExtractor(),
];

export function getExtractorsForLanguages(languages: Language[]): LanguageExtractor[] {
  return EXTRACTORS.filter(e => languages.includes(e.language));
}

export function getAllExtractors(): LanguageExtractor[] {
  return [...EXTRACTORS];
}
