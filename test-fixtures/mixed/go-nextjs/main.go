package main

import "net/http"

func main() {
	http.HandleFunc("/api/booking", handleBooking)
	http.ListenAndServe(":8080", nil)
}

func handleBooking(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("ok"))
}
