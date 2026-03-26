package main

import (
	"fmt"
	"net/http"
)

func main() {
	http.HandleFunc("/health", HandleHealth)
	http.HandleFunc("/api/booking", HandleBooking)
	fmt.Println("Server starting on :8080")
	http.ListenAndServe(":8080", nil)
}

func HandleHealth(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("ok"))
}

func HandleBooking(w http.ResponseWriter, r *http.Request) {
	bookings := GetBookings()
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, "Found %d bookings", len(bookings))
}

func GetBookings() []string {
	return []string{"booking-1", "booking-2"}
}
