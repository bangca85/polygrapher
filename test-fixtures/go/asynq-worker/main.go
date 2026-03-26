package main

import (
	"context"
	"log"

	"github.com/hibiken/asynq"
)

func HandleEmailSignup(ctx context.Context, t *asynq.Task) error {
	log.Printf("Sending email to %s", string(t.Payload()))
	return nil
}

func main() {
	srv := asynq.NewServer(
		asynq.RedisClientOpt{Addr: "localhost:6379"},
		asynq.Config{Concurrency: 10},
	)

	mux := asynq.NewServeMux()
	mux.HandleFunc("email:signup", HandleEmailSignup)

	if err := srv.Run(mux); err != nil {
		log.Fatal(err)
	}
}
