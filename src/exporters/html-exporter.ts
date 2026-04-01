import path from 'node:path';
import type { SystemMap } from '../types/graph.types.js';
import { generateViewerHtml } from '../viewer/viewer-template.js';
import { safeWriteFile } from './shared.js';

const INLINE_THRESHOLD = 1000;

export function exportHtml(systemMap: SystemMap, outputDir: string, rootPath: string): string {
  const outputPath = path.join(outputDir, 'system-map.html');
  const isInline = systemMap.nodes.length < INLINE_THRESHOLD;
  const html = generateViewerHtml(systemMap, rootPath, { inline: isInline });
  safeWriteFile(outputPath, html);
  return outputPath;
}
