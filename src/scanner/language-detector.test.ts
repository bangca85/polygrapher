import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { detectLanguages } from './language-detector.js';

const FIXTURES = path.resolve('test-fixtures');

describe('detectLanguages', () => {
  it('detects Go from go.mod', () => {
    const result = detectLanguages(path.join(FIXTURES, 'go/simple-api'));
    expect(result.supported).toContain('go');
  });

  it('returns empty for unsupported-only repo', () => {
    const result = detectLanguages(path.join(FIXTURES, 'unsupported-lang'));
    expect(result.supported).toHaveLength(0);
    expect(result.unsupported).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: 'requirements.txt', language: 'Python' }),
      ])
    );
  });

  it('returns empty for empty repo', () => {
    const result = detectLanguages(path.join(FIXTURES, 'empty-repo'));
    expect(result.supported).toHaveLength(0);
    expect(result.unsupported).toHaveLength(0);
  });
});
