package main

import (
	"context"
)

type HelloRequest struct{}
type HelloReply struct{}

type GreeterService struct{}

func (s *GreeterService) SayHello(ctx context.Context, req *HelloRequest) (*HelloReply, error) {
	return &HelloReply{}, nil
}

// Mocking the generated protobuf registration function
func RegisterGreeterServer(srv interface{}, s *GreeterService) {}

func main() {
	pb.RegisterGreeterServer(nil, &GreeterService{})
}
