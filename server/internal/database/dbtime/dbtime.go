package dbtime

import (
	"database/sql"
	"fmt"
	"time"
)

var timeFormat = "2006-01-02 15:04:05"

// NullableTimeFromPG converts a sql.NullTime from PostgreSQL to a *time.Time.
func NullableTimeFromPG(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	t := value.Time
	return &t
}

// NullableTimeFromSQLite converts a sql.NullString from SQLite to a *time.Time.
func NullableTimeFromSQLite(value sql.NullString) (*time.Time, error) {
	if !value.Valid || value.String == "" {
		return nil, nil
	}
	t, err := ParseSQLiteTime(value.String)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// ParseSQLiteTime attempts to parse a time string from SQLite using multiple layouts.
func ParseSQLiteTime(value string) (time.Time, error) {
	if value == "" {
		return time.Time{}, nil
	}
	layouts := []string{time.RFC3339Nano, time.RFC3339, timeFormat}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, value); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("parse sqlite time: %q", value)
}

// FormatSQLiteTime formats a time.Time for storage in SQLite.
func FormatSQLiteTime(value time.Time) string {
	return value.UTC().Format(timeFormat)
}
