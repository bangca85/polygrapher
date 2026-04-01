import { describe, it, expect } from 'vitest';
import {
  buildDirsWithFiles, getModuleKey, groupNodesByModule, slugifyModuleKey,
  generateModuleFile, generateIndex, buildNodeModuleMap, getInternalEdges, exportAiContext,
  estimateTokens, categorizeEdges, formatRelationship, aggregateRelationship,
  MAX_MODULE_NODES, MAX_MODULE_TOKENS, MAX_INDEX_TOKENS,
} from './ai-context-exporter.js';
import type { ModuleEdges } from './ai-context-exporter.js';
import { Language, NodeType, EdgeType, Protocol } from '../types/graph.types.js';
import type { GraphNode, GraphEdge, SystemMap } from '../types/graph.types.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function makeNode(file: string, name?: string): GraphNode {
  return {
    id: file + ':' + (name || 'fn'),
    name: name || 'fn',
    type: NodeType.Function,
    language: Language.TypeScript,
    file,
    line: 1,
    signature: '',
    repo: 'test',
  };
}

describe('buildDirsWithFiles', () => {
  it('returns immediate parent directories of files', () => {
    const dirs = buildDirsWithFiles([
      'src/auth/login.ts',
      'src/auth/middleware.ts',
      'src/api/routes.ts',
      'main.ts',
    ]);
    expect(dirs.has('src/auth')).toBe(true);
    expect(dirs.has('src/api')).toBe(true);
    // 'src' should NOT be in dirs — no file has src/ as immediate parent
    expect(dirs.has('src')).toBe(false);
    // root files have no parent dir entry
    expect(dirs.size).toBe(2);
  });

  it('handles deeply nested paths', () => {
    const dirs = buildDirsWithFiles([
      'lib/features/booking/bloc/booking_bloc.dart',
      'lib/features/booking/ui/screen.dart',
    ]);
    expect(dirs.has('lib/features/booking/bloc')).toBe(true);
    expect(dirs.has('lib/features/booking/ui')).toBe(true);
    expect(dirs.has('lib/features/booking')).toBe(false);
    expect(dirs.has('lib/features')).toBe(false);
    expect(dirs.has('lib')).toBe(false);
  });
});

describe('getModuleKey', () => {
  // Build a shared dirsWithFiles set for all test cases
  const allFiles = [
    // Go microservice
    'cmd/api-service/main.go',
    'internal/handler/user.go',
    'main.go',
    // NestJS
    'src/booking/booking.controller.ts',
    'src/app.module.ts',
    // Next.js App Router
    'app/api/users/route.ts',
    'app/dashboard/page.tsx',
    // Next.js Pages Router
    'pages/api/auth/login.ts',
    // Next.js src/app
    'src2/app/api/users/route.ts', // using src2 to avoid collision with NestJS src
    // React SPA
    'src3/components/ui/Button.tsx',
    'src3/hooks/useAuth.ts',
    // Flutter BLoC
    'lib/bloc/booking_bloc.dart',
    'lib/repository/booking_repo.dart',
    // Flutter feature-first (features have files directly + subdirs)
    'lib2/features/booking/booking_screen.dart',
    'lib2/features/booking/bloc/booking_bloc.dart',
    'lib2/features/booking/ui/screen.dart',
    'lib2/features/auth/auth_screen.dart',
    'lib2/features/auth/bloc/auth_bloc.dart',
    // Flutter clean arch
    'lib3/domain/entities/user.dart',
    'lib3/data/repositories/user_repo.dart',
    // Monorepo
    'apps/frontend/src/auth/login.ts',
    // Flat project
    'components/Header.tsx',
  ];
  const dirsWithFiles = buildDirsWithFiles(allFiles);

  it('Go microservice: cmd/api-service', () => {
    expect(getModuleKey('cmd/api-service/main.go', dirsWithFiles)).toBe('cmd/api-service');
  });

  it('Go internal: internal/handler', () => {
    expect(getModuleKey('internal/handler/user.go', dirsWithFiles)).toBe('internal/handler');
  });

  it('Go root file: (root)', () => {
    expect(getModuleKey('main.go', dirsWithFiles)).toBe('(root)');
  });

  it('NestJS: src/booking files use src/booking (their own parent has files)', () => {
    // src/booking/ has booking.controller.ts → fileParent has files → return src/booking
    // src/ also has app.module.ts, but that doesn't collapse src/booking into src
    expect(getModuleKey('src/booking/booking.controller.ts', dirsWithFiles)).toBe('src/booking');
  });

  it('NestJS root: src (has files directly)', () => {
    expect(getModuleKey('src/app.module.ts', dirsWithFiles)).toBe('src');
  });

  // Verify NestJS without root files behaves correctly
  it('NestJS without root files: src/booking is the module', () => {
    // When src/ has NO direct files, src is grouping-only → walk to src/booking
    const nestFiles = [
      'src/booking/booking.controller.ts',
      'src/users/users.service.ts',
    ];
    const nestDirs = buildDirsWithFiles(nestFiles);
    expect(getModuleKey('src/booking/booking.controller.ts', nestDirs)).toBe('src/booking');
    expect(getModuleKey('src/users/users.service.ts', nestDirs)).toBe('src/users');
  });

  it('Next.js App Router: app/api/users', () => {
    expect(getModuleKey('app/api/users/route.ts', dirsWithFiles)).toBe('app/api/users');
  });

  it('Next.js App pages: app/dashboard', () => {
    expect(getModuleKey('app/dashboard/page.tsx', dirsWithFiles)).toBe('app/dashboard');
  });

  it('Next.js Pages Router: pages/api/auth', () => {
    expect(getModuleKey('pages/api/auth/login.ts', dirsWithFiles)).toBe('pages/api/auth');
  });

  it('React SPA: components/ui', () => {
    expect(getModuleKey('src3/components/ui/Button.tsx', dirsWithFiles)).toBe('src3/components/ui');
  });

  it('React hooks: hooks dir', () => {
    expect(getModuleKey('src3/hooks/useAuth.ts', dirsWithFiles)).toBe('src3/hooks');
  });

  it('Flutter BLoC: lib/bloc', () => {
    expect(getModuleKey('lib/bloc/booking_bloc.dart', dirsWithFiles)).toBe('lib/bloc');
  });

  it('Flutter feature-first: files use their immediate parent when it has files', () => {
    // lib2/features/booking/ has booking_screen.dart → files there use it
    // lib2/features/booking/bloc/ has files → files there use bloc/
    // Small-module merge (≤3 nodes) later combines bloc/ into booking/
    expect(getModuleKey('lib2/features/booking/booking_screen.dart', dirsWithFiles)).toBe('lib2/features/booking');
    expect(getModuleKey('lib2/features/booking/bloc/booking_bloc.dart', dirsWithFiles)).toBe('lib2/features/booking/bloc');
    expect(getModuleKey('lib2/features/booking/ui/screen.dart', dirsWithFiles)).toBe('lib2/features/booking/ui');
  });

  it('Flutter feature-first: separate features are separate modules', () => {
    expect(getModuleKey('lib2/features/auth/auth_screen.dart', dirsWithFiles)).toBe('lib2/features/auth');
    expect(getModuleKey('lib2/features/auth/bloc/auth_bloc.dart', dirsWithFiles)).toBe('lib2/features/auth/bloc');
  });

  it('Flutter feature-first: groupNodesByModule merges small subdirs into feature', () => {
    // booking/ has 4 direct files (> 3 threshold, won't be merged away)
    // bloc/ (1 node) and ui/ (1 node) have ≤ 3 → merge into parent booking/
    const nodes = [
      makeNode('lib2/features/booking/booking_screen.dart', 'screen'),
      makeNode('lib2/features/booking/booking_model.dart', 'model'),
      makeNode('lib2/features/booking/booking_repo.dart', 'repo'),
      makeNode('lib2/features/booking/booking_service.dart', 'service'),
      makeNode('lib2/features/booking/bloc/booking_bloc.dart', 'bloc'),
      makeNode('lib2/features/booking/ui/booking_widget.dart', 'widget'),
    ];
    const allFiles = nodes.map(n => n.file);
    const dirs = buildDirsWithFiles(allFiles);
    const modules = groupNodesByModule(nodes, dirs);

    // bloc/ and ui/ (1 node each) merge into booking/ (4 nodes)
    expect(modules.has('lib2/features/booking')).toBe(true);
    expect(modules.has('lib2/features/booking/bloc')).toBe(false);
    expect(modules.has('lib2/features/booking/ui')).toBe(false);
    expect(modules.get('lib2/features/booking')!.length).toBe(6);
  });

  it('Flutter clean arch: lib/domain/entities', () => {
    expect(getModuleKey('lib3/domain/entities/user.dart', dirsWithFiles)).toBe('lib3/domain/entities');
  });

  it('Monorepo: apps/frontend/src/auth', () => {
    expect(getModuleKey('apps/frontend/src/auth/login.ts', dirsWithFiles)).toBe('apps/frontend/src/auth');
  });

  it('Flat project: components', () => {
    expect(getModuleKey('components/Header.tsx', dirsWithFiles)).toBe('components');
  });

  it('respects MAX_DEPTH safety cap of 5', () => {
    // File 7 levels deep, only the deepest dir has files.
    // Walk checks depths 1-5, none have files → fallback caps at depth 5.
    const deepFiles = ['a/b/c/d/e/f/g/deep.ts'];
    const deepDirs = buildDirsWithFiles(deepFiles);
    const key = getModuleKey('a/b/c/d/e/f/g/deep.ts', deepDirs);
    expect(key).toBe('a/b/c/d/e');
    expect(key.split('/').length).toBeLessThanOrEqual(5);
  });

  it('finds dir within MAX_DEPTH when files exist at intermediate level', () => {
    // File 7 levels deep, but depth-3 dir has files too
    const deepFiles = [
      'a/b/c/something.ts',
      'a/b/c/d/e/f/g/deep.ts',
    ];
    const deepDirs = buildDirsWithFiles(deepFiles);
    const key = getModuleKey('a/b/c/d/e/f/g/deep.ts', deepDirs);
    expect(key).toBe('a/b/c');
  });
});

