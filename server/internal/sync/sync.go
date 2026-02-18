package sync

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/fly-on-the-wall/server/internal/database"
	"github.com/fly-on-the-wall/server/internal/database/dbtime"
	"github.com/fly-on-the-wall/server/internal/database/sqlc/pgsqlc"
	"github.com/fly-on-the-wall/server/internal/database/sqlc/sqliteqlc"
	"github.com/fly-on-the-wall/server/internal/store"
	"github.com/google/uuid"
)

var (
	ErrVersionConflict = errors.New("version conflict: note has been modified")
	ErrNotFound        = errors.New("resource not found")
)

// Service handles E2EE data synchronization.
type Service struct {
	db            *sql.DB
	store         store.ObjectStore
	driver        string
	pgQueries     *pgsqlc.Queries
	sqliteQueries *sqliteqlc.Queries
}

func NewService(db *sql.DB, store store.ObjectStore, driver string) *Service {
	driver = strings.ToLower(strings.TrimSpace(driver))
	s := &Service{db: db, store: store, driver: driver}
	if driver == "postgres" || driver == "postgresql" {
		s.pgQueries = pgsqlc.New(db)
		return s
	}
	s.sqliteQueries = sqliteqlc.New(db)
	return s
}

// --- Device Management ---

// RegisterDevice registers a new device for E2EE key exchange.
func (s *Service) RegisterDevice(ctx context.Context, userID, deviceName, publicKey string) (*database.Device, error) {
	if s.pgQueries != nil {
		uid, err := uuid.Parse(userID)
		if err != nil {
			return nil, fmt.Errorf("parse user id: %w", err)
		}
		row, err := s.pgQueries.CreateDevice(ctx, pgsqlc.CreateDeviceParams{
			Column1:    uid,
			DeviceName: deviceName,
			PublicKey:  publicKey,
		})
		if err != nil {
			return nil, fmt.Errorf("register device: %w", err)
		}
		return &database.Device{
			ID:             row.ID,
			UserID:         row.UserID,
			DeviceName:     row.DeviceName,
			PublicKey:      row.PublicKey,
			WrappedUserKey: row.WrappedUserKey,
			LastSeenAt:     row.LastSeenAt,
			CreatedAt:      row.CreatedAt,
		}, nil
	}

	row, err := s.sqliteQueries.CreateDevice(ctx, sqliteqlc.CreateDeviceParams{
		UserID:     userID,
		DeviceName: deviceName,
		PublicKey:  publicKey,
	})
	if err != nil {
		return nil, fmt.Errorf("register device: %w", err)
	}
	lastSeenAt, err := dbtime.ParseSQLiteTime(row.LastSeenAt)
	if err != nil {
		return nil, err
	}
	createdAt, err := dbtime.ParseSQLiteTime(row.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &database.Device{
		ID:             row.ID,
		UserID:         row.UserID,
		DeviceName:     row.DeviceName,
		PublicKey:      row.PublicKey,
		WrappedUserKey: row.WrappedUserKey,
		LastSeenAt:     lastSeenAt,
		CreatedAt:      createdAt,
	}, nil
}

func (s *Service) ListDevices(ctx context.Context, userID string) ([]database.Device, error) {
	if s.pgQueries != nil {
		uid, err := uuid.Parse(userID)
		if err != nil {
			return nil, fmt.Errorf("parse user id: %w", err)
		}
		rows, err := s.pgQueries.ListDevicesByUser(ctx, uid)
		if err != nil {
			return nil, fmt.Errorf("list devices: %w", err)
		}
		devices := make([]database.Device, 0, len(rows))
		for _, row := range rows {
			devices = append(devices, database.Device{
				ID:             row.ID,
				UserID:         row.UserID,
				DeviceName:     row.DeviceName,
				PublicKey:      row.PublicKey,
				WrappedUserKey: row.WrappedUserKey,
				LastSeenAt:     row.LastSeenAt,
				CreatedAt:      row.CreatedAt,
			})
		}
		return devices, nil
	}

	rows, err := s.sqliteQueries.ListDevicesByUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list devices: %w", err)
	}
	devices := make([]database.Device, 0, len(rows))
	for _, row := range rows {
		lastSeenAt, err := dbtime.ParseSQLiteTime(row.LastSeenAt)
		if err != nil {
			return nil, err
		}
		createdAt, err := dbtime.ParseSQLiteTime(row.CreatedAt)
		if err != nil {
			return nil, err
		}
		devices = append(devices, database.Device{
			ID:             row.ID,
			UserID:         row.UserID,
			DeviceName:     row.DeviceName,
			PublicKey:      row.PublicKey,
			WrappedUserKey: row.WrappedUserKey,
			LastSeenAt:     lastSeenAt,
			CreatedAt:      createdAt,
		})
	}
	return devices, nil
}

