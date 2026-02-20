package auth

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/fly-on-the-wall/server/internal/database"
	"github.com/fly-on-the-wall/server/internal/database/dbtime"
	"github.com/fly-on-the-wall/server/internal/database/sqlc/pgsqlc"
	"github.com/fly-on-the-wall/server/internal/database/sqlc/sqliteqlc"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrInvalidCredentials = errors.New("invalid username or password")
	ErrUsernameTaken      = errors.New("username already registered")
	ErrSessionExpired     = errors.New("session expired")
	ErrSessionNotFound    = errors.New("session not found")
)

type ServiceConfig struct {
	SessionTTL   time.Duration
	BcryptCost   int
	CSRFSecret   []byte
	CookieSecure bool
	CookieDomain string
}

type Service struct {
	db            *sql.DB
	cfg           ServiceConfig
	driver        string
	pgQueries     *pgsqlc.Queries
	sqliteQueries *sqliteqlc.Queries
}

// NewService creates a new authentication service with a database connection and configuration.
func NewService(db *sql.DB, cfg ServiceConfig, driver string) *Service {
	driver = strings.ToLower(strings.TrimSpace(driver))
	s := &Service{db: db, cfg: cfg, driver: driver}
	if driver == "postgres" || driver == "postgresql" {
		s.pgQueries = pgsqlc.New(db)
		return s
	}
	s.sqliteQueries = sqliteqlc.New(db)
	return s
}

// Register creates a new user with the given username and password.
func (s *Service) Register(ctx context.Context, username, password string) (*database.User, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), s.cfg.BcryptCost)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	user := &database.User{}
	if s.pgQueries != nil {
		row, qErr := s.pgQueries.CreateUser(ctx, pgsqlc.CreateUserParams{
			Username:     username,
			PasswordHash: string(hash),
		})
		err = qErr
		if err == nil {
			user = &database.User{
				ID:           row.ID,
				Username:     row.Username,
				PasswordHash: row.PasswordHash,
				IsPremium:    row.IsPremium,
				IsAdmin:      row.IsAdmin,
				CreatedAt:    row.CreatedAt,
				UpdatedAt:    row.UpdatedAt,
			}
		}
	} else {
		row, qErr := s.sqliteQueries.CreateUser(ctx, sqliteqlc.CreateUserParams{
			Username:     username,
			PasswordHash: string(hash),
		})
		err = qErr
		if err == nil {
			createdAt, parseErr := dbtime.ParseSQLiteTime(row.CreatedAt)
			if parseErr != nil {
				return nil, parseErr
			}
			updatedAt, parseErr := dbtime.ParseSQLiteTime(row.UpdatedAt)
			if parseErr != nil {
				return nil, parseErr
			}
			user = &database.User{
				ID:           row.ID,
				Username:     row.Username,
				PasswordHash: row.PasswordHash,
				IsPremium:    row.IsPremium != 0,
				IsAdmin:      row.IsAdmin != 0,
				CreatedAt:    createdAt,
				UpdatedAt:    updatedAt,
			}
		}
	}

	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrUsernameTaken
		}
		return nil, fmt.Errorf("insert user: %w", err)
	}

	return user, nil
}

// Login validates credentials and creates a session.
func (s *Service) Login(ctx context.Context, username, password, deviceID string) (*database.User, *database.Session, error) {
	user, err := s.getUserByUsername(ctx, username)

	if err != nil {
		if errors.Is(err, sql.ErrNoRows) || errors.Is(err, ErrSessionNotFound) {
			return nil, nil, ErrInvalidCredentials
		}
		return nil, nil, err
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, nil, ErrInvalidCredentials
	}

	session, err := s.CreateSession(ctx, user.ID, deviceID)
	if err != nil {
		return nil, nil, err
	}

	return user, session, nil
}

