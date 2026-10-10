package main

import (
	"context"
	"log"

	"a/backend/service"
)

type App struct {
	ctx     context.Context
	backend *service.Application
}

func NewApp() *App {
	return &App{backend: service.NewApplication()}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if err := a.backend.OpenDefault(); err != nil {
		log.Printf("initialize backend: %v", err)
		return
	}
	a.backend.Startup()
}

func (a *App) shutdown(context.Context) {
	if err := a.backend.Shutdown(); err != nil {
		log.Printf("shutdown backend: %v", err)
	}
}
