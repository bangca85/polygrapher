import { describe, it, expect } from 'vitest';
import { safeWriteFile, parsePubspecYaml } from './shared.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('safeWriteFile', () => {
  it('writes content to a regular file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-shared-'));
    const filePath = path.join(tmpDir, 'test.txt');

    safeWriteFile(filePath, 'hello world');

    expect(fs.readFileSync(filePath, 'utf-8')).toBe('hello world');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('refuses to write to a symlink', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-shared-'));
    const realFile = path.join(tmpDir, 'real.txt');
    const symlinkFile = path.join(tmpDir, 'link.txt');

    fs.writeFileSync(realFile, 'original');
    fs.symlinkSync(realFile, symlinkFile);

    expect(() => safeWriteFile(symlinkFile, 'hacked')).toThrow('Refusing to write to symlink');
    expect(fs.readFileSync(realFile, 'utf-8')).toBe('original');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('overwrites existing non-symlink file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-shared-'));
    const filePath = path.join(tmpDir, 'test.txt');

    fs.writeFileSync(filePath, 'old content');
    safeWriteFile(filePath, 'new content');

    expect(fs.readFileSync(filePath, 'utf-8')).toBe('new content');
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('parsePubspecYaml', () => {
  it('returns null when pubspec.yaml does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-shared-'));
    expect(parsePubspecYaml(tmpDir)).toBeNull();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('extracts known Dart dependencies', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-shared-'));
    fs.writeFileSync(path.join(tmpDir, 'pubspec.yaml'), `
name: my_app
dependencies:
  flutter_bloc: ^8.0.0
  dio: ^5.0.0
  go_router: ^10.0.0
dev_dependencies:
  freezed_annotation: ^2.0.0
`);

    const result = parsePubspecYaml(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.modulePath).toBe('my_app');
    expect(result!.dependencies).toHaveLength(4);
    expect(result!.dependencies.map(d => d.package)).toContain('flutter_bloc');
    expect(result!.dependencies.map(d => d.package)).toContain('dio');
    expect(result!.dependencies.map(d => d.package)).toContain('go_router');
    expect(result!.dependencies.map(d => d.package)).toContain('freezed_annotation');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns null for pubspec with no known dependencies', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-shared-'));
    fs.writeFileSync(path.join(tmpDir, 'pubspec.yaml'), `
name: boring_app
dependencies:
  some_unknown_package: ^1.0.0
`);

    expect(parsePubspecYaml(tmpDir)).toBeNull();
    fs.rmSync(tmpDir, { recursive: true });
  });
});
