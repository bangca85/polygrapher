package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func main() {
	r := gin.Default()

	api := r.Group("/api/v1")
	{
		api.GET("/users", GetUsers)
		api.POST("/users", CreateUser)
		api.GET("/bookings", GetBookings)
	}

	r.Run(":8080")
}

func GetUsers(c *gin.Context) {
	users := FetchAllUsers()
	c.JSON(http.StatusOK, users)
}

func CreateUser(c *gin.Context) {
	c.JSON(http.StatusCreated, gin.H{"status": "created"})
}

func GetBookings(c *gin.Context) {
	bookings := FetchBookings()
	c.JSON(http.StatusOK, bookings)
}

func FetchAllUsers() []string {
	return []string{"alice", "bob"}
}

func FetchBookings() []string {
	return []string{"booking-1", "booking-2"}
}