// UpdateDeviceKey updates the wrapped user key for a device (e.g., during key provisioning).
func (s *Service) UpdateDeviceKey(ctx context.Context, deviceID, userID, wrappedKey string) error {
	var (
		n   int64
		err error
	)
	if s.pgQueries != nil {
		did, parseErr := uuid.Parse(deviceID)
		if parseErr != nil {
			return fmt.Errorf("parse device id: %w", parseErr)
		}
		uid, parseErr := uuid.Parse(userID)
		if parseErr != nil {
			return fmt.Errorf("parse user id: %w", parseErr)
		}
		n, err = s.pgQueries.UpdateDeviceKey(ctx, pgsqlc.UpdateDeviceKeyParams{
			WrappedUserKey: wrappedKey,
			ID:             did,
			UserID:         uid,
		})
	} else {
		n, err = s.sqliteQueries.UpdateDeviceKey(ctx, sqliteqlc.UpdateDeviceKeyParams{
			WrappedUserKey: wrappedKey,
			ID:             deviceID,
			UserID:         userID,
		})
	}
	if err != nil {
		return fmt.Errorf("update device key: %w", err)
	}

	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// RemoveDevice removes a device.
func (s *Service) RemoveDevice(ctx context.Context, deviceID, userID string) error {
	if s.pgQueries != nil {
		did, err := uuid.Parse(deviceID)
		if err != nil {
			return fmt.Errorf("parse device id: %w", err)
		}
		uid, err := uuid.Parse(userID)
		if err != nil {
			return fmt.Errorf("parse user id: %w", err)
		}
		return s.pgQueries.DeleteDevice(ctx, pgsqlc.DeleteDeviceParams{ID: did, UserID: uid})
	}
	return s.sqliteQueries.DeleteDevice(ctx, sqliteqlc.DeleteDeviceParams{ID: deviceID, UserID: userID})
}

// --- Encrypted Notes ---

// noteObjectKey returns the object store key for a note payload.
func noteObjectKey(userID, noteID string, version int) string {
	return fmt.Sprintf("notes/%s/%s/v%d.bin", userID, noteID, version)
}

// putNotePayload writes the note's encrypted content to the object store.
func (s *Service) putNotePayload(ctx context.Context, key string, data []byte) error {
	return s.store.PutObject(ctx, key, bytes.NewReader(data), int64(len(data)), "application/octet-stream")
}

// getNotePayload reads the note's encrypted content from the object store.
func (s *Service) getNotePayload(ctx context.Context, key string) ([]byte, error) {
	rc, err := s.store.GetObject(ctx, key)
	if err != nil {
		return nil, fmt.Errorf("get note payload: %w", err)
	}
	defer rc.Close()
	return io.ReadAll(rc)
}

// UpsertNote creates or updates an encrypted note with optimistic concurrency.
func (s *Service) UpsertNote(ctx context.Context, note *database.EncryptedNote) (*database.EncryptedNote, error) {
	payload := note.EncryptedContent // ciphertext+nonce combined
	payloadSize := int64(len(payload))

	if note.ID == "" {
		// --- CREATE ---
		// We need the note ID before we can build the object key, so we create the DB row first
		// with a placeholder key, then update after upload. Instead, generate the ID upfront.
		noteID := uuid.New().String()
		objectKey := noteObjectKey(note.UserID, noteID, 1)

		if err := s.putNotePayload(ctx, objectKey, payload); err != nil {
			return nil, fmt.Errorf("upload note payload: %w", err)
		}

		if s.pgQueries != nil {
			uid, err := uuid.Parse(note.UserID)
			if err != nil {
				return nil, fmt.Errorf("parse user id: %w", err)
			}
			row, err := s.pgQueries.CreateEncryptedNote(ctx, pgsqlc.CreateEncryptedNoteParams{
				Column1:      uid,
				ObjectKey:    objectKey,
				PayloadSize:  payloadSize,
				RecordingRef: note.RecordingRef,
			})
			if err != nil {
				return nil, fmt.Errorf("insert note: %w", err)
			}
			note.ID = row.ID
			note.ObjectKey = row.ObjectKey
			note.PayloadSize = row.PayloadSize
			note.Version = int(row.Version)
			note.CreatedAt = row.CreatedAt
			note.UpdatedAt = row.UpdatedAt
			note.DeletedAt = dbtime.NullableTimeFromPG(row.DeletedAt)
			return note, nil
		}

		row, err := s.sqliteQueries.CreateEncryptedNote(ctx, sqliteqlc.CreateEncryptedNoteParams{
			UserID:       note.UserID,
			ObjectKey:    objectKey,
			PayloadSize:  payloadSize,
			RecordingRef: note.RecordingRef,
		})
		if err != nil {
			return nil, fmt.Errorf("insert note: %w", err)
		}
		createdAt, err := dbtime.ParseSQLiteTime(row.CreatedAt)
		if err != nil {
			return nil, err
		}
		updatedAt, err := dbtime.ParseSQLiteTime(row.UpdatedAt)
		if err != nil {
			return nil, err
		}
		deletedAt, err := dbtime.NullableTimeFromSQLite(row.DeletedAt)
		if err != nil {
			return nil, err
		}
		note.ID = row.ID
		note.ObjectKey = row.ObjectKey
		note.PayloadSize = row.PayloadSize
		note.Version = int(row.Version)
		note.CreatedAt = createdAt
		note.UpdatedAt = updatedAt
		note.DeletedAt = deletedAt
		return note, nil
	}

	// --- UPDATE ---
	newVersion := note.Version + 1
	objectKey := noteObjectKey(note.UserID, note.ID, newVersion)

	if err := s.putNotePayload(ctx, objectKey, payload); err != nil {
		return nil, fmt.Errorf("upload note payload: %w", err)
	}

	if s.pgQueries != nil {
		nid, err := uuid.Parse(note.ID)
		if err != nil {
			return nil, fmt.Errorf("parse note id: %w", err)
		}
		uid, err := uuid.Parse(note.UserID)
		if err != nil {
			return nil, fmt.Errorf("parse user id: %w", err)
		}
		row, err := s.pgQueries.UpdateEncryptedNote(ctx, pgsqlc.UpdateEncryptedNoteParams{
			ObjectKey:    objectKey,
			PayloadSize:  payloadSize,
			RecordingRef: note.RecordingRef,
			ID:           nid,
			UserID:       uid,
			Version:      int32(note.Version),
		})
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, ErrVersionConflict
			}
			return nil, fmt.Errorf("update note: %w", err)
		}
		note.ObjectKey = row.ObjectKey
		note.PayloadSize = row.PayloadSize
		note.Version = int(row.Version)
		note.UpdatedAt = row.UpdatedAt
		note.CreatedAt = row.CreatedAt
		note.DeletedAt = dbtime.NullableTimeFromPG(row.DeletedAt)
		return note, nil
	}

	row, err := s.sqliteQueries.UpdateEncryptedNote(ctx, sqliteqlc.UpdateEncryptedNoteParams{
		ObjectKey:    objectKey,
		PayloadSize:  payloadSize,
		RecordingRef: note.RecordingRef,
		ID:           note.ID,
		UserID:       note.UserID,
		Version:      int64(note.Version),
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrVersionConflict
		}
		return nil, fmt.Errorf("update note: %w", err)
	}
	updatedAt, err := dbtime.ParseSQLiteTime(row.UpdatedAt)
	if err != nil {
		return nil, err
	}
	createdAt, err := dbtime.ParseSQLiteTime(row.CreatedAt)
	if err != nil {
		return nil, err
	}
	deletedAt, err := dbtime.NullableTimeFromSQLite(row.DeletedAt)
	if err != nil {
		return nil, err
	}
	note.ObjectKey = row.ObjectKey
	note.PayloadSize = row.PayloadSize
	note.Version = int(row.Version)
	note.UpdatedAt = updatedAt
	note.CreatedAt = createdAt
	note.DeletedAt = deletedAt
	return note, nil
}

