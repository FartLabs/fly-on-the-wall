package main

import (
	"bufio"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds all server configuration, populated from environment variables
// with sensible defaults for self-hosted deployments.
type Config struct {
	Port           int
	LogLevel       slog.Level
	AllowedOrigins []string
	BaseURL        string

	DatabaseDriver string
	DatabaseURL    string

	// Sessions & Auth
	SessionTTL   time.Duration
	BcryptCost   int
	CSRFSecret   string
	CookieSecure bool
	CookieDomain string

	// S3-compatible object storage
	S3Enabled         bool
	S3Endpoint        string
	S3Region          string
	S3Bucket          string
	S3AccessKeyID     string
	S3SecretAccessKey string
	S3ForcePathStyle  bool

	// Stripe
	StripeEnabled       bool
	StripeSecretKey     string
	StripeWebhookSecret string
	StripePriceID       string

	// Premium mode: "stripe", "admin_override", "all_premium"
	PremiumMode string

	// Worker type: "local", "remote"
	WorkerType string

	// Admin bootstrap (optional, used to seed first admin on startup)
	AdminUsername string
	AdminPassword string
}

func LoadConfig() *Config {
	return &Config{
		Port:           envInt("PORT", 8080),
		LogLevel:       envLogLevel("LOG_LEVEL", slog.LevelInfo),
		AllowedOrigins: envSlice("ALLOWED_ORIGINS", []string{"*"}),
		BaseURL:        envStr("BASE_URL", "http://localhost:8080"),

		DatabaseDriver: envStr("DATABASE_DRIVER", "sqlite"),
		DatabaseURL:    envStr("DATABASE_URL", "file:./data/dev.db"),

		SessionTTL:   envDuration("SESSION_TTL", 30*24*time.Hour),
		BcryptCost:   envInt("BCRYPT_COST", 12),
		CSRFSecret:   envStr("CSRF_SECRET", "change-me-in-production-32chars!"),
		CookieSecure: envBool("COOKIE_SECURE", false),
		CookieDomain: envStr("COOKIE_DOMAIN", ""),

		S3Enabled:         envBool("S3_ENABLED", true),
		S3Endpoint:        envStr("S3_ENDPOINT", "http://localhost:9000"),
		S3Region:          envStr("S3_REGION", "us-east-1"),
		S3Bucket:          envStr("S3_BUCKET", "flyonthewall"),
		S3AccessKeyID:     envStr("S3_ACCESS_KEY_ID", "minioadmin"),
		S3SecretAccessKey: envStr("S3_SECRET_ACCESS_KEY", "minioadmin"),
		S3ForcePathStyle:  envBool("S3_FORCE_PATH_STYLE", true),

		StripeEnabled:       envBool("STRIPE_ENABLED", false),
		StripeSecretKey:     envStr("STRIPE_SECRET_KEY", ""),
		StripeWebhookSecret: envStr("STRIPE_WEBHOOK_SECRET", ""),
		StripePriceID:       envStr("STRIPE_PRICE_ID", ""),

		PremiumMode: envStr("PREMIUM_MODE", "all_premium"),
		WorkerType:  envStr("WORKER_TYPE", "local"),

		AdminUsername: envStr("ADMIN_USERNAME", ""),
		AdminPassword: envStr("ADMIN_PASSWORD", ""),
	}
}

func envStr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return fallback
}

func envDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}

func envSlice(key string, fallback []string) []string {
	if v := os.Getenv(key); v != "" {
		return strings.Split(v, ",")
	}
	return fallback
}

func envLogLevel(key string, fallback slog.Level) slog.Level {
	switch strings.ToLower(envStr(key, "")) {
	case "debug":
		return slog.LevelDebug
	case "info":
		return slog.LevelInfo
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return fallback
	}
}

// loadDotEnv reads a .env file (if present) and sets environment variables that
// are not already defined. This makes local development easier without requiring
// an external dependency.
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		// File not found is fine — .env is optional.
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		// Strip surrounding quotes if present.
		if len(value) >= 2 && ((value[0] == '"' && value[len(value)-1] == '"') || (value[0] == '\'' && value[len(value)-1] == '\'')) {
			value = value[1 : len(value)-1]
		}
		// Only set if not already defined — real env takes precedence.
		if _, exists := os.LookupEnv(key); !exists {
			os.Setenv(key, value)
		}
	}
}
