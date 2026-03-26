# System Map: react-vanilla

Generated: 2026-03-26T04:49:08.738Z
Languages: typescript
Nodes: 5 | Edges: 2
Branch: main
Commit: `6fd8a9e` — "init project with go extract"

---

## Architecture Summary
| Metric | Count |
|--------|-------|
| Functions | 3 |
| HTTP Handlers | 0 |
| gRPC Endpoints | 0 |
| Workers | 0 |
| Structs | 0 |
| REST Routes | 0 |
| Call Relationships | 2 |

## Functions

### src/components/Dashboard.tsx

- **Dashboard** (src/components/Dashboard.tsx:3) — component
  `function Dashboard()`

### src/components/UserProfile.tsx

- **UserProfile** (src/components/UserProfile.tsx:3) — component
  `class UserProfile extends React.Component`

### src/services/api.ts

- **fetchUsers** (src/services/api.ts:3) — function
  `function fetchUsers()`
- **createBooking** (src/services/api.ts:7) — function
  `function createBooking(data: any)`
- **getUser** (src/services/api.ts:11) — function
  `function getUser(id: string)`

## Connections

- fetchUsers -> /api/users (calls) [method: GET, path: /api/users]
- createBooking -> /api/booking (calls) [method: POST, path: /api/booking]
