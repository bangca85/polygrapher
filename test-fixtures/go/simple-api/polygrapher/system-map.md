# System Map: simple-api

Generated: 2026-03-26T11:20:49.317Z
Languages: go
Nodes: 4 | Edges: 3
Branch: main
Commit: `6fd8a9e` — "init project with go extract"

---

## Tech Stack

### Language & Runtime
- **Go** 1.21 (from go.mod)
- Module: `test-simple-api`

## Architecture Summary
| Metric | Count |
|--------|-------|
| Functions | 2 |
| HTTP Handlers | 2 |
| REST Routes | 2 |
| Call Relationships | 1 |

## Functions

### main.go

- **main** (main.go:8) — function
  `func main()`
- **HandleHealth** (main.go:15) — handler
  `func HandleHealth(w http.ResponseWriter, r *http.Request)`
- **HandleBooking** (main.go:20) — handler
  `func HandleBooking(w http.ResponseWriter, r *http.Request)`
- **GetBookings** (main.go:26) — function
  `func GetBookings() []string`

## Connections

- HandleBooking -> GetBookings (calls)
- main -> HandleHealth (routes-to) [method: ANY, path: /health]
- main -> HandleBooking (routes-to) [method: ANY, path: /api/booking]
