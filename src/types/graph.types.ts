export enum NodeType {
  Function = 'function',
  Handler = 'handler',
  Component = 'component',
  Service = 'service',
  Grpc = 'grpc',
  Route = 'route',
  Struct = 'struct',
  Worker = 'worker',
  Entity = 'entity',
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
}

export interface GraphEdge {
  source: string;
  target: string;
  type: EdgeType;
  protocol: Protocol;
  metadata?: Record<string, string>;
  callLine?: number;
}

export interface SystemMap {
  meta: MapMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
