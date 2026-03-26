import fs from 'node:fs';
import path from 'node:path';
import type { SystemMap } from '../types/graph.types.js';
import { generateViewerHtml } from '../viewer/viewer-template.js';

const INLINE_THRESHOLD = 1000;

function safeWriteFile(filePath: string, content: string): void {
  // M-3 security fix: refuse to write if target is a symlink
  if (fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()) {
    throw new Error(`Refusing to write to symlink: ${filePath}`);
  }
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function exportHtml(systemMap: SystemMap, outputDir: string, rootPath: string): string {
  const outputPath = path.join(outputDir, 'system-map.html');
  const isInline = systemMap.nodes.length < INLINE_THRESHOLD;
  const html = generateViewerHtml(systemMap, rootPath, { inline: isInline });
  safeWriteFile(outputPath, html);
  return outputPath;
}
