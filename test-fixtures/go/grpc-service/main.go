package main

import (
	"context"
	pb "grpc-service/proto"
)

type (
	Booking struct {
		ID      string
		UserID  string
		EventID string
		Status  string
	}

	Event struct {
		ID   string
		Name string
	}
)

type BookingServer struct {
	pb.UnimplementedBookingServiceServer
}

func (s *BookingServer) CreateBooking(ctx context.Context, req *pb.CreateBookingRequest) (*pb.CreateBookingResponse, error) {
	booking := NewBooking(req)
	return &pb.CreateBookingResponse{Id: booking.ID}, nil
}

func (s *BookingServer) GetBooking(ctx context.Context, req *pb.GetBookingRequest) (*pb.BookingResponse, error) {
	return &pb.BookingResponse{}, nil
}

func (s *BookingServer) ListBookings(ctx context.Context, req *pb.ListBookingsRequest) (*pb.ListBookingsResponse, error) {
	return &pb.ListBookingsResponse{}, nil
}

func NewBooking(req *pb.CreateBookingRequest) *Booking {
	return &Booking{
		ID:     "new-id",
		UserID: req.UserId,
	}
}

func main() {
	// gRPC server setup would go here
}
