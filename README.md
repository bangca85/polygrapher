# polygrapher

Zero-config CLI that generates instant, interactive codebase maps.

Run `npx polygrapher` in any Go project and get a visual, searchable graph of your codebase — functions, routes, handlers, services, structs, and how they connect — rendered in an interactive browser-based viewer.

## Quick Start

```bash
npx polygrapher
```

That's it. Your browser opens with an interactive map of your codebase.

## Features

- **Zero config** — no setup files, no accounts, no API keys. Just run it.
- **Interactive viewer** — clickable graph with search, type filters, and detail panel
- **Graph + List views** — switch between visual graph and sortable table
- **Path tracing** — click any node to highlight upstream/downstream call chains with depth indicators
- **Edge interaction** — click or hover edges to see connection metadata and call site locations
- **Auto-clustering** — large graphs (50+ nodes) auto-group by package/file, with collapse/expand
- **Minimap** — overview navigation for large graphs, auto-hidden on small ones
- **Click-to-inspect** — click any node to see signature, file location, and connections
- **VS Code integration** — file links open directly in your editor
- **Shareable HTML** — self-contained HTML file you can drop in Slack or a PR
- **Offline** — runs entirely on your machine, no network calls
- **Fast** — powered by Tree-sitter WASM for native-speed parsing

## What It Detects

### Go

| Type | Examples |
|------|---------|
| Functions | `func`, method declarations |
| HTTP Handlers | Gin (`.GET`, `.POST`, `.Group`), Chi, `http.HandleFunc` |
| gRPC Services | Methods with `context.Context` + protobuf request/response |
| Structs | Single and grouped `type (...) struct` declarations |
| Routes | Full path resolution including Gin router groups |
| Call Graph | Function-to-function calls with same-file preference |

> TypeScript/React and Flutter extractors are coming in future releases.

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
```

## Output

Polygrapher generates three files in a `polygrapher/` subfolder within the target directory:

| File | Description |
|------|-------------|
| `polygrapher/system-map.json` | Machine-readable graph (nodes + edges + metadata) |
| `polygrapher/system-map.md` | Human-readable summary with stats and connections |
| `polygrapher/system-map.html` | Self-contained interactive viewer (shareable, works offline) |

## Interactive Viewer

The viewer opens automatically at `http://127.0.0.1:3030` and includes:

- **Search** — find functions, handlers, files, or routes by name
- **Type filters** — toggle visibility of functions, handlers, services, routes, structs
- **Graph / List toggle** — switch between visual graph and sortable table view
- **Detail panel** — click any node to see:
  - Function signature
  - File path + line number (clickable to VS Code)
  - Incoming and outgoing connections
  - Node type, language, and protocol
- **Path tracing** — click a node then trace upstream (callers), downstream (callees), or both:
  - Depth indicators show hop count from selected node
  - Non-traced nodes dim to 10% opacity
  - Leaf nodes and cycles are visually marked
  - Toggle between upstream/downstream/both via buttons
- **Edge interaction** — hover for tooltip, click for full metadata:
  - Source and target nodes, edge type, protocol
  - Call site file:line with VS Code deep-link
- **Auto-clustering** — graphs with 50+ nodes auto-group by package/file:
  - Collapse clusters into summary nodes with node count
  - Expand to reveal individual nodes
  - Aggregated edges with count badges between collapsed clusters
- **Minimap** — bottom-right overview panel for large graphs:
  - Click and drag to navigate
  - Reflects active traces and search state
  - Auto-hidden on graphs under 30 nodes
- **Color-coded nodes** — blue (function), purple (handler), green (service), orange (route), yellow (struct)
- **Adaptive layout** — automatically adjusts spacing for large codebases (80+ nodes)

## JSON Schema

```json
{
  "meta": {
    "repo": "my-project",
    "languages": ["go"],
    "generatedAt": "2026-03-25T10:00:00.000Z",
    "polygrapher": "0.1.0"
  },
  "nodes": [
    {
      "id": "a1b2c3d4e5f6",
      "name": "HandleBooking",
      "type": "handler",
      "language": "go",
      "file": "api/booking.go",
      "line": 42,
      "signature": "func HandleBooking(c *gin.Context)",
      "repo": "my-project"
    }
  ],
  "edges": [
    {
      "source": "a1b2c3d4e5f6",
      "target": "f6e5d4c3b2a1",
      "type": "calls",
      "protocol": "internal",
      "callLine": 45
    }
  ]
}
```

## Requirements

- Node.js >= 20

## Roadmap

- [x] Go extractor (Gin, Chi, gRPC, stdlib)
- [x] Path tracing (upstream/downstream call chains)
- [x] Edge interaction (click/hover with call site links)
- [x] Auto-clustering (collapse/expand, aggregated edges)
- [x] Minimap navigation
- [ ] TypeScript / JavaScript / React extractor
- [ ] Dart / Flutter extractor
- [ ] Multi-repo support
- [ ] AI-powered cross-repo code review

## License

MIT
