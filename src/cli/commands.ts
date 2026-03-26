import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';

export function validatePath(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Directory not found: ${resolved}`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${resolved}`);
  }
  return resolved;
}

export function getVersion(): string {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version as string;
  } catch {
    return '0.0.0';
  }
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('polygrapher')
    .description('Zero-config CLI that generates instant, interactive codebase maps')
    .version(getVersion(), '-v, --version', 'Show version number')
    .argument('[path]', 'Target directory to scan', '.')
    .option('--export-only', 'Output files only, no viewer', false)
    .option('--port <number>', 'Custom viewer port', '3030')
    .option('--lang <language>', 'Force specific language extractor');

  return program;
}
