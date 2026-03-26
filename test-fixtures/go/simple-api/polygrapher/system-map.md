# System Map: simple-api

Generated: 2026-03-26T02:25:09.363Z
Languages: go
Nodes: 4 | Edges: 3

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
| gRPC Endpoints | 0 |
| Workers | 0 |
| Structs | 0 |
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
