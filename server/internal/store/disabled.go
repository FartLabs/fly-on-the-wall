package store

import (
	"context"
	"errors"
	"io"
	"time"
)

var ErrObjectStoreDisabled = errors.New("object storage is disabled")

type DisabledStore struct{}

func NewDisabledStore() *DisabledStore {
	return &DisabledStore{}
}

func (s *DisabledStore) PutObject(ctx context.Context, key string, body io.Reader, size int64, contentType string) error {
	return ErrObjectStoreDisabled
}

func (s *DisabledStore) GetObject(ctx context.Context, key string) (io.ReadCloser, error) {
	return nil, ErrObjectStoreDisabled
}

func (s *DisabledStore) DeleteObject(ctx context.Context, key string) error {
	return ErrObjectStoreDisabled
}

func (s *DisabledStore) GeneratePresignedUploadURL(ctx context.Context, key string, expiry time.Duration) (string, error) {
	return "", ErrObjectStoreDisabled
}

func (s *DisabledStore) GeneratePresignedDownloadURL(ctx context.Context, key string, expiry time.Duration) (string, error) {
	return "", ErrObjectStoreDisabled
}

var _ ObjectStore = (*DisabledStore)(nil)
