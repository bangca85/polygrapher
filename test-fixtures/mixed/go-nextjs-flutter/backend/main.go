package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func HandleBooking(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func HandleUsers(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"users": []string{}})
}

func main() {
	r := gin.Default()
	r.GET("/api/booking", HandleBooking)
	r.POST("/api/users", HandleUsers)
	r.Run()
}
