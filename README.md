# polygrapher

Zero-config CLI that generates instant, interactive codebase maps.

Run `npx polygrapher` in any **Go**, **TypeScript/React/Next.js**, or **Dart/Flutter** project and get a visual, searchable graph of your codebase — functions, routes, handlers, components, BLoCs, providers, and how they connect — rendered in an interactive browser-based viewer.

## Quick Start

```bash
npx polygrapher
```

That's it. Your browser opens with an interactive map of your codebase.

Works with: **Go** (Gin, Chi, Echo, Fiber, gRPC) | **TypeScript/JavaScript** (Next.js, NestJS, React, Express) | **Dart/Flutter** (BLoC, Riverpod, GetX, Dio) | **Monorepos**

## Features

- **Zero config** — no setup files, no accounts, no API keys. Just run it.
- **Multi-language** — Go, TypeScript/React, and Dart/Flutter in a single unified graph
- **Interactive viewer** — clickable graph with search, type filters, and detail panel
- **Graph + List + Flow views** — switch between visual graph, sortable table, and call flow tracing
- **Call flow tracing** — select an entry point (route, handler, component) and see the complete downstream call chain as an interactive tree
- **Function hotness** — sort by connection count, identify hot functions and dead code at a glance
- **Path tracing** — click any node to highlight upstream/downstream call chains with depth indicators
- **Edge interaction** — click or hover edges to see connection metadata and call site locations
- **Auto-clustering** — large graphs (50+ nodes) auto-group by package/file, with collapse/expand
- **Minimap** — overview navigation for large graphs, auto-hidden on small ones
- **Click-to-inspect** — click any node to see signature, file location, and connections
- **VS Code integration** — file links open directly in your editor
- **Shareable HTML** — self-contained HTML file you can drop in Slack or a PR
- **Tech stack detection** — auto-detects frameworks, databases, and dependencies from go.mod / package.json
- **Cross-language edges** — TypeScript `fetch('/api/booking')` or Dart `dio.get('/api/booking')` automatically links to Go handler for the same route
- **Offline** — runs entirely on your machine, no network calls
- **Fast** — powered by Tree-sitter WASM for native-speed parsing

## What It Detects

### Go

| Type | Examples |
|------|---------|
| Functions | `func`, method declarations |
| HTTP Handlers | Gin (`.GET`, `.POST`, `.Group`), Chi, Echo, Fiber, Beego, `http.HandleFunc` |
| gRPC Services | Methods with `context.Context` + protobuf request/response, Kratos |
| Workers | Kafka consumers, Asynq task processors (detected by signature) |
| Services | Auto-detected from `cmd/*/main.go` (standard Go project layout) |
| Structs | Single and grouped `type (...) struct` declarations |
| Entities | GORM (`gorm.Model`) and Ent (`ent.Schema`) models |
| Routes | Full path resolution including Gin/Echo router groups |
| Call Graph | Function-to-function calls with same-file preference |

### TypeScript / JavaScript / React

| Type | Examples |
|------|---------|
| Components | `export default function Page()`, `export const Card = () => <div>`, class components |
| Hooks | Custom hooks (`useBooking`, `useAuth`, `useDebounce`) |
| Handlers | Next.js API routes (`export function GET/POST/PUT/DELETE`) |
| Services | NestJS `@Injectable()` classes |
| Modules | NestJS `@Module()` with imports/providers/controllers wiring |
| Guards | NestJS `@Injectable() implements CanActivate` |
| Interceptors | NestJS `@Injectable() implements NestInterceptor` |
| Routes | App Router, Pages Router, NestJS `@Controller()` decorators, React Router, Express |
| API Calls | `fetch('/api/...')`, `axios.get(...)` with method + path extraction |
| Imports | ESM `import`, CJS `require()`, dynamic `import()` — with `@/` alias support |
| Dynamic Imports | `next/dynamic`, `React.lazy` — resolved to target component |

**Next.js support:**
- App Router: `page.tsx`, `layout.tsx`, `route.ts` with dynamic segments (`[id]`, `[...slug]`, `[[...slug]]`)
- Pages Router: `pages/api/**` and `pages/**` with dynamic routes
- Route groups `(group)` automatically stripped from paths
- `src/app/` and monorepo `apps/*/src/app/` paths handled automatically

**NestJS support:**
- `@Controller()` with `@Get()`, `@Post()`, `@Put()`, `@Delete()`, `@Patch()` route extraction
- `@Module()` detection with provider/controller/import relationships
- `@Injectable()` guards (`CanActivate`) and interceptors (`NestInterceptor`)
- `@MessagePattern()` and `@EventPattern()` for microservice handlers
- `@SubscribeMessage()` for WebSocket gateways
- Controller route prefix combined with method-level paths