// CreateSession creates a new session for the given user.
func (s *Service) CreateSession(ctx context.Context, userID string, deviceID string) (*database.Session, error) {
	token, err := generateToken(32)
	if err != nil {
		return nil, fmt.Errorf("generate token: %w", err)
	}

	session := &database.Session{}
	expiresAt := time.Now().Add(s.cfg.SessionTTL)
	if s.pgQueries != nil {
		uid, parseErr := uuid.Parse(userID)
		if parseErr != nil {
			return nil, fmt.Errorf("parse user id: %w", parseErr)
		}
		var devID uuid.UUID
		if deviceID != "" {
			devID, _ = uuid.Parse(deviceID)
		}
		row, qErr := s.pgQueries.CreateSession(ctx, pgsqlc.CreateSessionParams{
			Column1:   uid,
			Token:     token,
			Column3:   devID,
			ExpiresAt: expiresAt,
		})
		err = qErr
		if err == nil {
			session = &database.Session{ID: row.ID, UserID: row.UserID, Token: row.Token, DeviceID: row.DeviceID, ExpiresAt: row.ExpiresAt, CreatedAt: row.CreatedAt}
		}
	} else {
		dev := ""
		if deviceID != "" {
			dev = deviceID
		}
		row, qErr := s.sqliteQueries.CreateSession(ctx, sqliteqlc.CreateSessionParams{
			UserID:    userID,
			Token:     token,
			DeviceID:  dev,
			ExpiresAt: expiresAt.UTC().Format("2006-01-02 15:04:05"),
		})
		err = qErr
		if err == nil {
			rowExpiresAt, parseErr := dbtime.ParseSQLiteTime(row.ExpiresAt)
			if parseErr != nil {
				return nil, parseErr
			}
			rowCreatedAt, parseErr := dbtime.ParseSQLiteTime(row.CreatedAt)
			if parseErr != nil {
				return nil, parseErr
			}
			d := ""
			if dev, ok := row.DeviceID.(string); ok {
				d = dev
			}
			session = &database.Session{ID: row.ID, UserID: row.UserID, Token: row.Token, DeviceID: d, ExpiresAt: rowExpiresAt, CreatedAt: rowCreatedAt}
		}
	}

	if err != nil {
		return nil, fmt.Errorf("insert session: %w", err)
	}

	return session, nil
}

// ValidateSession validates a session token and returns the associated user.
func (s *Service) ValidateSession(ctx context.Context, token string) (*database.User, *database.Session, error) {
	session, err := s.getSessionByToken(ctx, token)

	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil, ErrSessionNotFound
		}
		return nil, nil, fmt.Errorf("query session: %w", err)
	}

	if time.Now().After(session.ExpiresAt) {
		// Clean up expired session
		s.db.ExecContext(ctx, "DELETE FROM sessions WHERE id = $1", session.ID)
		return nil, nil, ErrSessionExpired
	}

	user, err := s.GetUser(ctx, session.UserID)
	if err != nil {
		return nil, nil, err
	}

	return user, session, nil
}

// Logout deletes a session.
func (s *Service) Logout(ctx context.Context, token string) error {
	if s.pgQueries != nil {
		return s.pgQueries.DeleteSessionByToken(ctx, token)
	}
	return s.sqliteQueries.DeleteSessionByToken(ctx, token)
}

// RevokeSessionsByDevice deletes all sessions associated with a device ID.
func (s *Service) RevokeSessionsByDevice(ctx context.Context, deviceID string) error {
	if deviceID == "" {
		return nil
	}
	if s.pgQueries != nil {
		uid, err := uuid.Parse(deviceID)
		if err != nil {
			return fmt.Errorf("parse device id: %w", err)
		}
		return s.pgQueries.DeleteSessionsByDeviceID(ctx, uid)
	}
	return s.sqliteQueries.DeleteSessionsByDeviceID(ctx, deviceID)
}

// GetUser retrieves a user by ID.
func (s *Service) GetUser(ctx context.Context, userID string) (*database.User, error) {
	if s.pgQueries != nil {
		uid, err := uuid.Parse(userID)
		if err != nil {
			return nil, fmt.Errorf("parse user id: %w", err)
		}
		row, err := s.pgQueries.GetUserByID(ctx, uid)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, ErrSessionNotFound
			}
			return nil, fmt.Errorf("query user: %w", err)
		}
		return &database.User{
			ID:           row.ID,
			Username:     row.Username,
			PasswordHash: row.PasswordHash,
			IsPremium:    row.IsPremium,
			IsAdmin:      row.IsAdmin,
			CreatedAt:    row.CreatedAt,
			UpdatedAt:    row.UpdatedAt,
		}, nil
	}

	row, err := s.sqliteQueries.GetUserByID(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrSessionNotFound
		}
		return nil, fmt.Errorf("query user: %w", err)
	}
	createdAt, err := dbtime.ParseSQLiteTime(row.CreatedAt)
	if err != nil {
		return nil, err
	}
	updatedAt, err := dbtime.ParseSQLiteTime(row.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &database.User{
		ID:           row.ID,
		Username:     row.Username,
		PasswordHash: row.PasswordHash,
		IsPremium:    row.IsPremium != 0,
		IsAdmin:      row.IsAdmin != 0,
		CreatedAt:    createdAt,
		UpdatedAt:    updatedAt,
	}, nil
}

