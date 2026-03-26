import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { parseGoMod, parsePackageJson, categorizePackage, getGitContext } from './tech-stack-detector.js';

const FIXTURES = path.resolve('test-fixtures/go');
const TS_FIXTURES = path.resolve('test-fixtures/ts');

describe('Tech Stack Detector', () => {
  describe('parseGoMod', () => {
    it('parses module path and Go version from gin-project', () => {
      const info = parseGoMod(path.join(FIXTURES, 'gin-project'));
      expect(info).not.toBeNull();
      expect(info!.modulePath).toBe('test-gin-project');
      expect(info!.runtimeVersion).toBe('1.21');
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

  describe('parsePackageJson', () => {
    it('parses Next.js project dependencies', () => {
      const info = parsePackageJson(path.join(TS_FIXTURES, 'nextjs-app'));
      expect(info).not.toBeNull();
      expect(info!.modulePath).toBeUndefined(); // nextjs-app has no "name" field
      expect(info!.dependencies.length).toBeGreaterThanOrEqual(2);

      const next = info!.dependencies.find(d => d.package === 'next');
      expect(next).toBeDefined();
      expect(next!.version).toBe('14.0.0');
      expect(next!.category).toBe('Framework (Next.js)');

      const react = info!.dependencies.find(d => d.package === 'react');
      expect(react).toBeDefined();
      expect(react!.category).toBe('UI Library (React)');
    });

    it('parses React vanilla project', () => {
      const info = parsePackageJson(path.join(TS_FIXTURES, 'react-vanilla'));
      expect(info).not.toBeNull();
      const react = info!.dependencies.find(d => d.package === 'react');
      expect(react).toBeDefined();
    });

    it('returns null for directory without package.json', () => {
      const info = parsePackageJson(path.resolve('test-fixtures/unsupported-lang'));
      expect(info).toBeNull();
    });

    it('returns null for Go project with no known npm deps', () => {
      // Go fixtures have no package.json
      const info = parsePackageJson(path.join(FIXTURES, 'simple-api'));
      expect(info).toBeNull();
    });

    it('sorts frameworks before other categories', () => {
      const info = parsePackageJson(path.join(TS_FIXTURES, 'nextjs-app'));
      expect(info).not.toBeNull();
      // Framework should come before UI Library
      const nextIdx = info!.dependencies.findIndex(d => d.category.includes('Framework'));
      const reactIdx = info!.dependencies.findIndex(d => d.category.includes('UI Library'));
      if (nextIdx >= 0 && reactIdx >= 0) {
        expect(nextIdx).toBeLessThan(reactIdx);
      }
    });

    it('includes uncategorized production deps as Dependency category', () => {
      const info = parsePackageJson(path.join(TS_FIXTURES, 'nextjs-app'));
      expect(info).not.toBeNull();
      // No "Other" category — uncategorized prod deps are "Dependency"
      const others = info!.dependencies.filter(d => d.category === 'Other');
      expect(others.length).toBe(0);
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
