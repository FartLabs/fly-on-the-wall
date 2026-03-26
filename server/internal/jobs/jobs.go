// this will be worked on later in the future post 1.0 release

package jobs

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/fly-on-the-wall/server/internal/database"
	"github.com/fly-on-the-wall/server/internal/database/dbtime"
	"github.com/fly-on-the-wall/server/internal/database/sqlc/pgsqlc"
	"github.com/fly-on-the-wall/server/internal/database/sqlc/sqliteqlc"
	"github.com/google/uuid"
)

var (
	ErrJobNotFound = errors.New("job not found")
	ErrNotPremium  = errors.New("premium subscription required for cloud processing")
)

type Config struct {
	// WorkerType: "local" or "remote"
	WorkerType string
}

// WorkerProvider is the interface for executing transcription/summarization jobs.
// "local" adapter runs jobs in-process; "remote" adapter dispatches to GPU workers.
type WorkerProvider interface {
	Submit(ctx context.Context, job *database.Job) error
	CheckStatus(ctx context.Context, jobID string) (string, error)
}

type Service struct {
	db            *sql.DB
	cfg           Config
	worker        WorkerProvider
	driver        string
	pgQueries     *pgsqlc.Queries
	sqliteQueries *sqliteqlc.Queries
}

func NewService(db *sql.DB, cfg Config, driver string) *Service {
	driver = strings.ToLower(strings.TrimSpace(driver))
	s := &Service{db: db, cfg: cfg, driver: driver}
	if driver == "postgres" || driver == "postgresql" {
		s.pgQueries = pgsqlc.New(db)
	} else {
		s.sqliteQueries = sqliteqlc.New(db)
	}

	switch cfg.WorkerType {
	case "remote":
		s.worker = &RemoteWorker{}
	default:
		s.worker = &LocalWorker{}
	}

	return s
}

func (s *Service) CreateJob(ctx context.Context, userID, jobType, inputRef string) (*database.Job, error) {
	var job *database.Job
	if s.pgQueries != nil {
		uid, err := uuid.Parse(userID)
		if err != nil {
			return nil, fmt.Errorf("parse user id: %w", err)
		}
		row, err := s.pgQueries.CreateJob(ctx, pgsqlc.CreateJobParams{Column1: uid, Type: jobType, InputRef: inputRef})
		if err != nil {
			return nil, fmt.Errorf("create job: %w", err)
		}
		job = &database.Job{
			ID:         row.ID,
			UserID:     row.UserID,
			Type:       row.Type,
			Status:     row.Status,
			InputRef:   row.InputRef,
			OutputRef:  row.OutputRef,
			Error:      row.Error,
			WorkerID:   row.WorkerID,
			CreatedAt:  row.CreatedAt,
			UpdatedAt:  row.UpdatedAt,
			StartedAt:  dbtime.NullableTimeFromPG(row.StartedAt),
			FinishedAt: dbtime.NullableTimeFromPG(row.FinishedAt),
		}
	} else {
		row, err := s.sqliteQueries.CreateJob(ctx, sqliteqlc.CreateJobParams{UserID: userID, Type: jobType, InputRef: inputRef})
		if err != nil {
			return nil, fmt.Errorf("create job: %w", err)
		}
		createdAt, err := dbtime.ParseSQLiteTime(row.CreatedAt)
		if err != nil {
			return nil, err
		}
		updatedAt, err := dbtime.ParseSQLiteTime(row.UpdatedAt)
		if err != nil {
			return nil, err
		}
		startedAt, err := dbtime.NullableTimeFromSQLite(row.StartedAt)
		if err != nil {
			return nil, err
		}
		finishedAt, err := dbtime.NullableTimeFromSQLite(row.FinishedAt)
		if err != nil {
			return nil, err
		}
		job = &database.Job{
			ID:         row.ID,
			UserID:     row.UserID,
			Type:       row.Type,
			Status:     row.Status,
			InputRef:   row.InputRef,
			OutputRef:  row.OutputRef,
			Error:      row.Error,
			WorkerID:   row.WorkerID,
			CreatedAt:  createdAt,
			UpdatedAt:  updatedAt,
			StartedAt:  startedAt,
			FinishedAt: finishedAt,
		}
	}

	go func() {
		if err := s.worker.Submit(context.Background(), job); err != nil {
			s.UpdateJobStatus(context.Background(), job.ID, "failed", "", err.Error())
		}
	}()

	return job, nil
}