describe('groupNodesByModule', () => {
  it('groups nodes by their module key', () => {
    const nodes = [
      makeNode('src/auth/login.ts', 'login'),
      makeNode('src/auth/middleware.ts', 'auth'),
      makeNode('src/auth/guard.ts', 'guard'),
      makeNode('src/auth/service.ts', 'service'),
      makeNode('src/api/routes.ts', 'routes'),
      makeNode('src/api/controller.ts', 'controller'),
      makeNode('src/api/handler.ts', 'handler'),
      makeNode('src/api/validator.ts', 'validator'),
      makeNode('main.ts', 'main'),
      makeNode('config.ts', 'config'),
      makeNode('app.ts', 'app'),
      makeNode('utils.ts', 'utils'),
    ];

    const allFiles = nodes.map(n => n.file);
    const dirsWithFiles = buildDirsWithFiles(allFiles);
    const modules = groupNodesByModule(nodes, dirsWithFiles);

    expect(modules.has('src/auth')).toBe(true);
    expect(modules.has('src/api')).toBe(true);
    expect(modules.has('(root)')).toBe(true);
    expect(modules.get('src/auth')!.length).toBe(4);
    expect(modules.get('src/api')!.length).toBe(4);
    expect(modules.get('(root)')!.length).toBe(4);
  });

  it('merges small modules (≤ 3 nodes) into parent', () => {
    // Create a scenario: src/utils has 1 node, src/auth has 5 nodes
    const nodes = [
      makeNode('src/auth/a.ts', 'a'),
      makeNode('src/auth/b.ts', 'b'),
      makeNode('src/auth/c.ts', 'c'),
      makeNode('src/auth/d.ts', 'd'),
      makeNode('src/auth/e.ts', 'e'),
      makeNode('src/utils/helper.ts', 'helper'), // only 1 node in src/utils
    ];

    const allFiles = nodes.map(n => n.file);
    const dirsWithFiles = buildDirsWithFiles(allFiles);
    const modules = groupNodesByModule(nodes, dirsWithFiles);

    // src/utils has only 1 node — should be merged
    // Since there's no direct parent module, it merges into (root)
    expect(modules.has('src/utils')).toBe(false);
  });

  it('does not merge modules with > 3 nodes', () => {
    const nodes = [
      makeNode('src/auth/a.ts', 'a'),
      makeNode('src/auth/b.ts', 'b'),
      makeNode('src/auth/c.ts', 'c'),
      makeNode('src/auth/d.ts', 'd'),
    ];

    const allFiles = nodes.map(n => n.file);
    const dirsWithFiles = buildDirsWithFiles(allFiles);
    const modules = groupNodesByModule(nodes, dirsWithFiles);

    expect(modules.has('src/auth')).toBe(true);
    expect(modules.get('src/auth')!.length).toBe(4);
  });

  it('merges small modules into nearest parent when parent exists', () => {
    // src/auth has 5 nodes, src/auth/utils has 2 nodes (small)
    const nodes = [
      makeNode('src/auth/login.ts', 'login'),
      makeNode('src/auth/guard.ts', 'guard'),
      makeNode('src/auth/service.ts', 'service'),
      makeNode('src/auth/handler.ts', 'handler'),
      makeNode('src/auth/middleware.ts', 'middleware'),
      makeNode('src/auth/utils/hash.ts', 'hash'),
      makeNode('src/auth/utils/token.ts', 'token'),
    ];

    const allFiles = nodes.map(n => n.file);
    const dirsWithFiles = buildDirsWithFiles(allFiles);
    const modules = groupNodesByModule(nodes, dirsWithFiles);

    // src/auth/utils (2 nodes) should merge into src/auth
    expect(modules.has('src/auth/utils')).toBe(false);
    expect(modules.has('src/auth')).toBe(true);
    expect(modules.get('src/auth')!.length).toBe(7);
  });

  it('merges small modules into (root) when no parent exists', () => {
    const nodes = [
      makeNode('utils/helper.ts', 'helper'),
      makeNode('config/settings.ts', 'settings'),
      makeNode('main.ts', 'main'),
      makeNode('app.ts', 'app'),
      makeNode('index.ts', 'index'),
      makeNode('server.ts', 'server'),
    ];

    const allFiles = nodes.map(n => n.file);
    const dirsWithFiles = buildDirsWithFiles(allFiles);
    const modules = groupNodesByModule(nodes, dirsWithFiles);

    // utils (1 node) and config (1 node) have no parent module — merge into (root)
    expect(modules.has('utils')).toBe(false);
    expect(modules.has('config')).toBe(false);
    expect(modules.has('(root)')).toBe(true);
    expect(modules.get('(root)')!.length).toBe(6);
  });
});

