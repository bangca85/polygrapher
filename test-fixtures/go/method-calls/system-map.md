# System Map: method-calls

Generated: 2026-03-25T08:22:20.898Z
Languages: go
Nodes: 3 | Edges: 2

## Functions

### main.go

- **Server.Handle** (main.go:5) — function
  `func (s *Server) Handle()`
- **Server.Process** (main.go:9) — function
  `func (s *Server) Process() string`
- **main** (main.go:13) — function
  `func main()`

## Connections

- Server.Handle → Server.Process (calls/internal)
- main → Server.Handle (calls/internal)
