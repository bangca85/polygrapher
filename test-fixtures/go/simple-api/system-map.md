# System Map: simple-api

Generated: 2026-03-25T10:48:32.309Z
Languages: go
Nodes: 4 | Edges: 3

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
