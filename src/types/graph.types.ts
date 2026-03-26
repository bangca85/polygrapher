export enum NodeType {
  Function = 'function',
  Handler = 'handler',
  Component = 'component',
  Hook = 'hook',
  Service = 'service',
  Grpc = 'grpc',
  Route = 'route',
  Struct = 'struct',
  Worker = 'worker',
  Entity = 'entity',
  Bloc = 'bloc',
  Model = 'model',
}

export enum EdgeType {
  Calls = 'calls',
  Imports = 'imports',
  RoutesTo = 'routes-to',
}

export enum Protocol {
  REST = 'REST',
  GRPC = 'gRPC',
  Internal = 'internal',
}

export enum Language {
  Go = 'go',
  TypeScript = 'typescript',
  Dart = 'dart',
}

export interface MapMeta {
  repo: string;
  languages: Language[];
  generatedAt: string;
  polygrapher: string;
}

export interface GraphNode {
  id: string;
  name: string;
  type: NodeType;
  language: Language;
  file: string;
  line: number;
  signature: string;
  repo: string;
  metadata?: Record<string, string>;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: EdgeType;
  protocol: Protocol;
  metadata?: Record<string, string>;
  callLine?: number;
  matchConfidence?: 'exact' | 'partial' | 'inferred' | 'none';
}

export interface SystemMap {
  meta: MapMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