// GetNote retrieves a single encrypted note.
func (s *Service) GetNote(ctx context.Context, noteID, userID string) (*database.EncryptedNote, error) {
	var note *database.EncryptedNote

	if s.pgQueries != nil {
		nid, err := uuid.Parse(noteID)
		if err != nil {
			return nil, fmt.Errorf("parse note id: %w", err)
		}
		uid, err := uuid.Parse(userID)
		if err != nil {
			return nil, fmt.Errorf("parse user id: %w", err)
		}
		row, err := s.pgQueries.GetEncryptedNote(ctx, pgsqlc.GetEncryptedNoteParams{ID: nid, UserID: uid})
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, ErrNotFound
			}
			return nil, fmt.Errorf("get note: %w", err)
		}
		note = &database.EncryptedNote{
			ID:           row.ID,
			UserID:       row.UserID,
			ObjectKey:    row.ObjectKey,
			PayloadSize:  row.PayloadSize,
			Version:      int(row.Version),
			RecordingRef: row.RecordingRef,
			CreatedAt:    row.CreatedAt,
			UpdatedAt:    row.UpdatedAt,
			DeletedAt:    dbtime.NullableTimeFromPG(row.DeletedAt),
		}
	} else {
		row, err := s.sqliteQueries.GetEncryptedNote(ctx, sqliteqlc.GetEncryptedNoteParams{ID: noteID, UserID: userID})
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, ErrNotFound
			}
			return nil, fmt.Errorf("get note: %w", err)
		}
		createdAt, err := dbtime.ParseSQLiteTime(row.CreatedAt)
		if err != nil {
			return nil, err
		}
		updatedAt, err := dbtime.ParseSQLiteTime(row.UpdatedAt)
		if err != nil {
			return nil, err
		}
		deletedAt, err := dbtime.NullableTimeFromSQLite(row.DeletedAt)
		if err != nil {
			return nil, err
		}
		note = &database.EncryptedNote{
			ID:           row.ID,
			UserID:       row.UserID,
			ObjectKey:    row.ObjectKey,
			PayloadSize:  row.PayloadSize,
			Version:      int(row.Version),
			RecordingRef: row.RecordingRef,
			CreatedAt:    createdAt,
			UpdatedAt:    updatedAt,
			DeletedAt:    deletedAt,
		}
	}

	// Fetch payload from object store
	if note.ObjectKey != "" && note.DeletedAt == nil {
		payload, err := s.getNotePayload(ctx, note.ObjectKey)
		if err != nil {
			return nil, fmt.Errorf("fetch note payload: %w", err)
		}
		note.EncryptedContent = payload
	}

	return note, nil
}

