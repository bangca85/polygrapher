package main

// GORM entity (embedded)
type User struct {
    gorm.Model
    Name string
}

// GORM entity (tags)
type Product struct {
    ID   uint   `gorm:"primaryKey"`
    Code string `gorm:"uniqueIndex"`
}

// Ent entity
type Car struct {
    ent.Schema
    License string
}

// Normal struct
type DTO struct {
    Payload string
}
