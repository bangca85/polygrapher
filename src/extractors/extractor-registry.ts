import { Language } from '../types/graph.types.js';
import type { LanguageExtractor } from '../types/extractor.types.js';
import { GoExtractor } from './go-extractor.js';

const EXTRACTORS: LanguageExtractor[] = [
  new GoExtractor(),
];

export function getExtractorsForLanguages(languages: Language[]): LanguageExtractor[] {
  return EXTRACTORS.filter(e => languages.includes(e.language));
}

export function getAllExtractors(): LanguageExtractor[] {
  return [...EXTRACTORS];
}