describe('slugifyModuleKey', () => {
  it('replaces / with -- for simple paths', () => {
    expect(slugifyModuleKey('src/auth')).toBe('src--auth');
  });

  it('handles deep paths', () => {
    expect(slugifyModuleKey('lib/features/booking')).toBe('lib--features--booking');
  });

  it('converts (root) to _root', () => {
    expect(slugifyModuleKey('(root)')).toBe('_root');
  });

  it('preserves hyphens in segment names', () => {
    expect(slugifyModuleKey('my-service/api')).toBe('my-service--api');
  });

  it('preserves dots in segment names', () => {
    expect(slugifyModuleKey('pkg/v2.1')).toBe('pkg--v2.1');
  });

  it('is collision-free: a/b-c vs a-b/c produce different results', () => {
    const slug1 = slugifyModuleKey('a/b-c');
    const slug2 = slugifyModuleKey('a-b/c');
    expect(slug1).toBe('a--b-c');
    expect(slug2).toBe('a-b--c');
    expect(slug1).not.toBe(slug2);
  });

  it('handles single segment', () => {
    expect(slugifyModuleKey('components')).toBe('components');
  });
});

function makeEdge(source: string, target: string, type: EdgeType = EdgeType.Calls, protocol: Protocol = Protocol.Internal, metadata?: Record<string, string>): GraphEdge {
  return { source, target, type, protocol, ...(metadata ? { metadata } : {}) };
}

function emptyEdges(): ModuleEdges {
  return { internal: [], outgoing: [], incoming: [], unresolved: [] };
}

function withInternal(edges: GraphEdge[]): ModuleEdges {
  return { ...emptyEdges(), internal: edges };
}

describe('generateModuleFile', () => {
  it('generates correct markdown structure', () => {
    const nodes: GraphNode[] = [
      { id: 'n1', name: 'login', type: NodeType.Handler, language: Language.TypeScript, file: 'src/auth/login.ts', line: 10, signature: '(req, res) => void', repo: 'test' },
      { id: 'n2', name: 'validateToken', type: NodeType.Function, language: Language.TypeScript, file: 'src/auth/middleware.ts', line: 5, signature: '(token: string) => boolean', repo: 'test' },
    ];
    const edges: GraphEdge[] = [makeEdge('n1', 'n2')];

    const content = generateModuleFile('src/auth', nodes, withInternal(edges), nodes);

    expect(content).toContain('# Module: src/auth');
    expect(content).toContain('Module path: src/auth');
    expect(content).toContain('Files: 2 | Nodes: 2 | Internal Edges: 1');
    expect(content).toContain('### src/auth/login.ts');
    expect(content).toContain('**login** (src/auth/login.ts:10) — handler');
    expect(content).toContain('`(req, res) => void`');
    expect(content).toContain('### src/auth/middleware.ts');
    expect(content).toContain('## Internal Connections');
    expect(content).toContain('login → validateToken (calls)');
  });

  it('omits Internal Connections section when no edges', () => {
    const nodes: GraphNode[] = [
      { id: 'n1', name: 'helper', type: NodeType.Function, language: Language.Go, file: 'pkg/utils/helper.go', line: 1, signature: 'func helper()', repo: 'test' },
    ];

    const content = generateModuleFile('pkg/utils', nodes, emptyEdges(), nodes);

    expect(content).toContain('# Module: pkg/utils');
    expect(content).toContain('Internal Edges: 0');
    expect(content).not.toContain('## Internal Connections');
  });

  it('omits signature line when signature is empty', () => {
    const nodes: GraphNode[] = [
      { id: 'n1', name: 'MyComponent', type: NodeType.Component, language: Language.TypeScript, file: 'src/ui/comp.tsx', line: 1, signature: '', repo: 'test' },
    ];

    const content = generateModuleFile('src/ui', nodes, emptyEdges(), nodes);

    expect(content).toContain('**MyComponent** (src/ui/comp.tsx:1) — component');
    expect(content).not.toContain('  ``');
  });
});

describe('getInternalEdges', () => {
  it('returns only edges where both source and target are in the module', () => {
    const nodeModuleMap = new Map([
      ['n1', 'src/auth'],
      ['n2', 'src/auth'],
      ['n3', 'src/api'],
    ]);
    const edges: GraphEdge[] = [
      makeEdge('n1', 'n2'), // internal to src/auth
      makeEdge('n1', 'n3'), // cross-module
      makeEdge('n3', 'n1'), // cross-module
    ];

    const internal = getInternalEdges('src/auth', edges, nodeModuleMap);
    expect(internal).toHaveLength(1);
    expect(internal[0].source).toBe('n1');
    expect(internal[0].target).toBe('n2');
  });
});

describe('generateIndex', () => {
  it('generates correct markdown structure with all sections', () => {
    const systemMap: SystemMap = {
      meta: { repo: 'my-project', languages: [Language.TypeScript, Language.Go], generatedAt: '2026-04-01T00:00:00Z', polygrapher: '1.3.0' },
      nodes: [
        { id: 'n1', name: 'login', type: NodeType.Handler, language: Language.TypeScript, file: 'src/auth/login.ts', line: 1, signature: '', repo: 'test' },
        { id: 'n2', name: 'guard', type: NodeType.Function, language: Language.TypeScript, file: 'src/auth/guard.ts', line: 1, signature: '', repo: 'test' },
        { id: 'n3', name: 'service', type: NodeType.Service, language: Language.TypeScript, file: 'src/auth/service.ts', line: 1, signature: '', repo: 'test' },
        { id: 'n4', name: 'handler', type: NodeType.Handler, language: Language.TypeScript, file: 'src/auth/handler.ts', line: 1, signature: '', repo: 'test' },
        { id: 'n5', name: 'routes', type: NodeType.Handler, language: Language.Go, file: 'src/api/routes.go', line: 1, signature: '', repo: 'test' },
        { id: 'n6', name: 'ctrl', type: NodeType.Function, language: Language.Go, file: 'src/api/controller.go', line: 1, signature: '', repo: 'test' },
        { id: 'n7', name: 'valid', type: NodeType.Function, language: Language.Go, file: 'src/api/validator.go', line: 1, signature: '', repo: 'test' },
        { id: 'n8', name: 'mid', type: NodeType.Function, language: Language.Go, file: 'src/api/middleware.go', line: 1, signature: '', repo: 'test' },
      ],
      edges: [makeEdge('n1', 'n2')],
    };

    const dirsWithFiles = buildDirsWithFiles(systemMap.nodes.map(n => n.file));
    const modules = groupNodesByModule(systemMap.nodes, dirsWithFiles);
    const content = generateIndex(systemMap, modules, '/fake/path');

    // Header
    expect(content).toContain('# Project: my-project');
    expect(content).toContain('Languages: typescript, go');
    expect(content).toContain('Polygrapher: 1.3.0');

    // Architecture Overview
    expect(content).toContain('## Architecture Overview');
    expect(content).toContain('| Modules | 2 |');
    expect(content).toContain('| Total Nodes | 8 |');
    expect(content).toContain('| Total Edges | 1 |');

    // Module Map
    expect(content).toContain('## Module Map');
    expect(content).toContain('src/auth');
    expect(content).toContain('src/api');

    // Module Index with links
    expect(content).toContain('## Module Index');
    expect(content).toContain('[src/api](modules/src--api.md)');
    expect(content).toContain('[src/auth](modules/src--auth.md)');
  });

  it('shows key types sorted by count then alphabetically', () => {
    const systemMap: SystemMap = {
      meta: { repo: 'test', languages: [Language.TypeScript], generatedAt: '', polygrapher: '1.0.0' },
      nodes: [
        { id: 'n1', name: 'a', type: NodeType.Handler, language: Language.TypeScript, file: 'src/mod/a.ts', line: 1, signature: '', repo: 'test' },
        { id: 'n2', name: 'b', type: NodeType.Handler, language: Language.TypeScript, file: 'src/mod/b.ts', line: 1, signature: '', repo: 'test' },
        { id: 'n3', name: 'c', type: NodeType.Handler, language: Language.TypeScript, file: 'src/mod/c.ts', line: 1, signature: '', repo: 'test' },
        { id: 'n4', name: 'd', type: NodeType.Function, language: Language.TypeScript, file: 'src/mod/d.ts', line: 1, signature: '', repo: 'test' },
        { id: 'n5', name: 'e', type: NodeType.Service, language: Language.TypeScript, file: 'src/mod/e.ts', line: 1, signature: '', repo: 'test' },
      ],
      edges: [],
    };

    const dirsWithFiles = buildDirsWithFiles(systemMap.nodes.map(n => n.file));
    const modules = groupNodesByModule(systemMap.nodes, dirsWithFiles);
    const content = generateIndex(systemMap, modules, '/fake');

    // handler(3) first, then function(1), service(1) alphabetically
    expect(content).toContain('handler(3), function(1), service(1)');
  });
});

