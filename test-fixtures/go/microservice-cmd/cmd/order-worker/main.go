package main

import (
	"fmt"
	"github.com/example/microservice-cmd/internal/handler"
)

func main() {
	fmt.Println("Starting order-worker")
	handler.ProcessOrders()
	runConsumer()
}

func runConsumer() {
	fmt.Println("consumer running")
}
