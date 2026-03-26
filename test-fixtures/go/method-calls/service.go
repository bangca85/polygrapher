package main

type Cache struct{}

func (c *Cache) Process() string {
	return "cached"
}

func UseCache() {
	c := &Cache{}
	c.Process()
}