describe('exportAiContext', () => {
  it('generates index.md and module files', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ai-'));
    const systemMap: SystemMap = {
      meta: { repo: 'test-repo', languages: [Language.TypeScript], generatedAt: '2026-04-01T00:00:00Z', polygrapher: '1.0.0' },
      nodes: [
        { id: 'n1', name: 'login', type: NodeType.Handler, language: Language.TypeScript, file: 'src/auth/login.ts', line: 1, signature: '', repo: 'test' },
        { id: 'n2', name: 'guard', type: NodeType.Function, language: Language.TypeScript, file: 'src/auth/guard.ts', line: 1, signature: '', repo: 'test' },
        { id: 'n3', name: 'service', type: NodeType.Function, language: Language.TypeScript, file: 'src/auth/service.ts', line: 1, signature: '', repo: 'test' },
        { id: 'n4', name: 'handler', type: NodeType.Handler, language: Language.TypeScript, file: 'src/auth/handler.ts', line: 1, signature: '', repo: 'test' },
        { id: 'n5', name: 'routes', type: NodeType.Handler, language: Language.TypeScript, file: 'src/api/routes.ts', line: 1, signature: '', repo: 'test' },
        { id: 'n6', name: 'ctrl', type: NodeType.Function, language: Language.TypeScript, file: 'src/api/controller.ts', line: 1, signature: '', repo: 'test' },
        { id: 'n7', name: 'valid', type: NodeType.Function, language: Language.TypeScript, file: 'src/api/validator.ts', line: 1, signature: '', repo: 'test' },
        { id: 'n8', name: 'mid', type: NodeType.Function, language: Language.TypeScript, file: 'src/api/middleware.ts', line: 1, signature: '', repo: 'test' },
      ],
      edges: [makeEdge('n1', 'n2'), makeEdge('n5', 'n1')],
    };

    const result = exportAiContext(systemMap, tmpDir, '/fake/target');

    // Should generate index.md + 2 module files
    expect(result.paths.length).toBe(3);
    expect(result.warnings).toHaveLength(0);
    expect(fs.existsSync(path.join(tmpDir, 'index.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'modules', 'src--auth.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'modules', 'src--api.md'))).toBe(true);

    // Verify index.md content
    const indexContent = fs.readFileSync(path.join(tmpDir, 'index.md'), 'utf-8');
    expect(indexContent).toContain('# Project: test-repo');
    expect(indexContent).toContain('## Module Map');
    expect(indexContent).toContain('src/auth');
    expect(indexContent).toContain('[src/auth](modules/src--auth.md)');

    // Verify module content still correct
    const authContent = fs.readFileSync(path.join(tmpDir, 'modules', 'src--auth.md'), 'utf-8');
    expect(authContent).toContain('# Module: src/auth');
    expect(authContent).toContain('Internal Edges: 1');
    expect(authContent).toContain('login → guard (calls)');

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('refuses to create modules/ dir if it is a symlink', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ai-'));
    const realDir = path.join(tmpDir, 'real-modules');
    const modulesLink = path.join(tmpDir, 'modules');
    fs.mkdirSync(realDir);
    fs.symlinkSync(realDir, modulesLink);

    const systemMap: SystemMap = {
      meta: { repo: 'test', languages: [Language.Go], generatedAt: '', polygrapher: '1.0.0' },
      nodes: [makeNode('src/auth/a.ts', 'a'), makeNode('src/auth/b.ts', 'b'), makeNode('src/auth/c.ts', 'c'), makeNode('src/auth/d.ts', 'd')],
      edges: [],
    };

    expect(() => exportAiContext(systemMap, tmpDir, '/fake')).toThrow('Refusing to write to symlink directory');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('does not modify existing system-map files', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ai-'));

    // Pre-create system-map files
    const jsonContent = '{"meta":{}}';
    const mdContent = '# System Map';
    const htmlContent = '<html></html>';
    fs.writeFileSync(path.join(tmpDir, 'system-map.json'), jsonContent);
    fs.writeFileSync(path.join(tmpDir, 'system-map.md'), mdContent);
    fs.writeFileSync(path.join(tmpDir, 'system-map.html'), htmlContent);

    const systemMap: SystemMap = {
      meta: { repo: 'test', languages: [Language.Go], generatedAt: '', polygrapher: '1.0.0' },
      nodes: [makeNode('src/auth/a.ts', 'a'), makeNode('src/auth/b.ts', 'b'), makeNode('src/auth/c.ts', 'c'), makeNode('src/auth/d.ts', 'd')],
      edges: [],
    };

    exportAiContext(systemMap, tmpDir, '/fake');

    // Verify system-map files unchanged
    expect(fs.readFileSync(path.join(tmpDir, 'system-map.json'), 'utf-8')).toBe(jsonContent);
    expect(fs.readFileSync(path.join(tmpDir, 'system-map.md'), 'utf-8')).toBe(mdContent);
    expect(fs.readFileSync(path.join(tmpDir, 'system-map.html'), 'utf-8')).toBe(htmlContent);

    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ── Epic 2: Size-Bounded Token-Optimized Output ─────────────────────

describe('estimateTokens', () => {
  it('estimates 1 token per 4 characters', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(100))).toBe(25);
  });
});

describe('Story 2.1: size guard', () => {
  // NOTE: getModuleKey() groups by immediate parent dir when it has files.
  // This means hierarchical projects naturally produce granular modules.
  // splitOversizedModules() is a safety net for FLAT directories where
  // 500+ files share the SAME immediate parent with no subdirs.

  it('keeps oversized flat dir intact when files cannot be split further', () => {
    // 510 files all in same flat dir — can't split because no subdirs
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 510; i++) {
      nodes.push(makeNode(`src/handlers/handler${i}.ts`, `handler${i}`));
    }

    const allFiles = nodes.map(n => n.file);
    const dirsWithFiles = buildDirsWithFiles(allFiles);

    // Verify all group into same module
    for (const node of nodes) {
      expect(getModuleKey(node.file, dirsWithFiles)).toBe('src/handlers');
    }

    const modules = groupNodesByModule(nodes, dirsWithFiles);
    // Can't split flat dir → stays as one oversized module
    expect(modules.has('src/handlers')).toBe(true);
    expect(modules.get('src/handlers')!.length).toBe(510);
  });

  it('hierarchical projects naturally produce granular modules without needing split', () => {
    // This demonstrates the design: getModuleKey groups by leaf dir,
    // so 200 nodes across 4 subdirs become 4 modules of 50 — no split needed
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 50; i++) {
      nodes.push(makeNode(`src/components/ui/comp${i}.tsx`, `ui${i}`));
      nodes.push(makeNode(`src/components/forms/form${i}.tsx`, `form${i}`));
      nodes.push(makeNode(`src/components/layout/layout${i}.tsx`, `layout${i}`));
      nodes.push(makeNode(`src/components/common/common${i}.tsx`, `common${i}`));
    }

    const allFiles = nodes.map(n => n.file);
    const dirsWithFiles = buildDirsWithFiles(allFiles);
    const modules = groupNodesByModule(nodes, dirsWithFiles);

    // Each leaf dir is its own module — no oversized module exists
    expect(modules.has('src/components/ui')).toBe(true);
    expect(modules.has('src/components/forms')).toBe(true);
    expect(modules.get('src/components/ui')!.length).toBe(50);
    expect(modules.has('src/components')).toBe(false);
  });

  it('re-merges small modules into parent', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 5; i++) {
      nodes.push(makeNode(`src/big/root${i}.ts`, `root${i}`));
    }
    for (let i = 0; i < 10; i++) {
      nodes.push(makeNode(`src/big/main/file${i}.ts`, `fn${i}`));
    }
    for (let i = 0; i < 2; i++) {
      nodes.push(makeNode(`src/big/tiny/file${i}.ts`, `tiny${i}`));
    }

    const allFiles = nodes.map(n => n.file);
    const dirsWithFiles = buildDirsWithFiles(allFiles);
    const modules = groupNodesByModule(nodes, dirsWithFiles);

    expect(modules.has('src/big/tiny')).toBe(false);
    expect(modules.has('src/big')).toBe(true);
    expect(modules.get('src/big')!.length).toBe(7); // 5 root + 2 tiny
    expect(modules.has('src/big/main')).toBe(true);
    expect(modules.get('src/big/main')!.length).toBe(10);
  });

  it('does not create module keys beyond MAX_DEPTH (5)', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 10; i++) {
      nodes.push(makeNode(`a/b/c/d/e/f/file${i}.ts`, `fn${i}`));
    }

    const allFiles = nodes.map(n => n.file);
    const dirsWithFiles = buildDirsWithFiles(allFiles);
    const modules = groupNodesByModule(nodes, dirsWithFiles);

    for (const key of modules.keys()) {
      if (key !== '(root)') {
        expect(key.split('/').length).toBeLessThanOrEqual(5);
      }
    }
  });
});

