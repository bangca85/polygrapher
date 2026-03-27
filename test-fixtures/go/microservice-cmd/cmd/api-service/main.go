package main

import (
	"fmt"
	"net/http"
)

func main() {
	fmt.Println("Starting api-service")
	http.HandleFunc("/health", handleHealth)
	http.ListenAndServe(":8080", nil)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("ok"))
}
