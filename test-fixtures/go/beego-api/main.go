package main

import (
	"github.com/beego/beego/v2/server/web"
)

type MainController struct {
	web.Controller
}

func (c *MainController) Get() {
	c.Ctx.WriteString("hello world")
}

func main() {
	web.Router("/api/home", &MainController{})
	web.Run()
}