// DeleteNote performs a soft-delete on a note.
func (s *Service) DeleteNote(ctx context.Context, noteID, userID string) error {
	var (
		n   int64
		err error
	)
	if s.pgQueries != nil {
		nid, parseErr := uuid.Parse(noteID)
		if parseErr != nil {
			return fmt.Errorf("parse note id: %w", parseErr)
		}
		uid, parseErr := uuid.Parse(userID)
		if parseErr != nil {
			return fmt.Errorf("parse user id: %w", parseErr)
		}
		n, err = s.pgQueries.SoftDeleteEncryptedNote(ctx, pgsqlc.SoftDeleteEncryptedNoteParams{ID: nid, UserID: uid})
	} else {
		n, err = s.sqliteQueries.SoftDeleteEncryptedNote(ctx, sqliteqlc.SoftDeleteEncryptedNoteParams{ID: noteID, UserID: userID})
	}
	if err != nil {
		return fmt.Errorf("delete note: %w", err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// CreateRecordingMeta stores metadata for an encrypted recording.
func (s *Service) CreateRecordingMeta(ctx context.Context, rec *database.EncryptedRecording) (*database.EncryptedRecording, error) {
	if s.pgQueries != nil {
		uid, err := uuid.Parse(rec.UserID)
		if err != nil {
			return nil, fmt.Errorf("parse user id: %w", err)
		}
		row, err := s.pgQueries.CreateEncryptedRecording(ctx, pgsqlc.CreateEncryptedRecordingParams{
			Column1:       uid,
			ObjectKey:     rec.ObjectKey,
			SizeBytes:     rec.SizeBytes,
			ContentNonce:  rec.ContentNonce,
			EncryptedMeta: rec.EncryptedMeta,
		})
		if err != nil {
			return nil, fmt.Errorf("insert recording meta: %w", err)
		}
		rec.ID = row.ID
		rec.Version = int(row.Version)
		rec.CreatedAt = row.CreatedAt
		rec.UpdatedAt = row.UpdatedAt
		rec.DeletedAt = dbtime.NullableTimeFromPG(row.DeletedAt)
		return rec, nil
	}

	row, err := s.sqliteQueries.CreateEncryptedRecording(ctx, sqliteqlc.CreateEncryptedRecordingParams{
		UserID:        rec.UserID,
		ObjectKey:     rec.ObjectKey,
		SizeBytes:     rec.SizeBytes,
		ContentNonce:  rec.ContentNonce,
		EncryptedMeta: rec.EncryptedMeta,
	})
	if err != nil {
		return nil, fmt.Errorf("insert recording meta: %w", err)
	}
	createdAt, err := dbtime.ParseSQLiteTime(row.CreatedAt)
	if err != nil {
		return nil, err
	}
	updatedAt, err := dbtime.ParseSQLiteTime(row.UpdatedAt)
	if err != nil {
		return nil, err
	}
	deletedAt, err := dbtime.NullableTimeFromSQLite(row.DeletedAt)
	if err != nil {
		return nil, err
	}
	rec.ID = row.ID
	rec.Version = int(row.Version)
	rec.CreatedAt = createdAt
	rec.UpdatedAt = updatedAt
	rec.DeletedAt = deletedAt
	return rec, nil
}

// GetRecordingUploadURL returns a pre-signed URL for uploading an encrypted recording.
func (s *Service) GetRecordingUploadURL(ctx context.Context, objectKey string) (string, error) {
	return s.store.GeneratePresignedUploadURL(ctx, objectKey, 15*time.Minute)
}

// GetRecordingDownloadURL returns a pre-signed URL for downloading an encrypted recording.
func (s *Service) GetRecordingDownloadURL(ctx context.Context, objectKey, userID string) (string, error) {
	if s.pgQueries != nil {
		uid, err := uuid.Parse(userID)
		if err != nil {
			return "", fmt.Errorf("parse user id: %w", err)
		}
		exists, err := s.pgQueries.RecordingOwnedByUser(ctx, pgsqlc.RecordingOwnedByUserParams{
			ObjectKey: objectKey,
			UserID:    uid,
		})
		if err != nil || !exists {
			return "", ErrNotFound
		}
	} else {
		exists, err := s.sqliteQueries.RecordingOwnedByUser(ctx, sqliteqlc.RecordingOwnedByUserParams{
			ObjectKey: objectKey,
			UserID:    userID,
		})
		if err != nil || exists == 0 {
			return "", ErrNotFound
		}
	}

	return s.store.GeneratePresignedDownloadURL(ctx, objectKey, 15*time.Minute)
}

// DeleteRecording soft-deletes a recording and optionally removes the object.
func (s *Service) DeleteRecording(ctx context.Context, recordingID, userID string) error {
	var (
		n   int64
		err error
	)
	if s.pgQueries != nil {
		rid, parseErr := uuid.Parse(recordingID)
		if parseErr != nil {
			return fmt.Errorf("parse recording id: %w", parseErr)
		}
		uid, parseErr := uuid.Parse(userID)
		if parseErr != nil {
			return fmt.Errorf("parse user id: %w", parseErr)
		}
		n, err = s.pgQueries.SoftDeleteEncryptedRecording(ctx, pgsqlc.SoftDeleteEncryptedRecordingParams{ID: rid, UserID: uid})
	} else {
		n, err = s.sqliteQueries.SoftDeleteEncryptedRecording(ctx, sqliteqlc.SoftDeleteEncryptedRecordingParams{ID: recordingID, UserID: userID})
	}
	if err != nil {
		return fmt.Errorf("delete recording: %w", err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// --- Delta Sync ---

// SyncDelta represents changes since a cursor.
type SyncDelta struct {
	Notes      []database.EncryptedNote      `json:"notes"`
	Recordings []database.EncryptedRecording `json:"recordings"`
	Cursor     time.Time                     `json:"cursor"`
	HasMore    bool                          `json:"has_more"`
}

// GetDelta returns all notes and recordings changed since the given cursor.
func (s *Service) GetDelta(ctx context.Context, userID string, since time.Time, limit int) (*SyncDelta, error) {
	if limit <= 0 {
		limit = 100
	}

	delta := &SyncDelta{
		Notes:      make([]database.EncryptedNote, 0),
		Recordings: make([]database.EncryptedRecording, 0),
	}

	if s.pgQueries != nil {
		uid, err := uuid.Parse(userID)
		if err != nil {
			return nil, fmt.Errorf("parse user id: %w", err)
		}
		noteRows, err := s.pgQueries.ListEncryptedNoteChanges(ctx, pgsqlc.ListEncryptedNoteChangesParams{
			UserID:    uid,
			UpdatedAt: since,
			Limit:     int32(limit),
		})
		if err != nil {
			return nil, fmt.Errorf("query note delta: %w", err)
		}
		for _, row := range noteRows {
			n := database.EncryptedNote{
				ID:           row.ID,
				UserID:       row.UserID,
				ObjectKey:    row.ObjectKey,
				PayloadSize:  row.PayloadSize,
				Version:      int(row.Version),
				RecordingRef: row.RecordingRef,
				CreatedAt:    row.CreatedAt,
				UpdatedAt:    row.UpdatedAt,
				DeletedAt:    dbtime.NullableTimeFromPG(row.DeletedAt),
			}
			delta.Notes = append(delta.Notes, n)
			if n.UpdatedAt.After(delta.Cursor) {
				delta.Cursor = n.UpdatedAt
			}
		}

		recRows, err := s.pgQueries.ListEncryptedRecordingChanges(ctx, pgsqlc.ListEncryptedRecordingChangesParams{
			UserID:    uid,
			UpdatedAt: since,
			Limit:     int32(limit),
		})
		if err != nil {
			return nil, fmt.Errorf("query recording delta: %w", err)
		}
		for _, row := range recRows {
			r := database.EncryptedRecording{
				ID:            row.ID,
				UserID:        row.UserID,
				ObjectKey:     row.ObjectKey,
				SizeBytes:     row.SizeBytes,
				ContentNonce:  row.ContentNonce,
				EncryptedMeta: row.EncryptedMeta,
				Version:       int(row.Version),
				CreatedAt:     row.CreatedAt,
				UpdatedAt:     row.UpdatedAt,
				DeletedAt:     dbtime.NullableTimeFromPG(row.DeletedAt),
			}
			delta.Recordings = append(delta.Recordings, r)
			if r.UpdatedAt.After(delta.Cursor) {
				delta.Cursor = r.UpdatedAt
			}
		}
	} else {
		noteRows, err := s.sqliteQueries.ListEncryptedNoteChanges(ctx, sqliteqlc.ListEncryptedNoteChangesParams{
			UserID:    userID,
			UpdatedAt: dbtime.FormatSQLiteTime(since),
			Limit:     int64(limit),
		})
		if err != nil {
			return nil, fmt.Errorf("query note delta: %w", err)
		}
		for _, row := range noteRows {
			createdAt, err := dbtime.ParseSQLiteTime(row.CreatedAt)
			if err != nil {
				return nil, err
			}
			updatedAt, err := dbtime.ParseSQLiteTime(row.UpdatedAt)
			if err != nil {
				return nil, err
			}
			deletedAt, err := dbtime.NullableTimeFromSQLite(row.DeletedAt)
			if err != nil {
				return nil, err
			}
			n := database.EncryptedNote{
				ID:           row.ID,
				UserID:       row.UserID,
				ObjectKey:    row.ObjectKey,
				PayloadSize:  row.PayloadSize,
				Version:      int(row.Version),
				RecordingRef: row.RecordingRef,
				CreatedAt:    createdAt,
				UpdatedAt:    updatedAt,
				DeletedAt:    deletedAt,
			}
			delta.Notes = append(delta.Notes, n)
			if n.UpdatedAt.After(delta.Cursor) {
				delta.Cursor = n.UpdatedAt
			}
		}

		recRows, err := s.sqliteQueries.ListEncryptedRecordingChanges(ctx, sqliteqlc.ListEncryptedRecordingChangesParams{
			UserID:    userID,
			UpdatedAt: dbtime.FormatSQLiteTime(since),
			Limit:     int64(limit),
		})
		if err != nil {
			return nil, fmt.Errorf("query recording delta: %w", err)
		}
		for _, row := range recRows {
			createdAt, err := dbtime.ParseSQLiteTime(row.CreatedAt)
			if err != nil {
				return nil, err
			}
			updatedAt, err := dbtime.ParseSQLiteTime(row.UpdatedAt)
			if err != nil {
				return nil, err
			}
			deletedAt, err := dbtime.NullableTimeFromSQLite(row.DeletedAt)
			if err != nil {
				return nil, err
			}
			r := database.EncryptedRecording{
				ID:            row.ID,
				UserID:        row.UserID,
				ObjectKey:     row.ObjectKey,
				SizeBytes:     row.SizeBytes,
				ContentNonce:  row.ContentNonce,
				EncryptedMeta: row.EncryptedMeta,
				Version:       int(row.Version),
				CreatedAt:     createdAt,
				UpdatedAt:     updatedAt,
				DeletedAt:     deletedAt,
			}
			delta.Recordings = append(delta.Recordings, r)
			if r.UpdatedAt.After(delta.Cursor) {
				delta.Cursor = r.UpdatedAt
			}
		}
	}

	totalItems := len(delta.Notes) + len(delta.Recordings)
	delta.HasMore = totalItems >= limit

	return delta, nil
}

// UpdateSyncCursor updates the sync cursor for a device after successful sync.
func (s *Service) UpdateSyncCursor(ctx context.Context, userID, deviceID, entity string, cursor time.Time) error {
	if s.pgQueries != nil {
		uid, err := uuid.Parse(userID)
		if err != nil {
			return fmt.Errorf("parse user id: %w", err)
		}
		did, err := uuid.Parse(deviceID)
		if err != nil {
			return fmt.Errorf("parse device id: %w", err)
		}
		return s.pgQueries.UpsertSyncCursor(ctx, pgsqlc.UpsertSyncCursorParams{
			Column1: uid,
			Column2: did,
			Entity:  entity,
			Cursor:  cursor,
		})
	}
	return s.sqliteQueries.UpsertSyncCursor(ctx, sqliteqlc.UpsertSyncCursorParams{
		UserID:   userID,
		DeviceID: deviceID,
		Entity:   entity,
		Cursor:   dbtime.FormatSQLiteTime(cursor),
	})
}

// GetSyncCursor retrieves the last sync cursor for a device.
func (s *Service) GetSyncCursor(ctx context.Context, deviceID, entity string) (time.Time, error) {
	if s.pgQueries != nil {
		did, err := uuid.Parse(deviceID)
		if err != nil {
			return time.Time{}, fmt.Errorf("parse device id: %w", err)
		}
		cursor, err := s.pgQueries.GetSyncCursor(ctx, pgsqlc.GetSyncCursorParams{DeviceID: did, Entity: entity})
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return time.Time{}, nil
			}
			return time.Time{}, err
		}
		return cursor, nil
	}

	cursor, err := s.sqliteQueries.GetSyncCursor(ctx, sqliteqlc.GetSyncCursorParams{DeviceID: deviceID, Entity: entity})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return time.Time{}, nil
		}
		return time.Time{}, err
	}
	parsed, err := dbtime.ParseSQLiteTime(cursor)
	if err != nil {
		return time.Time{}, err
	}
	return parsed, nil
}
