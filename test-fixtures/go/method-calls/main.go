package main

type Server struct{}

func (s *Server) Handle() {
	s.Process()
}

func (s *Server) Process() string {
	return "done"
}

func main() {
	srv := &Server{}
	srv.Handle()
}