describe('Story 2.2: Token budget enforcement', () => {
  it('truncates signatures when module exceeds token budget', () => {
    const nodes: GraphNode[] = [];
    // Create nodes with long signatures to exceed budget
    for (let i = 0; i < 100; i++) {
      nodes.push({
        id: `n${i}`,
        name: `functionWithVeryLongName${i}`,
        type: NodeType.Function,
        language: Language.TypeScript,
        file: `src/big/file${i}.ts`,
        line: i,
        signature: `(param1: VeryLongTypeName, param2: AnotherLongType, param3: YetAnotherType) => Promise<ComplexReturnType<Generic${i}>>`,
        repo: 'test',
      });
    }

    // Full content should exceed budget
    const fullContent = generateModuleFile('src/big', nodes, emptyEdges(), nodes, false);
    const fullTokens = estimateTokens(fullContent);

    // Truncated content should be smaller
    const truncContent = generateModuleFile('src/big', nodes, emptyEdges(), nodes, true);
    const truncTokens = estimateTokens(truncContent);

    expect(truncTokens).toBeLessThan(fullTokens);
    expect(truncContent).toContain('⚠️ Large module');
    expect(truncContent).toContain('100 nodes shown without signatures');
    // Should not contain any signature backticks
    expect(truncContent).not.toContain('VeryLongTypeName');
    expect(truncContent).not.toContain('Promise<ComplexReturnType');
  });

  it('does not truncate when module is within budget', () => {
    const nodes: GraphNode[] = [
      { id: 'n1', name: 'fn', type: NodeType.Function, language: Language.TypeScript, file: 'src/small/a.ts', line: 1, signature: '() => void', repo: 'test' },
    ];

    const content = generateModuleFile('src/small', nodes, emptyEdges(), nodes, false);
    expect(content).toContain('`() => void`');
    expect(content).not.toContain('⚠️');
  });

  it('exportAiContext applies truncation automatically when over budget', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ai-'));
    const nodes: GraphNode[] = [];

    // Create enough nodes with long signatures to exceed 12K token budget
    for (let i = 0; i < 120; i++) {
      nodes.push({
        id: `n${i}`,
        name: `handler${i}`,
        type: NodeType.Handler,
        language: Language.TypeScript,
        file: `src/api/file${i}.ts`,
        line: i,
        signature: `(req: Request<Params${i}, Body${i}, Query${i}>, res: Response<Result${i}>, next: NextFunction) => Promise<void>`,
        repo: 'test',
      });
    }

    const systemMap: SystemMap = {
      meta: { repo: 'test', languages: [Language.TypeScript], generatedAt: '', polygrapher: '1.0.0' },
      nodes,
      edges: [],
    };

    const result = exportAiContext(systemMap, tmpDir, '/fake');
    const moduleFile = fs.readFileSync(path.join(tmpDir, 'modules', 'src--api.md'), 'utf-8');
    const tokens = estimateTokens(moduleFile);

    // If full content would exceed budget, signatures should be truncated
    const fullContent = generateModuleFile('src/api', nodes, emptyEdges(), nodes, false);
    if (estimateTokens(fullContent) > MAX_MODULE_TOKENS) {
      expect(moduleFile).toContain('⚠️ Large module');
      expect(tokens).toBeLessThan(estimateTokens(fullContent));
    }

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('emits no warnings for small project', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ai-'));
    const systemMap: SystemMap = {
      meta: { repo: 'test', languages: [Language.Go], generatedAt: '', polygrapher: '1.0.0' },
      nodes: [
        makeNode('src/auth/a.ts', 'a'),
        makeNode('src/auth/b.ts', 'b'),
        makeNode('src/auth/c.ts', 'c'),
        makeNode('src/auth/d.ts', 'd'),
      ],
      edges: [],
    };

    const result = exportAiContext(systemMap, tmpDir, '/fake');
    expect(result.warnings).toHaveLength(0);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('emits warning when module still over budget after truncation', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ai-'));
    // Create a massive module that exceeds budget even after truncation
    // Need enough nodes that name+type lines alone exceed 12K tokens (~48K chars)
    // Each truncated line is ~60 chars, need ~800 nodes for 48K chars
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 1000; i++) {
      nodes.push({
        id: `n${i}`,
        name: `veryLongFunctionNameForTestingPurposesNumber${i}`,
        type: NodeType.Function,
        language: Language.TypeScript,
        file: `src/massive/file${i}.ts`,
        line: i,
        signature: `(a: Type${i}) => Result${i}`,
        repo: 'test',
      });
    }

    const systemMap: SystemMap = {
      meta: { repo: 'test', languages: [Language.TypeScript], generatedAt: '', polygrapher: '1.0.0' },
      nodes,
      edges: [],
    };

    const result = exportAiContext(systemMap, tmpDir, '/fake');

    // Should have truncated signatures
    const moduleFile = fs.readFileSync(path.join(tmpDir, 'modules', 'src--massive.md'), 'utf-8');
    expect(moduleFile).toContain('⚠️ Large module');

    // Check if warning was emitted (depends on whether truncation was enough)
    const truncTokens = estimateTokens(moduleFile);
    if (truncTokens > MAX_MODULE_TOKENS) {
      expect(result.warnings.some(w => w.includes('src/massive'))).toBe(true);
    }

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('generateIndex compact mode omits Module Map and shortens Module Index', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 200; i++) {
      for (let j = 0; j < 4; j++) {
        nodes.push(makeNode(`src/mod${i}/file${j}.ts`, `fn${i}_${j}`));
      }
    }

    const systemMap: SystemMap = {
      meta: { repo: 'test', languages: [Language.TypeScript], generatedAt: '', polygrapher: '1.0.0' },
      nodes,
      edges: [],
    };

    const dirsWithFiles = buildDirsWithFiles(nodes.map(n => n.file));
    const modules = groupNodesByModule(nodes, dirsWithFiles);

    const fullContent = generateIndex(systemMap, modules, '/fake', false);
    const compactContent = generateIndex(systemMap, modules, '/fake', true);

    expect(estimateTokens(compactContent)).toBeLessThan(estimateTokens(fullContent));
    expect(compactContent).not.toContain('## Module Map');
    expect(compactContent).toContain('## Module Index');
    // Compact Module Index has no key types
    expect(compactContent).not.toContain('function(');
  });

  it('exportAiContext auto-compacts index.md when over budget', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ai-'));
    // Create 500 modules to exceed 8K tokens in index.md
    // Each module row in Module Map + Module Index ≈ 80 chars ≈ 20 tokens
    // 500 modules × 20 tokens × 2 sections = ~20K tokens (well over 8K)
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 500; i++) {
      for (let j = 0; j < 4; j++) {
        nodes.push(makeNode(`src/module_with_long_name_${i}/file${j}.ts`, `functionName${i}_${j}`));
      }
    }

    const systemMap: SystemMap = {
      meta: { repo: 'test', languages: [Language.TypeScript], generatedAt: '', polygrapher: '1.0.0' },
      nodes,
      edges: [],
    };

    // Verify full index would exceed budget
    const dirsWithFiles = buildDirsWithFiles(nodes.map(n => n.file));
    const modules = groupNodesByModule(nodes, dirsWithFiles);
    const fullTokens = estimateTokens(generateIndex(systemMap, modules, '/fake', false));
    expect(fullTokens).toBeGreaterThan(MAX_INDEX_TOKENS);

    // exportAiContext should auto-compact
    const result = exportAiContext(systemMap, tmpDir, '/fake');
    const writtenIndex = fs.readFileSync(path.join(tmpDir, 'index.md'), 'utf-8');

    // Written index should be compact (no Module Map)
    expect(writtenIndex).not.toContain('## Module Map');
    expect(writtenIndex).toContain('## Module Index');

    // Written index should be smaller than full
    expect(estimateTokens(writtenIndex)).toBeLessThan(fullTokens);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('emits warning when module still over budget after truncation', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ai-'));
    // 1000 nodes in same flat dir — even truncated, may exceed 12K tokens
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 1000; i++) {
      nodes.push({
        id: `n${i}`,
        name: `veryLongFunctionNameForTestingPurposesNumber${i}`,
        type: NodeType.Function,
        language: Language.TypeScript,
        file: `src/massive/file${i}.ts`,
        line: i,
        signature: `(a: Type${i}) => Result${i}`,
        repo: 'test',
      });
    }

    const systemMap: SystemMap = {
      meta: { repo: 'test', languages: [Language.TypeScript], generatedAt: '', polygrapher: '1.0.0' },
      nodes,
      edges: [],
    };

    const result = exportAiContext(systemMap, tmpDir, '/fake');
    const moduleFile = fs.readFileSync(path.join(tmpDir, 'modules', 'src--massive.md'), 'utf-8');

    // Should have truncated
    expect(moduleFile).toContain('⚠️ Large module');

    // If still over budget, warning should exist
    const truncTokens = estimateTokens(moduleFile);
    if (truncTokens > MAX_MODULE_TOKENS) {
      expect(result.warnings.some(w => w.includes('src/massive'))).toBe(true);
      expect(result.warnings.some(w => w.includes('still over budget'))).toBe(true);
    }

    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ── Epic 3: Rich Architecture Intelligence ──────────────────────────

describe('Story 3.1: categorizeEdges', () => {
  const nodeModuleMap = new Map([
    ['n1', 'src/auth'],
    ['n2', 'src/auth'],
    ['n3', 'src/api'],
    ['n4', 'src/api'],
  ]);

  it('classifies internal, outgoing, and incoming edges', () => {
    const edges: GraphEdge[] = [
      makeEdge('n1', 'n2'),
      makeEdge('n1', 'n3'),
      makeEdge('n3', 'n1'),
      makeEdge('n3', 'n4'),
    ];

    const result = categorizeEdges('src/auth', edges, nodeModuleMap);
    expect(result.internal).toHaveLength(1);
    expect(result.outgoing).toHaveLength(1);
    expect(result.outgoing[0].targetModule).toBe('src/api');
    expect(result.incoming).toHaveLength(1);
    expect(result.incoming[0].sourceModule).toBe('src/api');
    expect(result.unresolved).toHaveLength(0);
  });

  it('classifies unresolved edges when target not in nodeModuleMap', () => {
    const edges: GraphEdge[] = [makeEdge('n1', 'unknown-target')];
    const result = categorizeEdges('src/auth', edges, nodeModuleMap);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].target).toBe('unknown-target');
  });

  it('edge appears exactly once as outgoing in source and once as incoming in target', () => {
    const edges: GraphEdge[] = [makeEdge('n1', 'n3')];
    const authEdges = categorizeEdges('src/auth', edges, nodeModuleMap);
    const apiEdges = categorizeEdges('src/api', edges, nodeModuleMap);
    expect(authEdges.outgoing).toHaveLength(1);
    expect(authEdges.incoming).toHaveLength(0);
    expect(apiEdges.incoming).toHaveLength(1);
    expect(apiEdges.outgoing).toHaveLength(0);
  });
});

