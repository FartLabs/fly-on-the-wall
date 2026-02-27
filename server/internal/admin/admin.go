package admin

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/fly-on-the-wall/server/internal/database/sqlc/pgsqlc"
	"github.com/fly-on-the-wall/server/internal/database/sqlc/sqliteqlc"
	"github.com/google/uuid"
)

type Service struct {
	db            *sql.DB
	driver        string
	pgQueries     *pgsqlc.Queries
	sqliteQueries *sqliteqlc.Queries
}

func NewService(db *sql.DB, driver string) *Service {
	driver = strings.ToLower(strings.TrimSpace(driver))
	s := &Service{db: db, driver: driver}
	if driver == "postgres" || driver == "postgresql" {
		s.pgQueries = pgsqlc.New(db)
		return s
	}
	s.sqliteQueries = sqliteqlc.New(db)
	return s
}

type UserListItem struct {
	ID        string
	Username  string
	IsPremium bool
	IsAdmin   bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

type UserListResult struct {
	Users      []UserListItem
	TotalCount int
	Page       int
	PageSize   int
	TotalPages int
}

func (s *Service) GetUsers(ctx context.Context, page, pageSize int) (*UserListResult, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}

	offset := (page - 1) * pageSize

	var totalCount int
	var users []UserListItem

	if s.pgQueries != nil {
		count, err := s.pgQueries.CountUsers(ctx)
		if err != nil {
			return nil, fmt.Errorf("count users: %w", err)
		}
		totalCount = int(count)

		rows, err := s.pgQueries.ListUsers(ctx, pgsqlc.ListUsersParams{
			Limit:  int32(pageSize),
			Offset: int32(offset),
		})
		if err != nil {
			return nil, fmt.Errorf("list users: %w", err)
		}

		users = make([]UserListItem, len(rows))
		for i, r := range rows {
			users[i] = UserListItem{
				ID:        r.ID,
				Username:  r.Username,
				IsPremium: r.IsPremium,
				IsAdmin:   r.IsAdmin,
				CreatedAt: r.CreatedAt,
				UpdatedAt: r.UpdatedAt,
			}
		}
	} else {
		count, err := s.sqliteQueries.CountUsers(ctx)
		if err != nil {
			return nil, fmt.Errorf("count users: %w", err)
		}
		totalCount = int(count)

		rows, err := s.sqliteQueries.ListUsers(ctx, sqliteqlc.ListUsersParams{
			Limit:  int64(pageSize),
			Offset: int64(offset),
		})
		if err != nil {
			return nil, fmt.Errorf("list users: %w", err)
		}

		users = make([]UserListItem, len(rows))
		for i, r := range rows {
			users[i] = UserListItem{
				ID:        r.ID,
				Username:  r.Username,
				IsPremium: r.IsPremium != 0,
				IsAdmin:   r.IsAdmin != 0,
				CreatedAt: parseSQLiteTime(r.CreatedAt),
				UpdatedAt: parseSQLiteTime(r.UpdatedAt),
			}
		}
	}

	totalPages := (totalCount + pageSize - 1) / pageSize

	return &UserListResult{
		Users:      users,
		TotalCount: totalCount,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}, nil
}

func parseSQLiteTime(s string) time.Time {
	t, err := time.Parse("2006-01-02 15:04:05", s)
	if err != nil {
		return time.Time{}
	}
	return t
}

func (s *Service) SetUserPremium(ctx context.Context, userID string, isPremium bool) error {
	if s.pgQueries != nil {
		uid, err := uuid.Parse(userID)
		if err != nil {
			return fmt.Errorf("parse user id: %w", err)
		}
		return s.pgQueries.UpdateUserPremium(ctx, pgsqlc.UpdateUserPremiumParams{
			IsPremium: isPremium,
			Column2:   uid,
		})
	}
	premiumVal := int64(0)
	if isPremium {
		premiumVal = 1
	}
	return s.sqliteQueries.UpdateUserPremium(ctx, sqliteqlc.UpdateUserPremiumParams{
		IsPremium: premiumVal,
		ID:        userID,
	})
}

func (s *Service) SetUserAdmin(ctx context.Context, userID string, isAdmin bool) error {
	if s.pgQueries != nil {
		uid, err := uuid.Parse(userID)
		if err != nil {
			return fmt.Errorf("parse user id: %w", err)
		}
		return s.pgQueries.UpdateUserAdmin(ctx, pgsqlc.UpdateUserAdminParams{
			IsAdmin: isAdmin,
			Column2: uid,
		})
	}
	adminVal := int64(0)
	if isAdmin {
		adminVal = 1
	}
	return s.sqliteQueries.UpdateUserAdmin(ctx, sqliteqlc.UpdateUserAdminParams{
		IsAdmin: adminVal,
		ID:      userID,
	})
}
