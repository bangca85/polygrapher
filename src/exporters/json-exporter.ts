import path from 'node:path';
import type { SystemMap } from '../types/graph.types.js';
import { safeWriteFile } from './shared.js';

export function exportJson(systemMap: SystemMap, outputDir: string): string {
  const outputPath = path.join(outputDir, 'system-map.json');
  const json = JSON.stringify(systemMap, null, 2);
  safeWriteFile(outputPath, json);
  return outputPath;
}