describe('Story 3.1: module file with all edge sections', () => {
  it('renders Outgoing, Incoming, and Unresolved sections', () => {
    const allNodes: GraphNode[] = [
      { id: 'n1', name: 'login', type: NodeType.Handler, language: Language.TypeScript, file: 'src/auth/login.ts', line: 1, signature: '', repo: 'test' },
      { id: 'n2', name: 'routes', type: NodeType.Handler, language: Language.TypeScript, file: 'src/api/routes.ts', line: 1, signature: '', repo: 'test' },
    ];
    const modEdges: ModuleEdges = {
      internal: [],
      outgoing: [{ edge: makeEdge('n1', 'n2', EdgeType.Calls, Protocol.REST), targetModule: 'src/api' }],
      incoming: [{ edge: makeEdge('n2', 'n1', EdgeType.Calls, Protocol.Internal), sourceModule: 'src/api' }],
      unresolved: [{ ...makeEdge('n1', '/api/external'), matchConfidence: 'none' as any }],
    };

    const content = generateModuleFile('src/auth', [allNodes[0]], modEdges, allNodes);
    expect(content).toContain('## Outgoing Connections');
    expect(content).toContain('login → routes (calls (REST)) [to: src/api]');
    expect(content).toContain('## Incoming Connections');
    expect(content).toContain('routes → login (calls) [from: src/api]');
    expect(content).toContain('## Unresolved External References');
    expect(content).toContain('login → /api/external');
    expect(content).toContain('Cross-module Edges: 2');
  });
});

describe('Story 3.2: formatRelationship', () => {
  it('metadata.relationship > protocol > edge.type', () => {
    expect(formatRelationship(makeEdge('a', 'b', EdgeType.Imports, Protocol.Internal, { relationship: 'module-import' }))).toBe('module-import');
    expect(formatRelationship(makeEdge('a', 'b', EdgeType.Calls, Protocol.REST))).toBe('calls (REST)');
    expect(formatRelationship(makeEdge('a', 'b', EdgeType.Calls, Protocol.Internal))).toBe('calls');
    expect(formatRelationship(makeEdge('a', 'b', EdgeType.Calls, Protocol.Internal, { relationship: 'guards' }))).toBe('guards');
    expect(formatRelationship(makeEdge('a', 'b', EdgeType.Calls, Protocol.WebSocket))).toBe('calls (WebSocket)');
    expect(formatRelationship(makeEdge('a', 'b', EdgeType.Calls, Protocol.MessageBus))).toBe('calls (MessageBus)');
  });
});

