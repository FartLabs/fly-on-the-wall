-- name: CreateDevice :one
INSERT INTO devices (id, user_id, device_name, public_key, wrapped_user_key, last_seen_at, created_at)
VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), ?, ?, ?, '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
RETURNING id, user_id, device_name, public_key, wrapped_user_key, last_seen_at, created_at;

-- name: ListDevicesByUser :many
SELECT id, user_id, device_name, public_key, wrapped_user_key, last_seen_at, created_at
FROM devices
WHERE user_id = ?
ORDER BY created_at;

-- name: UpdateDeviceKey :execrows
UPDATE devices
SET wrapped_user_key = ?, last_seen_at = CURRENT_TIMESTAMP
WHERE id = ? AND user_id = ?;

-- name: DeleteDevice :exec
DELETE FROM devices WHERE id = ? AND user_id = ?;

-- name: CreateEncryptedNote :one
INSERT INTO encrypted_notes (id, user_id, object_key, payload_size, version, recording_ref, created_at, updated_at)
VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), ?, ?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
RETURNING id, user_id, object_key, payload_size, version, recording_ref, created_at, updated_at, deleted_at;

-- name: UpdateEncryptedNote :one
UPDATE encrypted_notes
SET object_key = ?, payload_size = ?, recording_ref = ?,
    version = version + 1, updated_at = CURRENT_TIMESTAMP
WHERE id = ? AND user_id = ? AND version = ?
RETURNING id, user_id, object_key, payload_size, version, recording_ref, created_at, updated_at, deleted_at;

-- name: GetEncryptedNote :one
SELECT id, user_id, object_key, payload_size, version, recording_ref, created_at, updated_at, deleted_at
FROM encrypted_notes
WHERE id = ? AND user_id = ?;

-- name: SoftDeleteEncryptedNote :execrows
UPDATE encrypted_notes
SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, version = version + 1
WHERE id = ? AND user_id = ? AND deleted_at IS NULL;

-- name: CreateEncryptedRecording :one
INSERT INTO encrypted_recordings (id, user_id, object_key, size_bytes, content_nonce, encrypted_meta, version, created_at, updated_at)
VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
RETURNING id, user_id, object_key, size_bytes, content_nonce, encrypted_meta, version, created_at, updated_at, deleted_at;

-- name: RecordingOwnedByUser :one
SELECT EXISTS(
  SELECT 1 FROM encrypted_recordings
  WHERE object_key = ? AND user_id = ?
);

-- name: SoftDeleteEncryptedRecording :execrows
UPDATE encrypted_recordings
SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, version = version + 1
WHERE id = ? AND user_id = ? AND deleted_at IS NULL;

-- name: ListEncryptedNoteChanges :many
SELECT id, user_id, object_key, payload_size, version, recording_ref, created_at, updated_at, deleted_at
FROM encrypted_notes
WHERE user_id = ? AND updated_at > ?
ORDER BY updated_at ASC
LIMIT ?;

-- name: ListEncryptedRecordingChanges :many
SELECT id, user_id, object_key, size_bytes, content_nonce, encrypted_meta, version, created_at, updated_at, deleted_at
FROM encrypted_recordings
WHERE user_id = ? AND updated_at > ?
ORDER BY updated_at ASC
LIMIT ?;

-- name: UpsertSyncCursor :exec
INSERT INTO sync_cursors (id, user_id, device_id, entity, cursor, updated_at)
VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), ?, ?, ?, ?, CURRENT_TIMESTAMP)
ON CONFLICT (device_id, entity)
DO UPDATE SET cursor = excluded.cursor, updated_at = CURRENT_TIMESTAMP;

-- name: GetSyncCursor :one
SELECT cursor
FROM sync_cursors
WHERE device_id = ? AND entity = ?;
