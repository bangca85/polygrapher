import { describe, it, expect } from 'vitest';
import { exportMarkdown } from './markdown-exporter.js';
import { Language, NodeType, EdgeType, Protocol } from '../types/graph.types.js';
import type { SystemMap } from '../types/graph.types.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function createTestMap(): SystemMap {
  return {
    meta: {
      repo: 'test-repo',
      languages: [Language.Go],
      generatedAt: '2026-03-25T00:00:00.000Z',
      polygrapher: '0.1.0',
    },
    nodes: [
      {
        id: 'abc123',
        name: 'HandleHealth',
        type: NodeType.Handler,
        language: Language.Go,
        file: 'main.go',
        line: 10,
        signature: 'func HandleHealth(w http.ResponseWriter, r *http.Request)',
        repo: 'test-repo',
      },
      {
        id: 'def456',
        name: 'GetBookings',
        type: NodeType.Function,
        language: Language.Go,
        file: 'main.go',
        line: 20,
        signature: 'func GetBookings() []string',
        repo: 'test-repo',
      },
    ],
    edges: [
      {
        source: 'abc123',
        target: 'def456',
        type: EdgeType.Calls,
        protocol: Protocol.Internal,
      },
    ],
  };
}

describe('exportMarkdown', () => {
  it('writes system-map.md with correct structure', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-test-'));
    const map = createTestMap();

    const outputPath = exportMarkdown(map, tmpDir);

    expect(outputPath).toBe(path.join(tmpDir, 'system-map.md'));
    expect(fs.existsSync(outputPath)).toBe(true);

    const content = fs.readFileSync(outputPath, 'utf-8');
    expect(content).toContain('# System Map: test-repo');
    expect(content).toContain('Languages: go');
    expect(content).toContain('Nodes: 2 | Edges: 1');
    expect(content).toContain('HandleHealth');
    expect(content).toContain('GetBookings');
    expect(content).toContain('HandleHealth -> GetBookings (calls)');

    fs.rmSync(tmpDir, { recursive: true });
  });
});
