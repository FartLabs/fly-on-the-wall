package database

import "time"

// User represents an authenticated user account.
type User struct {
	ID           string    `json:"id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"-"`
	IsPremium    bool      `json:"is_premium"`
	IsAdmin      bool      `json:"is_admin"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// Session represents an active user session.
type Session struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Token     string    `json:"-"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

// Device represents a registered client device for E2EE key management.
type Device struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	DeviceName     string    `json:"device_name"`
	PublicKey      string    `json:"public_key"`       // Device's public key for key wrapping
	WrappedUserKey string    `json:"wrapped_user_key"` // User's master key encrypted with this device's public key
	LastSeenAt     time.Time `json:"last_seen_at"`
	CreatedAt      time.Time `json:"created_at"`
}

// EncryptedNote stores E2EE note metadata.
// The encrypted payload (ciphertext + nonce) is stored in object storage.
type EncryptedNote struct {
	ID               string     `json:"id"`
	UserID           string     `json:"user_id"`
	ObjectKey        string     `json:"object_key"`        // S3 object key for encrypted payload
	PayloadSize      int64      `json:"payload_size"`      // Size of encrypted payload in bytes
	EncryptedContent []byte     `json:"encrypted_content"` // Populated from object store on read (not persisted in DB)
	ContentNonce     []byte     `json:"content_nonce"`     // Populated from object store on read (not persisted in DB)
	Version          int        `json:"version"`           // Optimistic concurrency
	RecordingRef     string     `json:"recording_ref"`     // Reference to recording object key
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
	DeletedAt        *time.Time `json:"deleted_at,omitempty"` // Soft delete for sync
}

// EncryptedRecording stores metadata for an encrypted recording in object storage.
type EncryptedRecording struct {
	ID            string     `json:"id"`
	UserID        string     `json:"user_id"`
	ObjectKey     string     `json:"object_key"` // S3 object key
	SizeBytes     int64      `json:"size_bytes"`
	ContentNonce  []byte     `json:"content_nonce"`
	EncryptedMeta []byte     `json:"encrypted_meta"` // Encrypted original filename, duration, etc.
	Version       int        `json:"version"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
	DeletedAt     *time.Time `json:"deleted_at,omitempty"`
}

// SyncCursor tracks a device's sync position.
type SyncCursor struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	DeviceID  string    `json:"device_id"`
	Entity    string    `json:"entity"` // "note" or "recording"
	Cursor    time.Time `json:"cursor"` // Last synced updated_at
	UpdatedAt time.Time `json:"updated_at"`
}

// Subscription represents a user's billing/premium subscription.
type Subscription struct {
	ID                   string     `json:"id"`
	UserID               string     `json:"user_id"`
	StripeCustomerID     string     `json:"stripe_customer_id,omitempty"`
	StripeSubscriptionID string     `json:"stripe_subscription_id,omitempty"`
	Status               string     `json:"status"` // "active", "canceled", "past_due", "admin_granted"
	PlanID               string     `json:"plan_id"`
	CurrentPeriodEnd     *time.Time `json:"current_period_end,omitempty"`
	CreatedAt            time.Time  `json:"created_at"`
	UpdatedAt            time.Time  `json:"updated_at"`
}

// Job represents a transcription/summarization job.
type Job struct {
	ID         string     `json:"id"`
	UserID     string     `json:"user_id"`
	Type       string     `json:"type"`       // "transcription" or "summarization"
	Status     string     `json:"status"`     // "pending", "processing", "completed", "failed"
	InputRef   string     `json:"input_ref"`  // Object key or note ID
	OutputRef  string     `json:"output_ref"` // Result location
	Error      string     `json:"error,omitempty"`
	WorkerID   string     `json:"worker_id,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
	StartedAt  *time.Time `json:"started_at,omitempty"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
}
