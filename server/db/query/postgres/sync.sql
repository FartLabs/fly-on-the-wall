-- name: CreateDevice :one
INSERT INTO devices (id, user_id, device_name, public_key, wrapped_user_key, last_seen_at, created_at)
VALUES (gen_random_uuid(), $1::uuid, $2, $3, '', NOW(), NOW())
RETURNING id::text, user_id::text, device_name, public_key, wrapped_user_key, last_seen_at, created_at;

-- name: ListDevicesByUser :many
SELECT id::text, user_id::text, device_name, public_key, wrapped_user_key, last_seen_at, created_at
FROM devices
WHERE user_id::text = $1
ORDER BY created_at;

-- name: UpdateDeviceKey :execrows
UPDATE devices
SET wrapped_user_key = $1, last_seen_at = CURRENT_TIMESTAMP
WHERE id::text = $2 AND user_id::text = $3;

-- name: DeleteDevice :exec
DELETE FROM devices WHERE id::text = $1 AND user_id::text = $2;

-- name: CreateSyncNote :one
INSERT INTO sync_notes (id, user_id, object_key, payload_size, version, recording_ref, created_at, updated_at)
VALUES (gen_random_uuid(), $1::uuid, $2, $3, 1, $4, NOW(), NOW())
RETURNING id::text, user_id::text, object_key, payload_size, version, recording_ref, created_at, updated_at, deleted_at;

-- name: UpdateSyncNote :one
UPDATE sync_notes
SET object_key = $1, payload_size = $2, recording_ref = $3,
    version = version + 1, updated_at = CURRENT_TIMESTAMP
WHERE id::text = $4 AND user_id::text = $5 AND version = $6
RETURNING id::text, user_id::text, object_key, payload_size, version, recording_ref, created_at, updated_at, deleted_at;

-- name: GetSyncNote :one
SELECT id::text, user_id::text, object_key, payload_size, version, recording_ref, created_at, updated_at, deleted_at
FROM sync_notes
WHERE id::text = $1 AND user_id::text = $2;

-- name: SoftDeleteSyncNote :execrows
UPDATE sync_notes
SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, version = version + 1
WHERE id::text = $1 AND user_id::text = $2 AND deleted_at IS NULL;

-- name: CreateSyncRecording :one
INSERT INTO sync_recordings (id, user_id, object_key, size_bytes, content_nonce, meta, version, created_at, updated_at)
VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4, $5, 1, NOW(), NOW())
RETURNING id::text, user_id::text, object_key, size_bytes, content_nonce, meta, version, created_at, updated_at, deleted_at;

-- name: RecordingOwnedByUser :one
SELECT EXISTS(
  SELECT 1 FROM sync_recordings
  WHERE object_key = $1 AND user_id::text = $2
);

-- name: SoftDeleteSyncRecording :execrows
UPDATE sync_recordings
SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, version = version + 1
WHERE id::text = $1 AND user_id::text = $2 AND deleted_at IS NULL;

-- name: ListSyncNoteChanges :many
SELECT id::text, user_id::text, object_key, payload_size, version, recording_ref, created_at, updated_at, deleted_at
FROM sync_notes
WHERE user_id::text = $1 AND updated_at > $2
ORDER BY updated_at ASC
LIMIT $3;

-- name: ListSyncRecordingChanges :many
SELECT id::text, user_id::text, object_key, size_bytes, content_nonce, meta, version, created_at, updated_at, deleted_at
FROM sync_recordings
WHERE user_id::text = $1 AND updated_at > $2
ORDER BY updated_at ASC
LIMIT $3;

-- name: UpsertSyncCursor :exec
INSERT INTO sync_cursors (id, user_id, device_id, entity, cursor, updated_at)
VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, NOW())
ON CONFLICT (device_id, entity)
DO UPDATE SET cursor = $4, updated_at = CURRENT_TIMESTAMP;

-- name: GetSyncCursor :one
SELECT cursor
FROM sync_cursors
WHERE device_id::text = $1 AND entity = $2;
