import fs from 'node:fs';
import path from 'node:path';
import type { SystemMap } from '../types/graph.types.js';

function safeWriteFile(filePath: string, content: string): void {
  // M-3 security fix: refuse to write if target is a symlink
  if (fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()) {
    throw new Error(`Refusing to write to symlink: ${filePath}`);
  }
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function exportJson(systemMap: SystemMap, outputDir: string): string {
  const outputPath = path.join(outputDir, 'system-map.json');
  const json = JSON.stringify(systemMap, null, 2);
  safeWriteFile(outputPath, json);
  return outputPath;
}