**React Router / Express support:**
- React Router v6/v7 route definitions (`createBrowserRouter`, `<Route>`)
- Express `app.get()`, `app.post()`, `router.use()` route extraction

### Dart / Flutter

| Type | Examples |
|------|---------|
| BLoC/Cubit | `extends Bloc<Event, State>`, `extends Cubit<State>` |
| Riverpod | `StateNotifierProvider`, `@riverpod` annotated functions, `ref.watch`/`ref.read` edges |
| GetX | `GetxController`, `.obs` reactive variables, `Get.put()`/`Get.find()` |
| Components | `StatelessWidget`, `StatefulWidget`, `HookWidget`, `ConsumerWidget` |
| Services | Classes ending in `Service`, `Repository`, `UseCase`, `DataSource`, `Impl` |
| Models | `@freezed`, `@JsonSerializable`, `@Entity` annotated classes |
| Routing | GoRouter (`GoRoute(path: ...)` + constant refs), AutoRoute (`@RoutePage`) |
| API Calls | `dio.get('/...')`, `dio.post(...)`, `http.get(Uri.parse(...))` |
| Retrofit | `@RestApi` interfaces with `@GET`/`@POST`/`@PUT`/`@DELETE` annotations |
| DI | GetIt (`registerSingleton`, `getIt<T>()`), `@injectable`/`@singleton`/`@module` |
| Database | Floor (`@Database`, `@dao`), Drift (`@DriftDatabase`) with DAO-Entity edges |
| Architecture | Clean Architecture (`domain/data/presentation`) and Feature-first (`features/*/`) auto-clustering |

**Framework auto-detection** from `pubspec.yaml`:
- Detects `flutter_bloc`, `riverpod`, `get`, `go_router`, `auto_route`, `dio`, `retrofit`, `freezed`, `get_it`, `floor`, `drift`, `mobx`
- Generated files (`*.g.dart`, `*.freezed.dart`) automatically excluded
- Constructor + field dependency injection edges extracted for full chain visibility
- Cross-language matching: `dio.get('/api/booking')` in Dart links to Go/TS backend handler

## Usage

```bash
# Scan current directory and open interactive viewer
polygrapher

# Scan a specific directory
polygrapher ./path/to/project

# Export files only (JSON + Markdown + HTML), no viewer
polygrapher --export-only

# Custom viewer port (default: 3030)
polygrapher --port 4000

# Force a specific language extractor
polygrapher --lang go
polygrapher --lang typescript
polygrapher --lang dart
```

## Output

Polygrapher generates three files in a `polygrapher/` subfolder within the target directory:

| File | Description |
|------|-------------|
| `polygrapher/system-map.json` | Machine-readable graph (nodes + edges + metadata) |
| `polygrapher/system-map.md` | Human-readable summary with tech stack, architecture stats, and connections |
| `polygrapher/system-map.html` | Self-contained interactive viewer (shareable, works offline) |

## Interactive Viewer

The viewer opens automatically at `http://127.0.0.1:3030` and includes:

- **Search** — find functions, handlers, components, hooks, files, or routes by name
- **Type filters** — toggle visibility by type (function, handler, service, gRPC, route, component, hook, struct, worker, bloc, model, module, guard, interceptor)
- **Three views:**
  - **Graph** — visual node graph with force-directed layout
  - **List** — sortable table with columns for In, Out, Total connections, and Heat indicator
  - **Flow** — select an entry point and trace the complete call flow as an interactive tree
- **Detail panel** — click any node to see:
  - Hotness indicator (Dead / Low / Active / Hot)
  - Function signature
  - File path + line number (clickable to VS Code)
  - Incoming and outgoing connections
- **Flow view features:**
  - Searchable entry point picker with type-ahead filtering (grouped by: Routes, Services, Handlers, gRPC, Components, Functions)
  - Adjustable depth limit (3-20) with real-time slider
  - Circular reference detection with `[circular]` badges
  - Graph syncs to show only traced nodes with clean layout
  - Right-click any graph node to "Trace from here"
  - Keyboard: `F` (open), `Esc` (close), `1-9` (set depth)
- **Function hotness & dead code:**
  - Node size scales with connection count (20-60px)
  - Dead code: dashed red border on nodes with 0 callers (excluding entry points)
  - Heat column in List view with visual bars
  - Column help tooltips (click `?` icon for explanation)
- **Path tracing** — click a node then trace upstream, downstream, or both
- **Edge interaction** — hover for tooltip, click for full metadata with call site links
- **Auto-clustering** — auto-group by package/file, collapse/expand clusters
- **Minimap** — bottom-right overview, drag to navigate
- **Color-coded nodes:**

