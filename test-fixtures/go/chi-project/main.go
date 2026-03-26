package main

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

func main() {
	r := chi.NewRouter()

	r.Get("/health", HealthCheck)
	r.Post("/api/orders", CreateOrder)

	http.ListenAndServe(":3000", r)
}

func HealthCheck(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("ok"))
}

func CreateOrder(w http.ResponseWriter, r *http.Request) {
	order := ProcessOrder()
	w.Write([]byte(order))
}

func ProcessOrder() string {
	return "order-123"
}
