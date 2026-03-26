-- name: CreateJob :one
INSERT INTO jobs (id, user_id, type, status, input_ref, output_ref, error, worker_id, created_at, updated_at)
VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), ?, ?, 'pending', ?, '', '', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
RETURNING id, user_id, type, status, input_ref, output_ref, error, worker_id, created_at, updated_at, started_at, finished_at;

-- name: GetJobByIDForUser :one
SELECT id, user_id, type, status, input_ref, output_ref, error, worker_id, created_at, updated_at, started_at, finished_at
FROM jobs
WHERE id = ? AND user_id = ?;

-- name: ListJobsByUser :many
SELECT id, user_id, type, status, input_ref, output_ref, error, worker_id, created_at, updated_at, started_at, finished_at
FROM jobs
WHERE user_id = ?
ORDER BY created_at DESC
LIMIT 50;

-- name: ListJobsByUserAndType :many
SELECT id, user_id, type, status, input_ref, output_ref, error, worker_id, created_at, updated_at, started_at, finished_at
FROM jobs
WHERE user_id = ? AND type = ?
ORDER BY created_at DESC
LIMIT 50;

-- name: UpdateJobStatus :exec
UPDATE jobs
SET status = ?, output_ref = ?, error = ?,
    started_at = COALESCE(?, started_at),
    finished_at = COALESCE(?, finished_at),
    updated_at = CURRENT_TIMESTAMP
WHERE id = ?;