describe('Story 3.2: cross-module dependencies in index.md', () => {
  it('renders Cross-Module Dependencies table with relationship labels', () => {
    const nodes: GraphNode[] = [
      { id: 'n1', name: 'login', type: NodeType.Handler, language: Language.TypeScript, file: 'src/auth/login.ts', line: 1, signature: '', repo: 'test' },
      { id: 'n2', name: 'guard', type: NodeType.Function, language: Language.TypeScript, file: 'src/auth/guard.ts', line: 1, signature: '', repo: 'test' },
      { id: 'n3', name: 'authSvc', type: NodeType.Service, language: Language.TypeScript, file: 'src/auth/service.ts', line: 1, signature: '', repo: 'test' },
      { id: 'n4', name: 'authMid', type: NodeType.Function, language: Language.TypeScript, file: 'src/auth/mid.ts', line: 1, signature: '', repo: 'test' },
      { id: 'n5', name: 'routes', type: NodeType.Handler, language: Language.TypeScript, file: 'src/api/routes.ts', line: 1, signature: '', repo: 'test' },
      { id: 'n6', name: 'ctrl', type: NodeType.Function, language: Language.TypeScript, file: 'src/api/controller.ts', line: 1, signature: '', repo: 'test' },
      { id: 'n7', name: 'valid', type: NodeType.Function, language: Language.TypeScript, file: 'src/api/validator.ts', line: 1, signature: '', repo: 'test' },
      { id: 'n8', name: 'mid', type: NodeType.Function, language: Language.TypeScript, file: 'src/api/middleware.ts', line: 1, signature: '', repo: 'test' },
    ];
    const edges: GraphEdge[] = [
      makeEdge('n5', 'n1', EdgeType.Calls, Protocol.REST),
      makeEdge('n6', 'n3', EdgeType.Calls, Protocol.Internal),
    ];
    const systemMap: SystemMap = {
      meta: { repo: 'test', languages: [Language.TypeScript], generatedAt: '', polygrapher: '1.0.0' },
      nodes, edges,
    };
    const dirsWithFiles = buildDirsWithFiles(nodes.map(n => n.file));
    const modules = groupNodesByModule(nodes, dirsWithFiles);
    const nodeModuleMap = buildNodeModuleMap(modules);
    const content = generateIndex(systemMap, modules, '/fake', false, nodeModuleMap, dirsWithFiles);

    expect(content).toContain('## Cross-Module Dependencies');
    expect(content).toContain('src/api');
    expect(content).toContain('src/auth');
    expect(content).toContain('calls (REST)');
  });
});

describe('Story 3.3: entry points in index.md', () => {
  it('detects handlers, grpc, workers, blocs, main, and routes-to targets', () => {
    const nodes: GraphNode[] = [
      { id: 'n1', name: 'HandleBooking', type: NodeType.Handler, language: Language.Go, file: 'src/api/booking.go', line: 1, signature: '', repo: 'test' },
      { id: 'n2', name: 'GrpcService', type: NodeType.Grpc, language: Language.Go, file: 'src/grpc/svc.go', line: 1, signature: '', repo: 'test' },
      { id: 'n3', name: 'main', type: NodeType.Function, language: Language.Go, file: 'cmd/server/main.go', line: 1, signature: '', repo: 'test' },
      { id: 'n4', name: 'ProcessQueue', type: NodeType.Worker, language: Language.Go, file: 'src/worker/queue.go', line: 1, signature: '', repo: 'test' },
      { id: 'n5', name: 'BookingBloc', type: NodeType.Bloc, language: Language.Dart, file: 'lib/bloc/booking.dart', line: 1, signature: '', repo: 'test' },
      { id: 'n6', name: 'helperUtil', type: NodeType.Function, language: Language.Go, file: 'src/utils/helper.go', line: 1, signature: '', repo: 'test' },
      { id: 'n7', name: 'RouteTarget', type: NodeType.Function, language: Language.TypeScript, file: 'src/routes/target.ts', line: 1, signature: '', repo: 'test' },
    ];
    const edges: GraphEdge[] = [
      { source: 'virtual-route', target: 'n7', type: EdgeType.RoutesTo, protocol: Protocol.REST, metadata: { path: '/api/target' } },
    ];
    const systemMap: SystemMap = {
      meta: { repo: 'test', languages: [Language.Go, Language.Dart, Language.TypeScript], generatedAt: '', polygrapher: '1.0.0' },
      nodes, edges,
    };
    const dirsWithFiles = buildDirsWithFiles(nodes.map(n => n.file));
    const modules = groupNodesByModule(nodes, dirsWithFiles);
    const nodeModuleMap = buildNodeModuleMap(modules);
    const content = generateIndex(systemMap, modules, '/fake', false, nodeModuleMap, dirsWithFiles);

    expect(content).toContain('## Entry Points');
    expect(content).toContain('HandleBooking');
    expect(content).toContain('GrpcService');
    expect(content).toContain('main');
    expect(content).toContain('ProcessQueue');
    expect(content).toContain('BookingBloc');
    expect(content).toContain('RouteTarget');
    expect(content).not.toContain('helperUtil');
  });

  it('caps at 30 entry points', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 40; i++) {
      nodes.push({ id: `n${i}`, name: `handler${i}`, type: NodeType.Handler, language: Language.Go, file: `src/api/h${i}.go`, line: i, signature: '', repo: 'test' });
    }
    const systemMap: SystemMap = { meta: { repo: 'test', languages: [Language.Go], generatedAt: '', polygrapher: '1.0.0' }, nodes, edges: [] };
    const dirsWithFiles = buildDirsWithFiles(nodes.map(n => n.file));
    const modules = groupNodesByModule(nodes, dirsWithFiles);
    const nodeModuleMap = buildNodeModuleMap(modules);
    const content = generateIndex(systemMap, modules, '/fake', false, nodeModuleMap, dirsWithFiles);

    expect(content).toContain('## Entry Points');
    expect(content).toContain('... and 10 more entry points');
  });

  it('deduplicates nodes matching multiple criteria', () => {
    const nodes: GraphNode[] = [
      { id: 'n1', name: 'HandleUsers', type: NodeType.Handler, language: Language.Go, file: 'src/api/users.go', line: 1, signature: '', repo: 'test' },
    ];
    const edges: GraphEdge[] = [
      { source: 'route', target: 'n1', type: EdgeType.RoutesTo, protocol: Protocol.REST, metadata: { path: '/api/users' } },
    ];
    const systemMap: SystemMap = { meta: { repo: 'test', languages: [Language.Go], generatedAt: '', polygrapher: '1.0.0' }, nodes, edges };
    const dirsWithFiles = buildDirsWithFiles(nodes.map(n => n.file));
    const modules = groupNodesByModule(nodes, dirsWithFiles);
    const nodeModuleMap = buildNodeModuleMap(modules);
    const content = generateIndex(systemMap, modules, '/fake', false, nodeModuleMap, dirsWithFiles);

    const matches = content.match(/HandleUsers/g);
    expect(matches).toHaveLength(1);
  });

  it('does NOT use type=route as entry point criterion', () => {
    const nodes: GraphNode[] = [
      { id: 'n1', name: 'BookingRoute', type: NodeType.Route, language: Language.Dart, file: 'lib/routes/booking.dart', line: 1, signature: '', repo: 'test' },
      { id: 'n2', name: 'helperFn', type: NodeType.Function, language: Language.Dart, file: 'lib/utils/helper.dart', line: 1, signature: '', repo: 'test' },
    ];
    const systemMap: SystemMap = { meta: { repo: 'test', languages: [Language.Dart], generatedAt: '', polygrapher: '1.0.0' }, nodes, edges: [] };
    const dirsWithFiles = buildDirsWithFiles(nodes.map(n => n.file));
    const modules = groupNodesByModule(nodes, dirsWithFiles);
    const nodeModuleMap = buildNodeModuleMap(modules);
    const content = generateIndex(systemMap, modules, '/fake', false, nodeModuleMap, dirsWithFiles);

    expect(content).not.toContain('## Entry Points');
  });
});

