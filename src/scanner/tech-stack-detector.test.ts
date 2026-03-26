import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { parseGoMod, categorizePackage, getGitContext } from './tech-stack-detector.js';

const FIXTURES = path.resolve('test-fixtures/go');

describe('Tech Stack Detector', () => {
  describe('parseGoMod', () => {
    it('parses module path and Go version from gin-project', () => {
      const info = parseGoMod(path.join(FIXTURES, 'gin-project'));
      expect(info).not.toBeNull();
      expect(info!.modulePath).toBe('test-gin-project');
      expect(info!.goVersion).toBe('1.21');
    });

    it('extracts single-line require dependency', () => {
      const info = parseGoMod(path.join(FIXTURES, 'gin-project'));
      expect(info).not.toBeNull();
      expect(info!.dependencies.length).toBeGreaterThanOrEqual(1);
      const gin = info!.dependencies.find(d => d.package.includes('gin'));
      expect(gin).toBeDefined();
      expect(gin!.version).toBe('v1.9.1');
      expect(gin!.category).toBe('HTTP Framework (Gin)');
    });

    it('extracts multi-line require block from grpc-service', () => {
      const info = parseGoMod(path.join(FIXTURES, 'grpc-service'));
      expect(info).not.toBeNull();
      expect(info!.dependencies.length).toBeGreaterThanOrEqual(2);
    });

    it('returns null for directory without go.mod', () => {
      const info = parseGoMod(path.resolve('test-fixtures/unsupported-lang'));
      expect(info).toBeNull();
    });
  });

  describe('categorizePackage', () => {
    it('categorizes known packages', () => {
      expect(categorizePackage('github.com/gin-gonic/gin')).toBe('HTTP Framework (Gin)');
      expect(categorizePackage('github.com/jackc/pgx/v5')).toBe('Database (PostgreSQL)');
      expect(categorizePackage('github.com/redis/go-redis/v9')).toBe('Cache (Redis)');
      expect(categorizePackage('google.golang.org/grpc/grpc-go')).toBe('gRPC');
    });

    it('handles versioned paths via partial match', () => {
      expect(categorizePackage('github.com/jackc/pgx/v5')).toBe('Database (PostgreSQL)');
      expect(categorizePackage('github.com/gofiber/fiber/v2')).toBe('HTTP Framework (Fiber)');
    });

    it('returns Other for unknown packages', () => {
      expect(categorizePackage('github.com/unknown/pkg')).toBe('Other');
      expect(categorizePackage('golang.org/x/text')).toBe('Other');
    });
  });

  describe('getGitContext', () => {
    it('returns git context or null without crashing', () => {
      // Should never throw, even if not in a git repo
      const ctx = getGitContext(path.resolve('.'));
      if (ctx !== null) {
        expect(ctx.commitHash).toBeTruthy();
        expect(ctx.commitHash.length).toBeGreaterThanOrEqual(7);
        expect(typeof ctx.commitMessage).toBe('string');
        expect(typeof ctx.branch).toBe('string');
      }
    });

    it('returns null for non-git directory without error', () => {
      const ctx = getGitContext('/tmp/polygrapher-no-git-test-' + Date.now());
      expect(ctx).toBeNull();
    });
  });
});