// SetPremium sets the premium status for a user.
func (s *Service) SetPremium(ctx context.Context, userID string, premium bool) error {
	if s.pgQueries != nil {
		uid, err := uuid.Parse(userID)
		if err != nil {
			return fmt.Errorf("parse user id: %w", err)
		}
		return s.pgQueries.SetUserPremium(ctx, pgsqlc.SetUserPremiumParams{IsPremium: premium, Column2: uid})
	}
	value := int64(0)
	if premium {
		value = 1
	}
	return s.sqliteQueries.SetUserPremium(ctx, sqliteqlc.SetUserPremiumParams{IsPremium: value, ID: userID})
}

// CleanupExpiredSessions removes all expired sessions.
func (s *Service) CleanupExpiredSessions(ctx context.Context) (int64, error) {
	if s.pgQueries != nil {
		return s.pgQueries.DeleteExpiredSessions(ctx)
	}
	return s.sqliteQueries.DeleteExpiredSessions(ctx)
}

// Config returns the service configuration (for middleware use).
func (s *Service) Config() ServiceConfig {
	return s.cfg
}

func generateToken(bytes int) (string, error) {
	b := make([]byte, bytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func isUniqueViolation(err error) bool {
	return err != nil && (contains(err.Error(), "unique") || contains(err.Error(), "duplicate"))
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchString(s, substr)
}

func searchString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

func (s *Service) getSessionByToken(ctx context.Context, token string) (*database.Session, error) {
	if s.pgQueries != nil {
		row, err := s.pgQueries.GetSessionByToken(ctx, token)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, ErrSessionNotFound
			}
			return nil, fmt.Errorf("query session: %w", err)
		}
		return &database.Session{ID: row.ID, UserID: row.UserID, Token: row.Token, DeviceID: row.DeviceID, ExpiresAt: row.ExpiresAt, CreatedAt: row.CreatedAt}, nil
	}

	row, err := s.sqliteQueries.GetSessionByToken(ctx, token)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrSessionNotFound
		}
		return nil, fmt.Errorf("query session: %w", err)
	}
	expiresAt, err := dbtime.ParseSQLiteTime(row.ExpiresAt)
	if err != nil {
		return nil, err
	}
	createdAt, err := dbtime.ParseSQLiteTime(row.CreatedAt)
	if err != nil {
		return nil, err
	}
	dev := ""
	if d, ok := row.DeviceID.(string); ok {
		dev = d
	}
	return &database.Session{ID: row.ID, UserID: row.UserID, Token: row.Token, DeviceID: dev, ExpiresAt: expiresAt, CreatedAt: createdAt}, nil
}

func (s *Service) getUserByUsername(ctx context.Context, username string) (*database.User, error) {
	if s.pgQueries != nil {
		row, err := s.pgQueries.GetUserByUsername(ctx, username)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, ErrSessionNotFound
			}
			return nil, fmt.Errorf("query user by username: %w", err)
		}
		return &database.User{
			ID:           row.ID,
			Username:     row.Username,
			PasswordHash: row.PasswordHash,
			IsPremium:    row.IsPremium,
			IsAdmin:      row.IsAdmin,
			CreatedAt:    row.CreatedAt,
			UpdatedAt:    row.UpdatedAt,
		}, nil
	}

	row, err := s.sqliteQueries.GetUserByUsername(ctx, username)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrSessionNotFound
		}
		return nil, fmt.Errorf("query user by username: %w", err)
	}
	createdAt, err := dbtime.ParseSQLiteTime(row.CreatedAt)
	if err != nil {
		return nil, err
	}
	updatedAt, err := dbtime.ParseSQLiteTime(row.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &database.User{
		ID:           row.ID,
		Username:     row.Username,
		PasswordHash: row.PasswordHash,
		IsPremium:    row.IsPremium != 0,
		IsAdmin:      row.IsAdmin != 0,
		CreatedAt:    createdAt,
		UpdatedAt:    updatedAt,
	}, nil
}