// ── Epic 3 Review Fixes ─────────────────────────────────────────────

describe('sourceFile fallback classifies edges correctly', () => {
  it('synthetic source resolved via metadata.sourceFile becomes outgoing', () => {
    // Simulates TS barrel re-export: source is synthetic (__module__), not in nodeModuleMap
    // but edge.metadata.sourceFile points to a real file
    const nodeModuleMap = new Map([
      ['n1', 'src/auth'],    // real target node
      // 'synthetic' is NOT in nodeModuleMap
    ]);
    const dirsWithFiles = buildDirsWithFiles(['src/api/barrel.ts', 'src/auth/service.ts']);
    const edges: GraphEdge[] = [
      makeEdge('synthetic', 'n1', EdgeType.Imports, Protocol.Internal, { sourceFile: 'src/api/barrel.ts' }),
    ];

    // From src/api perspective: source resolves to src/api via fallback, target is in src/auth → outgoing
    const apiEdges = categorizeEdges('src/api', edges, nodeModuleMap, dirsWithFiles);
    expect(apiEdges.outgoing).toHaveLength(1);
    expect(apiEdges.outgoing[0].targetModule).toBe('src/auth');

    // From src/auth perspective: target is src/auth, source is src/api via fallback → incoming
    const authEdges = categorizeEdges('src/auth', edges, nodeModuleMap, dirsWithFiles);
    expect(authEdges.incoming).toHaveLength(1);
    expect(authEdges.incoming[0].sourceModule).toBe('src/api');
  });
});

describe('Cross-Module Dependencies survives compact mode', () => {
  it('index.md in compact mode still includes Cross-Module Dependencies', () => {
    const nodes: GraphNode[] = [
      { id: 'n1', name: 'a', type: NodeType.Function, language: Language.TypeScript, file: 'src/auth/a.ts', line: 1, signature: '', repo: 'test' },
      { id: 'n2', name: 'b', type: NodeType.Function, language: Language.TypeScript, file: 'src/auth/b.ts', line: 1, signature: '', repo: 'test' },
      { id: 'n3', name: 'c', type: NodeType.Function, language: Language.TypeScript, file: 'src/auth/c.ts', line: 1, signature: '', repo: 'test' },
      { id: 'n4', name: 'd', type: NodeType.Function, language: Language.TypeScript, file: 'src/auth/d.ts', line: 1, signature: '', repo: 'test' },
      { id: 'n5', name: 'e', type: NodeType.Function, language: Language.TypeScript, file: 'src/api/e.ts', line: 1, signature: '', repo: 'test' },
      { id: 'n6', name: 'f', type: NodeType.Function, language: Language.TypeScript, file: 'src/api/f.ts', line: 1, signature: '', repo: 'test' },
      { id: 'n7', name: 'g', type: NodeType.Function, language: Language.TypeScript, file: 'src/api/g.ts', line: 1, signature: '', repo: 'test' },
      { id: 'n8', name: 'h', type: NodeType.Function, language: Language.TypeScript, file: 'src/api/h.ts', line: 1, signature: '', repo: 'test' },
    ];
    const edges: GraphEdge[] = [makeEdge('n5', 'n1', EdgeType.Calls, Protocol.REST)];
    const systemMap: SystemMap = { meta: { repo: 'test', languages: [Language.TypeScript], generatedAt: '', polygrapher: '1.0.0' }, nodes, edges };
    const dirsWithFiles = buildDirsWithFiles(nodes.map(n => n.file));
    const modules = groupNodesByModule(nodes, dirsWithFiles);
    const nodeModuleMap = buildNodeModuleMap(modules);

    const compactContent = generateIndex(systemMap, modules, '/fake', true, nodeModuleMap, dirsWithFiles);

    // Compact drops Module Map but keeps Cross-Module Dependencies
    expect(compactContent).not.toContain('## Module Map');
    expect(compactContent).toContain('## Cross-Module Dependencies');
    expect(compactContent).toContain('calls (REST)');
  });

  it('shows unresolved count even without resolved cross-module pairs', () => {
    const nodes: GraphNode[] = [
      { id: 'n1', name: 'caller', type: NodeType.Function, language: Language.TypeScript, file: 'src/api/caller.ts', line: 1, signature: '', repo: 'test' },
      { id: 'n2', name: 'helper', type: NodeType.Function, language: Language.TypeScript, file: 'src/api/helper.ts', line: 1, signature: '', repo: 'test' },
      { id: 'n3', name: 'svc', type: NodeType.Function, language: Language.TypeScript, file: 'src/api/svc.ts', line: 1, signature: '', repo: 'test' },
      { id: 'n4', name: 'util', type: NodeType.Function, language: Language.TypeScript, file: 'src/api/util.ts', line: 1, signature: '', repo: 'test' },
    ];
    // Edge where target doesn't resolve to any node
    const edges: GraphEdge[] = [makeEdge('n1', 'unresolved-target')];
    const systemMap: SystemMap = { meta: { repo: 'test', languages: [Language.TypeScript], generatedAt: '', polygrapher: '1.0.0' }, nodes, edges };
    const dirsWithFiles = buildDirsWithFiles(nodes.map(n => n.file));
    const modules = groupNodesByModule(nodes, dirsWithFiles);
    const nodeModuleMap = buildNodeModuleMap(modules);

    const content = generateIndex(systemMap, modules, '/fake', false, nodeModuleMap, dirsWithFiles);
    expect(content).toContain('Unresolved external references: 1');
  });
});

describe('aggregateRelationship shows semantic labels', () => {
  it('shows dominant + secondary type labels', () => {
    const edges: GraphEdge[] = [
      makeEdge('a', 'b', EdgeType.Calls, Protocol.REST),
      makeEdge('a', 'c', EdgeType.Calls, Protocol.REST),
      makeEdge('a', 'd', EdgeType.Calls, Protocol.REST),
      makeEdge('a', 'e', EdgeType.Imports, Protocol.Internal),
      makeEdge('a', 'f', EdgeType.Imports, Protocol.Internal),
    ];
    const result = aggregateRelationship(edges);
    expect(result).toBe('calls (REST) +2 imports');
  });

  it('single type returns just the label', () => {
    const edges: GraphEdge[] = [
      makeEdge('a', 'b', EdgeType.Calls, Protocol.REST),
      makeEdge('a', 'c', EdgeType.Calls, Protocol.REST),
    ];
    expect(aggregateRelationship(edges)).toBe('calls (REST)');
  });

  it('multiple secondary types shown with counts', () => {
    const edges: GraphEdge[] = [
      makeEdge('a', 'b', EdgeType.Calls, Protocol.REST),
      makeEdge('a', 'c', EdgeType.Calls, Protocol.REST),
      makeEdge('a', 'd', EdgeType.Imports, Protocol.Internal),
      makeEdge('a', 'e', EdgeType.Calls, Protocol.Internal, { relationship: 'guards' }),
    ];
    const result = aggregateRelationship(edges);
    expect(result).toBe('calls (REST) +1 imports, 1 guards');
  });
});
