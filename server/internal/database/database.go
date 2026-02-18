package database

import (
	"database/sql"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	_ "github.com/lib/pq"
	_ "modernc.org/sqlite"
)

// Connect establishes a database connection using the specified driver and URL.
func Connect(driver, databaseURL string) (*sql.DB, error) {
	driver = strings.ToLower(strings.TrimSpace(driver))
	if driver == "" {
		driver = "sqlite"
	}

	goSQLDriver := "sqlite"
	if driver == "postgres" || driver == "postgresql" {
		goSQLDriver = "postgres"
	}

	if goSQLDriver == "sqlite" {
		if err := os.MkdirAll("data", 0o755); err != nil {
			return nil, fmt.Errorf("create sqlite data dir: %w", err)
		}
	}

	db, err := sql.Open(goSQLDriver, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping database: %w", err)
	}

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)

	return db, nil
}

// Migrate runs all .sql files in the migrations directory in order.
// It uses a simple migrations table to track applied migrations.
func Migrate(db *sql.DB, driver, migrationsRoot string) error {
	driver = strings.ToLower(strings.TrimSpace(driver))
	if driver == "" {
		driver = "sqlite"
	}

	migrationsDir := filepath.Join(migrationsRoot, driver)

	migrationsTableDDL := `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`
	if driver == "postgres" || driver == "postgresql" {
		migrationsTableDDL = `
			CREATE TABLE IF NOT EXISTS schema_migrations (
				version TEXT PRIMARY KEY,
				applied_at TIMESTAMPTZ DEFAULT NOW()
			)
		`
	}

	_, err := db.Exec(migrationsTableDDL)
	if err != nil {
		return fmt.Errorf("create migrations table: %w", err)
	}

	entries, err := os.ReadDir(migrationsDir)
	if err != nil {
		// skip gracefully if so
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read migrations dir: %w", err)
	}

	var files []fs.DirEntry
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".up.sql") {
			files = append(files, e)
		}
	}
	sort.Slice(files, func(i, j int) bool {
		return files[i].Name() < files[j].Name()
	})

	for _, f := range files {
		version := f.Name()

		var exists bool
		checkQuery := "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = ?)"
		insertQuery := "INSERT INTO schema_migrations (version) VALUES (?)"
		if driver == "postgres" || driver == "postgresql" {
			checkQuery = "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)"
			insertQuery = "INSERT INTO schema_migrations (version) VALUES ($1)"
		}

		err := db.QueryRow(checkQuery, version).Scan(&exists)
		if err != nil {
			return fmt.Errorf("check migration %s: %w", version, err)
		}
		if exists {
			continue
		}

		if shouldSkipMigration(db, driver, version) {
			if _, err := db.Exec(insertQuery, version); err != nil {
				return fmt.Errorf("record skipped migration %s: %w", version, err)
			}
			continue
		}

		content, err := os.ReadFile(filepath.Join(migrationsDir, version))
		if err != nil {
			return fmt.Errorf("read migration %s: %w", version, err)
		}

		tx, err := db.Begin()
		if err != nil {
			return fmt.Errorf("begin tx for %s: %w", version, err)
		}

		if _, err := tx.Exec(string(content)); err != nil {
			tx.Rollback()
			return fmt.Errorf("execute migration %s: %w", version, err)
		}

		if _, err := tx.Exec(insertQuery, version); err != nil {
			tx.Rollback()
			return fmt.Errorf("record migration %s: %w", version, err)
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %s: %w", version, err)
		}
	}

	return nil
}

func shouldSkipMigration(db *sql.DB, driver, version string) bool {
	if !(driver == "sqlite" && version == "002_users_email_to_username.up.sql") {
		return false
	}

	rows, err := db.Query("PRAGMA table_info(users)")
	if err != nil {
		return false
	}
	defer rows.Close()

	var (
		hasEmail    bool
		hasUsername bool
	)
	for rows.Next() {
		var (
			cid        int
			name       string
			colType    string
			notNull    int
			defaultVal sql.NullString
			pk         int
		)
		if err := rows.Scan(&cid, &name, &colType, &notNull, &defaultVal, &pk); err != nil {
			return false
		}
		if name == "email" {
			hasEmail = true
		}
		if name == "username" {
			hasUsername = true
		}
	}

	return hasUsername && !hasEmail
}
