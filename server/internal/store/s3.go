package store

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// ObjectStore defines the interface for storing encrypted recording blobs.
type ObjectStore interface {
	// PutObject uploads an encrypted object.
	PutObject(ctx context.Context, key string, body io.Reader, size int64, contentType string) error

	// GetObject downloads an encrypted object.
	GetObject(ctx context.Context, key string) (io.ReadCloser, error)

	// DeleteObject removes an object.
	DeleteObject(ctx context.Context, key string) error

	// GeneratePresignedUploadURL creates a pre-signed URL for direct upload.
	GeneratePresignedUploadURL(ctx context.Context, key string, expiry time.Duration) (string, error)

	// GeneratePresignedDownloadURL creates a pre-signed URL for direct download.
	GeneratePresignedDownloadURL(ctx context.Context, key string, expiry time.Duration) (string, error)
}

// S3Config holds S3-compatible store configuration.
type S3Config struct {
	Endpoint        string
	Region          string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
	ForcePathStyle  bool
}

// S3Store implements ObjectStore using an S3-compatible backend (AWS S3, MinIO, etc.).
type S3Store struct {
	client    *s3.Client
	presigner *s3.PresignClient
	bucket    string
}

// NewS3Store creates a new S3-compatible object store.
func NewS3Store(cfg S3Config) (*S3Store, error) {
	resolver := aws.EndpointResolverWithOptionsFunc(
		func(service, region string, options ...interface{}) (aws.Endpoint, error) {
			return aws.Endpoint{
				URL:               cfg.Endpoint,
				HostnameImmutable: cfg.ForcePathStyle,
			}, nil
		},
	)

	awsCfg, err := config.LoadDefaultConfig(context.Background(),
		config.WithRegion(cfg.Region),
		config.WithEndpointResolverWithOptions(resolver),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			cfg.AccessKeyID, cfg.SecretAccessKey, "",
		)),
	)
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.UsePathStyle = cfg.ForcePathStyle
	})

	_, err = client.HeadBucket(context.Background(), &s3.HeadBucketInput{
		Bucket: aws.String(cfg.Bucket),
	})
	if err != nil {
		_, err = client.CreateBucket(context.Background(), &s3.CreateBucketInput{
			Bucket: aws.String(cfg.Bucket),
		})
		if err != nil {
			return nil, fmt.Errorf("create bucket %s: %w", cfg.Bucket, err)
		}
	}

	return &S3Store{
		client:    client,
		presigner: s3.NewPresignClient(client),
		bucket:    cfg.Bucket,
	}, nil
}

// PutObject uploads an encrypted object to S3.
func (s *S3Store) PutObject(ctx context.Context, key string, body io.Reader, size int64, contentType string) error {
	input := &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(key),
		Body:        body,
		ContentType: aws.String(contentType),
	}
	if size > 0 {
		input.ContentLength = aws.Int64(size)
	}

	_, err := s.client.PutObject(ctx, input)
	if err != nil {
		return fmt.Errorf("put object %s: %w", key, err)
	}
	return nil
}

// GetObject downloads an encrypted object from S3.
func (s *S3Store) GetObject(ctx context.Context, key string) (io.ReadCloser, error) {
	output, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, fmt.Errorf("get object %s: %w", key, err)
	}
	return output.Body, nil
}

// DeleteObject removes an object from S3.
func (s *S3Store) DeleteObject(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("delete object %s: %w", key, err)
	}
	return nil
}

// GeneratePresignedUploadURL creates a pre-signed URL for direct upload to S3.
func (s *S3Store) GeneratePresignedUploadURL(ctx context.Context, key string, expiry time.Duration) (string, error) {
	req, err := s.presigner.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(expiry))
	if err != nil {
		return "", fmt.Errorf("presign upload %s: %w", key, err)
	}
	return req.URL, nil
}

// GeneratePresignedDownloadURL creates a pre-signed URL for direct download from S3.
func (s *S3Store) GeneratePresignedDownloadURL(ctx context.Context, key string, expiry time.Duration) (string, error) {
	req, err := s.presigner.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(expiry))
	if err != nil {
		return "", fmt.Errorf("presign download %s: %w", key, err)
	}
	return req.URL, nil
}

// verify S3Store implements ObjectStore.
var _ ObjectStore = (*S3Store)(nil)
