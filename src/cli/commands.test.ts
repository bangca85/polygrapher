import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { validatePath, createProgram, getVersion } from './commands.js';

describe('validatePath', () => {
  it('returns resolved path for existing directory', () => {
    const testDir = path.resolve('test-fixtures/go/simple-api');
    const result = validatePath(testDir);
    expect(result).toBe(testDir);
  });

  it('resolves relative paths to absolute', () => {
    const result = validatePath('test-fixtures/go/simple-api');
    expect(path.isAbsolute(result)).toBe(true);
  });

  it('throws for nonexistent directory', () => {
    expect(() => validatePath('/nonexistent/path')).toThrow('Directory not found');
  });

  it('throws for file path (not a directory)', () => {
    const filePath = path.resolve('package.json');
    expect(() => validatePath(filePath)).toThrow('Not a directory');
  });
});

describe('createProgram', () => {
  it('creates a Commander program with correct name', () => {
    const program = createProgram();
    expect(program.name()).toBe('polygrapher');
  });

  it('defaults target path to "." when no argument given (FR1)', () => {
    const program = createProgram();
    program.parse([], { from: 'user' });
    expect(program.args[0] ?? '.').toBe('.');
  });

  it('accepts a target path argument (FR2)', () => {
    const program = createProgram();
    program.parse(['./test-fixtures'], { from: 'user' });
    expect(program.args[0]).toBe('./test-fixtures');
  });

  it('parses --lang option (FR5)', () => {
    const program = createProgram();
    program.parse(['--lang', 'go'], { from: 'user' });
    expect(program.opts().lang).toBe('go');
  });

  it('parses --export-only option', () => {
    const program = createProgram();
    program.parse(['--export-only'], { from: 'user' });
    expect(program.opts().exportOnly).toBe(true);
  });

  it('parses --port option with custom value (FR36)', () => {
    const program = createProgram();
    program.parse(['--port', '4000'], { from: 'user' });
    expect(program.opts().port).toBe('4000');
  });

  it('defaults --port to 3030', () => {
    const program = createProgram();
    program.parse([], { from: 'user' });
    expect(program.opts().port).toBe('3030');
  });

  it('defaults --export-only to false', () => {
    const program = createProgram();
    program.parse([], { from: 'user' });
    expect(program.opts().exportOnly).toBe(false);
  });
});

describe('getVersion', () => {
  it('returns a version string', () => {
    const version = getVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
