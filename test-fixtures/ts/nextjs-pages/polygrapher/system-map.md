# System Map: nextjs-pages

Generated: 2026-03-26T05:28:53.407Z
Languages: typescript
Nodes: 7 | Edges: 4
Branch: main
Commit: `6fd8a9e` — "init project with go extract"

---

## Architecture Summary
| Metric | Count |
|--------|-------|
| Functions | 4 |
| HTTP Handlers | 2 |
| gRPC Endpoints | 0 |
| Workers | 0 |
| Structs | 0 |
| REST Routes | 2 |
| Call Relationships | 1 |

### Detected Patterns
- HTTP Handlers: 2

---

## Functions

### components/BookingForm.tsx

- **BookingForm** (components/BookingForm.tsx:4) — component
  `const BookingForm = () =>`
- **handleSubmit** (components/BookingForm.tsx:5) — function
  `const handleSubmit = () =>`

### lib/helper.ts

- **helperFunc** (lib/helper.ts:1) — function
  `function helperFunc()`

### pages/api/booking.ts

- **handler** (pages/api/booking.ts:3) — handler
  `function handler(req: NextApiRequest, res: NextApiResponse)`
- **route-setup** (pages/api/booking.ts:0) — function

### pages/api/users/[id].ts

- **getUserById** (pages/api/users/[id].ts:3) — handler
  `function getUserById(req: NextApiRequest, res: NextApiResponse)`
- **route-setup** (pages/api/users/[id].ts:0) — function

## Connections

- BookingForm -> helperFunc (imports) [sourceFile: components/BookingForm.tsx]
- handleSubmit -> handler (calls) [method: POST, path: /api/booking]
- route-setup -> handler (routes-to) [method: ANY, path: /api/booking]
- route-setup -> getUserById (routes-to) [method: ANY, path: /api/users/:id]
