package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/fly-on-the-wall/server/internal/api"
	"github.com/fly-on-the-wall/server/internal/auth"
	"github.com/fly-on-the-wall/server/internal/billing"
	"github.com/fly-on-the-wall/server/internal/database"
	"github.com/fly-on-the-wall/server/internal/jobs"
	"github.com/fly-on-the-wall/server/internal/middleware"
	"github.com/fly-on-the-wall/server/internal/store"
	"github.com/fly-on-the-wall/server/internal/sync"
	"github.com/fly-on-the-wall/server/internal/web"
)

func main() {
	loadDotEnv(".env")

	cfg := LoadConfig()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: cfg.LogLevel,
	}))
	slog.SetDefault(logger)

	db, err := database.Connect(cfg.DatabaseDriver, cfg.DatabaseURL)
	if err != nil {
		slog.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	if err := database.Migrate(db, cfg.DatabaseDriver, "migrations"); err != nil {
		slog.Error("failed to run migrations", "error", err)
		os.Exit(1)
	}

	var objectStore store.ObjectStore
	if cfg.S3Enabled {
		objectStore, err = store.NewS3Store(store.S3Config{
			Endpoint:        cfg.S3Endpoint,
			Region:          cfg.S3Region,
			Bucket:          cfg.S3Bucket,
			AccessKeyID:     cfg.S3AccessKeyID,
			SecretAccessKey: cfg.S3SecretAccessKey,
			ForcePathStyle:  cfg.S3ForcePathStyle,
		})
		if err != nil {
			slog.Error("failed to initialize object store", "error", err)
			os.Exit(1)
		}
	} else {
		slog.Warn("object storage is disabled; recording upload/download endpoints will be unavailable")
		objectStore = store.NewDisabledStore()
	}

	authService := auth.NewService(db, auth.ServiceConfig{
		SessionTTL:   cfg.SessionTTL,
		BcryptCost:   cfg.BcryptCost,
		CSRFSecret:   []byte(cfg.CSRFSecret),
		CookieSecure: cfg.CookieSecure,
		CookieDomain: cfg.CookieDomain,
	}, cfg.DatabaseDriver)

	if cfg.AdminUsername != "" && cfg.AdminPassword != "" {
		count, err := authService.CountAdmins(context.Background())
		if err != nil {
			slog.Error("failed to count admins", "error", err)
			os.Exit(1)
		}
		if count == 0 {
			if _, err := authService.RegisterAdmin(context.Background(), cfg.AdminUsername, cfg.AdminPassword); err != nil {
				slog.Error("failed to bootstrap admin user", "error", err)
				os.Exit(1)
			}
			slog.Info("bootstrapped admin user", "username", cfg.AdminUsername)
		}
	}

	syncService := sync.NewService(db, objectStore, cfg.DatabaseDriver)

	billingService := billing.NewService(db, billing.Config{
		StripeEnabled:       cfg.StripeEnabled,
		StripeSecretKey:     cfg.StripeSecretKey,
		StripeWebhookSecret: cfg.StripeWebhookSecret,
		StripePriceID:       cfg.StripePriceID,
		PremiumMode:         cfg.PremiumMode,
	}, cfg.DatabaseDriver)

	jobService := jobs.NewService(db, jobs.Config{
		WorkerType: cfg.WorkerType,
	}, cfg.DatabaseDriver)

	stack := middleware.Chain(
		middleware.RequestID,
		middleware.Logger(logger),
		middleware.Recoverer,
		middleware.CORS(cfg.AllowedOrigins),
	)

	mux := http.NewServeMux()

	mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServer(http.Dir("static"))))

	webHandler := web.NewHandler(authService, billingService)
	webHandler.Register(mux)

	apiHandler := api.NewHandler(authService, syncService, billingService, jobService)
	apiHandler.Register(mux)

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      stack(mux),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("server starting", "port", cfg.Port, "premium_mode", cfg.PremiumMode)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down server")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("server shutdown error", "error", err)
	}

	slog.Info("server stopped")
}
