import type { Language } from './graph.types.js';

export interface CliOptions {
  path: string;
  exportOnly: boolean;
  port: number;
  lang?: Language;
}