// Register creates a new admin user with the given username and password.
func (s *Service) RegisterAdmin(ctx context.Context, username, password string) (*database.User, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), s.cfg.BcryptCost)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	user := &database.User{}
	if s.pgQueries != nil {
		row, qErr := s.pgQueries.CreateUserAdmin(ctx, pgsqlc.CreateUserAdminParams{
			Username:     username,
			PasswordHash: string(hash),
		})
		err = qErr
		if err == nil {
			user = &database.User{
				ID:           row.ID,
				Username:     row.Username,
				PasswordHash: row.PasswordHash,
				IsPremium:    row.IsPremium,
				IsAdmin:      row.IsAdmin,
				CreatedAt:    row.CreatedAt,
				UpdatedAt:    row.UpdatedAt,
			}
		}
	} else {
		row, qErr := s.sqliteQueries.CreateUserAdmin(ctx, sqliteqlc.CreateUserAdminParams{
			Username:     username,
			PasswordHash: string(hash),
		})
		err = qErr
		if err == nil {
			createdAt, parseErr := dbtime.ParseSQLiteTime(row.CreatedAt)
			if parseErr != nil {
				return nil, parseErr
			}
			updatedAt, parseErr := dbtime.ParseSQLiteTime(row.UpdatedAt)
			if parseErr != nil {
				return nil, parseErr
			}
			user = &database.User{
				ID:           row.ID,
				Username:     row.Username,
				PasswordHash: row.PasswordHash,
				IsPremium:    row.IsPremium != 0,
				IsAdmin:      row.IsAdmin != 0,
				CreatedAt:    createdAt,
				UpdatedAt:    updatedAt,
			}
		}
	}

	if err != nil {
		return nil, fmt.Errorf("create admin user: %w", err)
	}
	return user, nil
}

// CountAdmins returns the number of admin users in the system.
func (s *Service) CountAdmins(ctx context.Context) (int64, error) {
	if s.pgQueries != nil {
		return s.pgQueries.CountAdmins(ctx)
	}
	return s.sqliteQueries.CountAdmins(ctx)
}

// ListUserSessions returns all active sessions for a user.
func (s *Service) ListUserSessions(ctx context.Context, userID string) ([]database.Session, error) {
	if s.pgQueries != nil {
		uid, err := uuid.Parse(userID)
		if err != nil {
			return nil, fmt.Errorf("parse user id: %w", err)
		}
		rows, err := s.pgQueries.ListSessionsByUser(ctx, uid)
		if err != nil {
			return nil, fmt.Errorf("list sessions: %w", err)
		}
		sessions := make([]database.Session, 0, len(rows))
		for _, row := range rows {
			sessions = append(sessions, database.Session{
				ID:        row.ID,
				UserID:    row.UserID,
				Token:     row.Token,
				DeviceID:  row.DeviceID,
				ExpiresAt: row.ExpiresAt,
				CreatedAt: row.CreatedAt,
			})
		}
		return sessions, nil
	}

	rows, err := s.sqliteQueries.ListSessionsByUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	sessions := make([]database.Session, 0, len(rows))
	for _, row := range rows {
		expiresAt, err := dbtime.ParseSQLiteTime(row.ExpiresAt)
		if err != nil {
			return nil, err
		}
		createdAt, err := dbtime.ParseSQLiteTime(row.CreatedAt)
		if err != nil {
			return nil, err
		}
		d := ""
		if dev, ok := row.DeviceID.(string); ok {
			d = dev
		}
		sessions = append(sessions, database.Session{
			ID:        row.ID,
			UserID:    row.UserID,
			Token:     row.Token,
			DeviceID:  d,
			ExpiresAt: expiresAt,
			CreatedAt: createdAt,
		})
	}
	return sessions, nil
}

// RevokeSession revokes a specific session for a user.
func (s *Service) RevokeSession(ctx context.Context, sessionID, userID string) error {
	if s.pgQueries != nil {
		sid, err := uuid.Parse(sessionID)
		if err != nil {
			return fmt.Errorf("parse session id: %w", err)
		}
		uid, err := uuid.Parse(userID)
		if err != nil {
			return fmt.Errorf("parse user id: %w", err)
		}
		return s.pgQueries.DeleteSessionByID(ctx, pgsqlc.DeleteSessionByIDParams{Column1: sid, Column2: uid})
	}
	err := s.sqliteQueries.DeleteSessionByID(ctx, sqliteqlc.DeleteSessionByIDParams{ID: sessionID, UserID: userID})
	return err
}