// GetJob retrieves a job by ID.
func (s *Service) GetJob(ctx context.Context, jobID, userID string) (*database.Job, error) {
	if s.pgQueries != nil {
		jid, err := uuid.Parse(jobID)
		if err != nil {
			return nil, fmt.Errorf("parse job id: %w", err)
		}
		uid, err := uuid.Parse(userID)
		if err != nil {
			return nil, fmt.Errorf("parse user id: %w", err)
		}
		row, err := s.pgQueries.GetJobByIDForUser(ctx, pgsqlc.GetJobByIDForUserParams{ID: jid, UserID: uid})
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, ErrJobNotFound
			}
			return nil, fmt.Errorf("get job: %w", err)
		}
		return &database.Job{
			ID:         row.ID,
			UserID:     row.UserID,
			Type:       row.Type,
			Status:     row.Status,
			InputRef:   row.InputRef,
			OutputRef:  row.OutputRef,
			Error:      row.Error,
			WorkerID:   row.WorkerID,
			CreatedAt:  row.CreatedAt,
			UpdatedAt:  row.UpdatedAt,
			StartedAt:  dbtime.NullableTimeFromPG(row.StartedAt),
			FinishedAt: dbtime.NullableTimeFromPG(row.FinishedAt),
		}, nil
	}

	row, err := s.sqliteQueries.GetJobByIDForUser(ctx, sqliteqlc.GetJobByIDForUserParams{ID: jobID, UserID: userID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrJobNotFound
		}
		return nil, fmt.Errorf("get job: %w", err)
	}
	createdAt, err := dbtime.ParseSQLiteTime(row.CreatedAt)
	if err != nil {
		return nil, err
	}
	updatedAt, err := dbtime.ParseSQLiteTime(row.UpdatedAt)
	if err != nil {
		return nil, err
	}
	startedAt, err := dbtime.NullableTimeFromSQLite(row.StartedAt)
	if err != nil {
		return nil, err
	}
	finishedAt, err := dbtime.NullableTimeFromSQLite(row.FinishedAt)
	if err != nil {
		return nil, err
	}
	return &database.Job{
		ID:         row.ID,
		UserID:     row.UserID,
		Type:       row.Type,
		Status:     row.Status,
		InputRef:   row.InputRef,
		OutputRef:  row.OutputRef,
		Error:      row.Error,
		WorkerID:   row.WorkerID,
		CreatedAt:  createdAt,
		UpdatedAt:  updatedAt,
		StartedAt:  startedAt,
		FinishedAt: finishedAt,
	}, nil
}

// ListJobs returns jobs for a user, optionally filtered by type.
func (s *Service) ListJobs(ctx context.Context, userID, jobType string) ([]database.Job, error) {
	jobs := make([]database.Job, 0)
	if s.pgQueries != nil {
		uid, err := uuid.Parse(userID)
		if err != nil {
			return nil, fmt.Errorf("parse user id: %w", err)
		}
		if jobType != "" {
			rows, err := s.pgQueries.ListJobsByUserAndType(ctx, pgsqlc.ListJobsByUserAndTypeParams{UserID: uid, Type: jobType})
			if err != nil {
				return nil, fmt.Errorf("list jobs: %w", err)
			}
			jobs = make([]database.Job, 0, len(rows))
			for _, row := range rows {
				jobs = append(jobs, database.Job{
					ID:         row.ID,
					UserID:     row.UserID,
					Type:       row.Type,
					Status:     row.Status,
					InputRef:   row.InputRef,
					OutputRef:  row.OutputRef,
					Error:      row.Error,
					WorkerID:   row.WorkerID,
					CreatedAt:  row.CreatedAt,
					UpdatedAt:  row.UpdatedAt,
					StartedAt:  dbtime.NullableTimeFromPG(row.StartedAt),
					FinishedAt: dbtime.NullableTimeFromPG(row.FinishedAt),
				})
			}
			return jobs, nil
		}
		rows, err := s.pgQueries.ListJobsByUser(ctx, uid)
		if err != nil {
			return nil, fmt.Errorf("list jobs: %w", err)
		}
		jobs = make([]database.Job, 0, len(rows))
		for _, row := range rows {
			jobs = append(jobs, database.Job{
				ID:         row.ID,
				UserID:     row.UserID,
				Type:       row.Type,
				Status:     row.Status,
				InputRef:   row.InputRef,
				OutputRef:  row.OutputRef,
				Error:      row.Error,
				WorkerID:   row.WorkerID,
				CreatedAt:  row.CreatedAt,
				UpdatedAt:  row.UpdatedAt,
				StartedAt:  dbtime.NullableTimeFromPG(row.StartedAt),
				FinishedAt: dbtime.NullableTimeFromPG(row.FinishedAt),
			})
		}
		return jobs, nil
	}

	if jobType != "" {
		rows, err := s.sqliteQueries.ListJobsByUserAndType(ctx, sqliteqlc.ListJobsByUserAndTypeParams{UserID: userID, Type: jobType})
		if err != nil {
			return nil, fmt.Errorf("list jobs: %w", err)
		}
		jobs = make([]database.Job, 0, len(rows))
		for _, row := range rows {
			createdAt, err := dbtime.ParseSQLiteTime(row.CreatedAt)
			if err != nil {
				return nil, err
			}
			updatedAt, err := dbtime.ParseSQLiteTime(row.UpdatedAt)
			if err != nil {
				return nil, err
			}
			startedAt, err := dbtime.NullableTimeFromSQLite(row.StartedAt)
			if err != nil {
				return nil, err
			}
			finishedAt, err := dbtime.NullableTimeFromSQLite(row.FinishedAt)
			if err != nil {
				return nil, err
			}
			jobs = append(jobs, database.Job{
				ID:         row.ID,
				UserID:     row.UserID,
				Type:       row.Type,
				Status:     row.Status,
				InputRef:   row.InputRef,
				OutputRef:  row.OutputRef,
				Error:      row.Error,
				WorkerID:   row.WorkerID,
				CreatedAt:  createdAt,
				UpdatedAt:  updatedAt,
				StartedAt:  startedAt,
				FinishedAt: finishedAt,
			})
		}
		return jobs, nil
	}

	rows, err := s.sqliteQueries.ListJobsByUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list jobs: %w", err)
	}
	jobs = make([]database.Job, 0, len(rows))
	for _, row := range rows {
		createdAt, err := dbtime.ParseSQLiteTime(row.CreatedAt)
		if err != nil {
			return nil, err
		}
		updatedAt, err := dbtime.ParseSQLiteTime(row.UpdatedAt)
		if err != nil {
			return nil, err
		}
		startedAt, err := dbtime.NullableTimeFromSQLite(row.StartedAt)
		if err != nil {
			return nil, err
		}
		finishedAt, err := dbtime.NullableTimeFromSQLite(row.FinishedAt)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, database.Job{
			ID:         row.ID,
			UserID:     row.UserID,
			Type:       row.Type,
			Status:     row.Status,
			InputRef:   row.InputRef,
			OutputRef:  row.OutputRef,
			Error:      row.Error,
			WorkerID:   row.WorkerID,
			CreatedAt:  createdAt,
			UpdatedAt:  updatedAt,
			StartedAt:  startedAt,
			FinishedAt: finishedAt,
		})
	}
	return jobs, nil
}