| Type | Color |
|------|-------|
| function | blue |
| handler | purple |
| service | green |
| gRPC | bright green |
| route | orange |
| component | red |
| hook | light blue |
| struct | yellow |
| worker | lavender |
| entity | lavender |
| bloc | purple |
| model | yellow |
| module | lavender |
| guard | orange |
| interceptor | lavender |

## Tech Stack Detection

Polygrapher automatically detects your project's tech stack from config files:

**Go** (from `go.mod`):
- Framework: Gin, Chi, Echo, Fiber
- Database: PostgreSQL (pgx), MySQL, MongoDB, GORM
- Cache: Redis, Memcached
- Queue: Kafka, RabbitMQ, NATS
- gRPC, Auth (JWT), Cloud (AWS, GCP), Logging, and more

**TypeScript/JavaScript** (from `package.json`):
- Framework: Next.js, React, Vue, Angular, Express, NestJS
- State: Redux, Zustand, MobX, Jotai
- Database: Prisma, TypeORM, Drizzle, Mongoose
- API: GraphQL, Apollo, tRPC, Axios, React Query
- Styling: Tailwind, MUI, Chakra, Ant Design
- Testing: Jest, Vitest, Playwright, Cypress
- And 80+ more packages categorized automatically

**Dart/Flutter** (from `pubspec.yaml`):
- State: BLoC, Riverpod, GetX, MobX
- Routing: GoRouter, AutoRoute
- HTTP: Dio, http
- DI: GetIt, Injectable
- Database: Floor, Drift
- Code Gen: Freezed, JsonSerializable
- API: Retrofit
- Backend: Firebase

Tech stack info appears in the `system-map.md` output as a Dependencies table with auto-categorization.

## JSON Schema

```json
{
  "meta": {
    "repo": "my-project",
    "languages": ["go", "typescript"],
    "generatedAt": "2026-03-26T10:00:00.000Z",
    "polygrapher": "0.5.0"
  },
  "nodes": [
    {
      "id": "a1b2c3d4e5f6",
      "name": "GET /api/booking",
      "type": "handler",
      "language": "typescript",
      "file": "src/app/api/booking/route.ts",
      "line": 3,
      "signature": "export async function GET(request: Request)",
      "repo": "my-project"
    }
  ],
  "edges": [
    {
      "source": "a1b2c3d4e5f6",
      "target": "f6e5d4c3b2a1",
      "type": "calls",
      "protocol": "REST",
      "metadata": { "method": "GET", "path": "/api/booking" },
      "callLine": 45
    }
  ]
}
```

**Node types:** `function`, `handler`, `component`, `hook`, `service`, `grpc`, `route`, `struct`, `worker`, `entity`, `bloc`, `model`, `module`, `guard`, `interceptor`

**Edge types:** `calls`, `imports`, `routes-to`

**Protocols:** `REST`, `gRPC`, `internal`, `WebSocket`, `MessageBus`

## CI Integration

Auto-update your system map on every merge:

```yaml
# .github/workflows/system-map.yml
on:
  push:
    branches: [main]

jobs:
  system-map:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npx polygrapher --export-only
      - run: |
          git add polygrapher/
          git commit -m "docs: update system map" || true
          git push
```

## Requirements

- Node.js >= 20

## Roadmap

- [x] Go extractor (Gin, Chi, gRPC, stdlib)
- [x] Path tracing (upstream/downstream call chains)
- [x] Edge interaction (click/hover with call site links)
- [x] Auto-clustering (collapse/expand, aggregated edges)
- [x] Minimap navigation
- [x] Function hotness & dead code detection
- [x] Call flow tracing (Flow view)
- [x] TypeScript / JavaScript / React extractor
- [x] Next.js App Router + Pages Router support
- [x] Cross-language edge resolution (TS fetch -> Go handler)
- [x] Tech stack detection (go.mod + package.json)
- [x] Monorepo support (Turborepo, pnpm workspaces)
- [x] Dart / Flutter extractor (BLoC, Riverpod, GetX, Widgets, Dio, Retrofit, Freezed, GoRouter, AutoRoute)
- [x] Dart/Flutter production features (GetIt DI, Floor/Drift, MobX, architecture detection, constructor deps)
- [x] Cross-language matching with confidence scoring (exact/partial/inferred)
- [x] NestJS support (modules, guards, interceptors, microservices, WebSocket gateways)
- [x] Go service detection from `cmd/*/main.go` (standard Go microservice layout)
- [x] Go worker detection (Kafka consumers, Asynq workers)
- [x] Go ORM entity detection (GORM, Ent)
- [x] React Router v6/v7 and Express route extraction
- [x] Searchable flow entry point picker
- [ ] Multi-repo support (GitHub org connector)
- [ ] AI-powered cross-repo code review

## License

MIT
