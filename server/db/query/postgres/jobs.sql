-- name: CreateJob :one
INSERT INTO jobs (id, user_id, type, status, input_ref, output_ref, error, worker_id, created_at, updated_at)
VALUES (gen_random_uuid(), $1::uuid, $2, 'pending', $3, '', '', '', NOW(), NOW())
RETURNING id::text, user_id::text, type, status, input_ref, output_ref, error, worker_id, created_at, updated_at, started_at, finished_at;

-- name: GetJobByIDForUser :one
SELECT id::text, user_id::text, type, status, input_ref, output_ref, error, worker_id, created_at, updated_at, started_at, finished_at
FROM jobs
WHERE id::text = $1 AND user_id::text = $2;

-- name: ListJobsByUser :many
SELECT id::text, user_id::text, type, status, input_ref, output_ref, error, worker_id, created_at, updated_at, started_at, finished_at
FROM jobs
WHERE user_id::text = $1
ORDER BY created_at DESC
LIMIT 50;

-- name: ListJobsByUserAndType :many
SELECT id::text, user_id::text, type, status, input_ref, output_ref, error, worker_id, created_at, updated_at, started_at, finished_at
FROM jobs
WHERE user_id::text = $1 AND type = $2
ORDER BY created_at DESC
LIMIT 50;

-- name: UpdateJobStatus :exec
UPDATE jobs
SET status = $1, output_ref = $2, error = $3,
    started_at = COALESCE($4, started_at),
    finished_at = COALESCE($5, finished_at),
    updated_at = CURRENT_TIMESTAMP
WHERE id::text = $6;
