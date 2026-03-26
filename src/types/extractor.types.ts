import type { GraphNode, GraphEdge, Language } from './graph.types.js';

export interface ParseError {
  file: string;
  line?: number;
  message: string;
}

export interface ExtractorResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  errors: ParseError[];
}

export interface LanguageExtractor {
  readonly language: Language;
  readonly configFiles: string[];

  detect(rootPath: string): Promise<boolean>;
  parse(files: string[], rootPath?: string): Promise<ExtractorResult>;
}