// UpdateJobStatus updates a job's status and optionally its output.
func (s *Service) UpdateJobStatus(ctx context.Context, jobID, status, outputRef, errMsg string) error {
	now := time.Now()
	startedAtPG := sql.NullTime{}
	finishedAtPG := sql.NullTime{}
	startedAtSQLite := sql.NullString{}
	finishedAtSQLite := sql.NullString{}

	switch status {
	case "processing":
		startedAtPG = sql.NullTime{Valid: true, Time: now}
		startedAtSQLite = sql.NullString{Valid: true, String: dbtime.FormatSQLiteTime(now)}
	case "completed", "failed":
		finishedAtPG = sql.NullTime{Valid: true, Time: now}
		finishedAtSQLite = sql.NullString{Valid: true, String: dbtime.FormatSQLiteTime(now)}
	}

	if s.pgQueries != nil {
		jid, err := uuid.Parse(jobID)
		if err != nil {
			return fmt.Errorf("parse job id: %w", err)
		}
		return s.pgQueries.UpdateJobStatus(ctx, pgsqlc.UpdateJobStatusParams{
			Status:     status,
			OutputRef:  outputRef,
			Error:      errMsg,
			StartedAt:  startedAtPG,
			FinishedAt: finishedAtPG,
			ID:         jid,
		})
	}

	return s.sqliteQueries.UpdateJobStatus(ctx, sqliteqlc.UpdateJobStatusParams{
		Status:     status,
		OutputRef:  outputRef,
		Error:      errMsg,
		StartedAt:  startedAtSQLite,
		FinishedAt: finishedAtSQLite,
		ID:         jobID,
	})
}

// LocalWorker processes jobs locally (placeholder for future implementation).
type LocalWorker struct{}

func (w *LocalWorker) Submit(ctx context.Context, job *database.Job) error {
	// In-process worker stub: desktop clients handle their own transcription/summarization
	// locally. This adapter exists for self-hosted setups that might run server-side
	// processing in the future.
	return fmt.Errorf("local worker: server-side processing not implemented; use desktop client")
}

func (w *LocalWorker) CheckStatus(ctx context.Context, jobID string) (string, error) {
	return "pending", nil
}

// RemoteWorker dispatches jobs to external GPU worker services (which will be done in future)
type RemoteWorker struct{}

func (w *RemoteWorker) Submit(ctx context.Context, job *database.Job) error {
	// TODO: Implement remote GPU worker dispatch via HTTP/gRPC/message queue
	return fmt.Errorf("remote worker: GPU worker integration not yet implemented")
}

func (w *RemoteWorker) CheckStatus(ctx context.Context, jobID string) (string, error) {
	return "pending", nil
}
