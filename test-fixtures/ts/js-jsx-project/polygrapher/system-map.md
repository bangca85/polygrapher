# System Map: js-jsx-project

Generated: 2026-03-26T04:49:08.838Z
Languages: typescript
Nodes: 2 | Edges: 1
Branch: main
Commit: `6fd8a9e` — "init project with go extract"

---

## Architecture Summary
| Metric | Count |
|--------|-------|
| Functions | 1 |
| HTTP Handlers | 0 |
| gRPC Endpoints | 0 |
| Workers | 0 |
| Structs | 0 |
| REST Routes | 0 |
| Call Relationships | 1 |

## Functions

### src/App.jsx

- **App** (src/App.jsx:3) — component
  `function App()`

### src/services/api.js

- **fetchPosts** (src/services/api.js:1) — function
  `function fetchPosts()`

## Connections

- fetchPosts -> /api/posts (calls) [method: GET, path: /api/posts]
