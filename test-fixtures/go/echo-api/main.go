package main

import (
	"github.com/labstack/echo/v4"
)

func RegisterUser(c echo.Context) error {
	return c.String(200, "registered")
}

func main() {
	e := echo.New()
	
	// Direct route
	e.GET("/health", func(c echo.Context) error {
		return c.String(200, "OK")
	})

	// Group route
	api := e.Group("/api/v1")
	api.POST("/register", RegisterUser)
}
