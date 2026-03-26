import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanFiles } from './file-scanner.js';
import { Language } from '../types/graph.types.js';

const FIXTURES = path.resolve('test-fixtures');

describe('scanFiles', () => {
  it('finds .go files recursively', () => {
    const files = scanFiles(path.join(FIXTURES, 'go/simple-api'), Language.Go);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every(f => f.endsWith('.go'))).toBe(true);
  });

  it('returns empty for directory with no matching files', () => {
    const files = scanFiles(path.join(FIXTURES, 'empty-repo'), Language.Go);
    expect(files).toHaveLength(0);
  });

  it('M-3: skips symlinks to prevent traversal (security)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poly-sec-'));
    try {
      // Create a real .go file
      fs.writeFileSync(path.join(tmpDir, 'real.go'), 'package main');
      // Create a symlink .go file pointing outside
      fs.symlinkSync('/etc/passwd', path.join(tmpDir, 'evil.go'));
      // Create go.mod so it's detected
      fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module test\ngo 1.21');

      const files = scanFiles(tmpDir, Language.Go);

      // Should find real.go but NOT evil.go (symlink)
      expect(files.some(f => f.includes('real.go'))).toBe(true);
      expect(files.some(f => f.includes('evil.go'))).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
