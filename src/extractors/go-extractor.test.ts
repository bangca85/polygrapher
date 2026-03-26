import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { GoExtractor } from './go-extractor.js';

const FIXTURES = path.resolve('test-fixtures/go');

describe('GoExtractor', () => {
  const extractor = new GoExtractor();

  describe('simple-api (http.HandleFunc)', () => {
    it('extracts functions with correct fields (FR6)', async () => {
      const files = [path.join(FIXTURES, 'simple-api/main.go')];
      const result = await extractor.parse(files, path.join(FIXTURES, 'simple-api'));

      expect(result.errors).toHaveLength(0);
      expect(result.nodes.length).toBeGreaterThanOrEqual(4);

      const booking = result.nodes.find(n => n.name === 'HandleBooking');
      expect(booking).toBeDefined();
      expect(booking!.type).toBe('handler');
      expect(booking!.file).toBe('main.go');
      expect(booking!.line).toBe(20);
      expect(booking!.signature).toContain('func HandleBooking');
      expect(booking!.language).toBe('go');
      expect(booking!.repo).toBe('simple-api');
    });

    it('extracts http.HandleFunc route edges (FR7)', async () => {
      const files = [path.join(FIXTURES, 'simple-api/main.go')];
      const result = await extractor.parse(files, path.join(FIXTURES, 'simple-api'));

      const routes = result.edges.filter(e => e.type === 'routes-to');
      expect(routes.length).toBeGreaterThanOrEqual(2);

      const healthRoute = routes.find(e => e.metadata?.path === '/health');
      expect(healthRoute).toBeDefined();
      expect(healthRoute!.protocol).toBe('REST');
      expect(healthRoute!.metadata?.method).toBe('ANY');
    });

    it('route edges link to valid node IDs (HIGH fix)', async () => {
      const files = [path.join(FIXTURES, 'simple-api/main.go')];
      const result = await extractor.parse(files, path.join(FIXTURES, 'simple-api'));

      const nodeIds = new Set(result.nodes.map(n => n.id));
      for (const edge of result.edges) {
        expect(nodeIds.has(edge.source)).toBe(true);
        expect(nodeIds.has(edge.target)).toBe(true);
      }
    });

    it('extracts call relationships (FR10)', async () => {
      const files = [path.join(FIXTURES, 'simple-api/main.go')];
      const result = await extractor.parse(files, path.join(FIXTURES, 'simple-api'));

      const calls = result.edges.filter(e => e.type === 'calls');
      expect(calls.length).toBeGreaterThanOrEqual(1);

      // HandleBooking calls GetBookings
      const bookingNode = result.nodes.find(n => n.name === 'HandleBooking');
      const getBookingsNode = result.nodes.find(n => n.name === 'GetBookings');
      expect(bookingNode).toBeDefined();
      expect(getBookingsNode).toBeDefined();

      const callEdge = calls.find(e => e.source === bookingNode!.id && e.target === getBookingsNode!.id);
      expect(callEdge).toBeDefined();
      expect(callEdge!.protocol).toBe('internal');
    });

    it('node IDs are deterministic (AR11)', async () => {
      const files = [path.join(FIXTURES, 'simple-api/main.go')];
      const result1 = await extractor.parse(files, path.join(FIXTURES, 'simple-api'));
      const result2 = await extractor.parse(files, path.join(FIXTURES, 'simple-api'));

      const ids1 = result1.nodes.map(n => n.id).sort();
      const ids2 = result2.nodes.map(n => n.id).sort();
      expect(ids1).toEqual(ids2);
    });
  });

  describe('gin-project (Gin router groups)', () => {
    it('resolves Gin group prefix into full route path (FR7)', async () => {
      const files = [path.join(FIXTURES, 'gin-project/main.go')];
      const result = await extractor.parse(files, path.join(FIXTURES, 'gin-project'));

      const routes = result.edges.filter(e => e.type === 'routes-to');
      const paths = routes.map(e => e.metadata?.path).sort();

      expect(paths).toContain('/api/v1/users');
      expect(paths).toContain('/api/v1/bookings');
    });

    it('route edges use correct HTTP methods', async () => {
      const files = [path.join(FIXTURES, 'gin-project/main.go')];
      const result = await extractor.parse(files, path.join(FIXTURES, 'gin-project'));

      const routes = result.edges.filter(e => e.type === 'routes-to');
      const getUsersRoute = routes.find(e => e.metadata?.path === '/api/v1/users' && e.metadata?.method === 'GET');
      const postUsersRoute = routes.find(e => e.metadata?.path === '/api/v1/users' && e.metadata?.method === 'POST');

      expect(getUsersRoute).toBeDefined();
      expect(postUsersRoute).toBeDefined();
    });

    it('all edge source/target reference existing node IDs', async () => {
      const files = [path.join(FIXTURES, 'gin-project/main.go')];
      const result = await extractor.parse(files, path.join(FIXTURES, 'gin-project'));

      const nodeIds = new Set(result.nodes.map(n => n.id));
      for (const edge of result.edges) {
        expect(nodeIds.has(edge.source), `source ${edge.source} not in nodes`).toBe(true);
        expect(nodeIds.has(edge.target), `target ${edge.target} not in nodes`).toBe(true);
      }
    });
  });

  describe('method-calls (Type.Method call resolution)', () => {
    it('resolves method-to-method call edges (FR10 - method calls)', async () => {
      const files = [path.join(FIXTURES, 'method-calls/main.go')];
      const result = await extractor.parse(files, path.join(FIXTURES, 'method-calls'));

      const handleNode = result.nodes.find(n => n.name === 'Server.Handle');
      const processNode = result.nodes.find(n => n.name === 'Server.Process');
      expect(handleNode).toBeDefined();
      expect(processNode).toBeDefined();

      // Server.Handle calls Server.Process via s.Process()
      const callEdge = result.edges.find(
        e => e.type === 'calls' && e.source === handleNode!.id && e.target === processNode!.id
      );
      expect(callEdge).toBeDefined();
      expect(callEdge!.protocol).toBe('internal');
    });

    it('resolves function-to-method call edges', async () => {
      const files = [path.join(FIXTURES, 'method-calls/main.go')];
      const result = await extractor.parse(files, path.join(FIXTURES, 'method-calls'));

      const mainNode = result.nodes.find(n => n.name === 'main');
      const handleNode = result.nodes.find(n => n.name === 'Server.Handle');
      expect(mainNode).toBeDefined();
      expect(handleNode).toBeDefined();

      // main calls srv.Handle() which should resolve to Server.Handle
      const callEdge = result.edges.find(
        e => e.type === 'calls' && e.source === mainNode!.id && e.target === handleNode!.id
      );
      expect(callEdge).toBeDefined();
    });

    it('all edges reference valid node IDs', async () => {
      const files = [path.join(FIXTURES, 'method-calls/main.go')];
      const result = await extractor.parse(files, path.join(FIXTURES, 'method-calls'));

      const nodeIds = new Set(result.nodes.map(n => n.id));
      for (const edge of result.edges) {
        expect(nodeIds.has(edge.source), `source ${edge.source} missing`).toBe(true);
        expect(nodeIds.has(edge.target), `target ${edge.target} missing`).toBe(true);
      }
    });

    it('prefers same-file method when short names collide (ambiguous resolution)', async () => {
      // main.go has Server.Process, service.go has Cache.Process
      // Server.Handle (main.go) calls s.Process() — should resolve to Server.Process (same file)
      // UseCache (service.go) calls c.Process() — should resolve to Cache.Process (same file)
      const files = [
        path.join(FIXTURES, 'method-calls/main.go'),
        path.join(FIXTURES, 'method-calls/service.go'),
      ];
      const result = await extractor.parse(files, path.join(FIXTURES, 'method-calls'));

      const serverProcess = result.nodes.find(n => n.name === 'Server.Process');
      const cacheProcess = result.nodes.find(n => n.name === 'Cache.Process');
      const handleNode = result.nodes.find(n => n.name === 'Server.Handle');
      const useCacheNode = result.nodes.find(n => n.name === 'UseCache');

      expect(serverProcess).toBeDefined();
      expect(cacheProcess).toBeDefined();
      expect(handleNode).toBeDefined();
      expect(useCacheNode).toBeDefined();

      // Server.Handle -> s.Process() should resolve to Server.Process (same file: main.go)
      const handleCall = result.edges.find(
        e => e.type === 'calls' && e.source === handleNode!.id && e.target === serverProcess!.id
      );
      expect(handleCall).toBeDefined();

      // UseCache -> c.Process() should resolve to Cache.Process (same file: service.go)
      const cacheCall = result.edges.find(
        e => e.type === 'calls' && e.source === useCacheNode!.id && e.target === cacheProcess!.id
      );
      expect(cacheCall).toBeDefined();
    });

    it('extracts Echo router groups and routes', async () => {
      const files = [path.join(FIXTURES, 'echo-api/main.go')];
      const result = await extractor.parse(files, path.join(FIXTURES, 'echo-api'));

      const routeEdges = result.edges.filter(e => e.type === 'routes-to');
      expect(routeEdges).toContainEqual(expect.objectContaining({ metadata: { method: 'POST', path: '/api/v1/register' } }));

      // Inline func cannot be resolved by name easily because there's no node for func_literal, 
      // so the edge for GET /health might be dropped if handler name "func1" has no node. 
      // But RegisterUser has a node.
      const registerUser = result.nodes.find(n => n.name === 'RegisterUser');
      expect(registerUser).toBeDefined();
      expect(registerUser!.type).toBe('handler');
    });

    it('extracts Beego router declarations', async () => {
      const files = [path.join(FIXTURES, 'beego-api/main.go')];
      const result = await extractor.parse(files, path.join(FIXTURES, 'beego-api'));

      const routeEdges = result.edges.filter(e => e.type === 'routes-to');
      expect(routeEdges).toContainEqual(expect.objectContaining({ metadata: { method: 'ANY', path: '/api/home' } }));

      const targetEdge = routeEdges.find(e => e.metadata?.path === '/api/home');
      const targetNode = result.nodes.find(n => n.id === targetEdge?.target);
      expect(targetNode?.name).toBe('MainController');
    });

    it('extracts Asynq worker handlers and generic mux.HandleFunc', async () => {
      const files = [path.join(FIXTURES, 'asynq-worker/main.go')];
      const result = await extractor.parse(files, path.join(FIXTURES, 'asynq-worker'));

      // HandleEmailSignup has *asynq.Task parameter -> should be a Worker
      const worker = result.nodes.find(n => n.name === 'HandleEmailSignup');
      expect(worker).toBeDefined();
      expect(worker!.type).toBe('worker');

      const routeEdges = result.edges.filter(e => e.type === 'routes-to');
      expect(routeEdges).toContainEqual(expect.objectContaining({ metadata: { method: 'ANY', path: 'email:signup' } }));
      
      const targetEdge = routeEdges.find(e => e.metadata?.path === 'email:signup');
      expect(targetEdge?.target).toBe(worker!.id);
    });

    it('extracts Kratos and generic gRPC server registrations', async () => {
      const files = [path.join(FIXTURES, 'kratos-grpc/main.go')];
      const result = await extractor.parse(files, path.join(FIXTURES, 'kratos-grpc'));

      const routeEdges = result.edges.filter(e => e.type === 'routes-to');
      expect(routeEdges).toContainEqual(expect.objectContaining({ metadata: { method: 'gRPC', path: 'Greeter' } }));

      // The edge should point to GreeterService struct or constructor
      const targetEdge = routeEdges.find(e => e.metadata?.path === 'Greeter');
      const targetNode = result.nodes.find(n => n.id === targetEdge?.target);
      expect(targetNode?.name).toBe('GreeterService');
    });
  });

  describe('grpc-service (gRPC + grouped structs)', () => {
    it('gRPC service methods produce edges with protocol gRPC (FR8)', async () => {
      const files = [path.join(FIXTURES, 'grpc-service/main.go')];
      const result = await extractor.parse(files, path.join(FIXTURES, 'grpc-service'));

      // CreateBooking calls NewBooking — should be gRPC protocol since source is gRPC method
      const createNode = result.nodes.find(n => n.name === 'BookingServer.CreateBooking');
      expect(createNode).toBeDefined();
      expect(createNode!.type).toBe('grpc');

      const grpcEdge = result.edges.find(
        e => e.source === createNode!.id && e.type === 'calls'
      );
      expect(grpcEdge).toBeDefined();
      expect(grpcEdge!.protocol).toBe('gRPC');
    });

    it('non-gRPC functions still use internal protocol', async () => {
      const files = [path.join(FIXTURES, 'grpc-service/main.go')];
      const result = await extractor.parse(files, path.join(FIXTURES, 'grpc-service'));

      const newBookingNode = result.nodes.find(n => n.name === 'NewBooking');
      expect(newBookingNode).toBeDefined();
      expect(newBookingNode!.type).toBe('function');
    });

    it('extracts all structs from grouped type(...) block (FR9)', async () => {
      const files = [path.join(FIXTURES, 'grpc-service/main.go')];
      const result = await extractor.parse(files, path.join(FIXTURES, 'grpc-service'));

      const structNodes = result.nodes.filter(n => n.type === 'struct');
      const structNames = structNodes.map(n => n.name).sort();

      // type ( Booking struct{...}; Event struct{...} ) + type BookingServer struct{...}
      expect(structNames).toContain('Booking');
      expect(structNames).toContain('Event');
      expect(structNames).toContain('BookingServer');
    });

    it('struct nodes have correct fields in signature (FR9)', async () => {
      const files = [path.join(FIXTURES, 'grpc-service/main.go')];
      const result = await extractor.parse(files, path.join(FIXTURES, 'grpc-service'));

      const booking = result.nodes.find(n => n.name === 'Booking' && n.type === 'struct');
      expect(booking).toBeDefined();
      expect(booking!.signature).toContain('ID string');
      expect(booking!.signature).toContain('UserID string');
    });
  });

  describe('orm-models (GORM and Ent)', () => {
    it('detects embedded ORM structs and converts to entity type', async () => {
      const files = [path.join(FIXTURES, 'orm-models/main.go')];
      const result = await extractor.parse(files, path.join(FIXTURES, 'orm-models'));

      const userNode = result.nodes.find(n => n.name === 'User');
      expect(userNode).toBeDefined();
      expect(userNode!.type).toBe('entity');

      const productNode = result.nodes.find(n => n.name === 'Product');
      expect(productNode).toBeDefined();
      expect(productNode!.type).toBe('entity');

      const carNode = result.nodes.find(n => n.name === 'Car');
      expect(carNode).toBeDefined();
      expect(carNode!.type).toBe('entity');

      const dtoNode = result.nodes.find(n => n.name === 'DTO');
      expect(dtoNode).toBeDefined();
      expect(dtoNode!.type).toBe('struct');
    });
  });

  describe('detect', () => {
    it('returns true for directory with go.mod', async () => {
      expect(await extractor.detect(path.join(FIXTURES, 'simple-api'))).toBe(true);
    });

    it('returns false for directory without go.mod', async () => {
      expect(await extractor.detect(path.resolve('test-fixtures/unsupported-lang'))).toBe(false);
    });
  });
});
