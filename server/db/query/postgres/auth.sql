-- name: CreateUser :one
INSERT INTO users (id, username, password_hash, is_premium, is_admin, created_at, updated_at)
VALUES (gen_random_uuid(), $1, $2, FALSE, FALSE, NOW(), NOW())
RETURNING id::text, username, password_hash, is_premium, is_admin, created_at, updated_at;

-- name: CreateUserAdmin :one
INSERT INTO users (id, username, password_hash, is_premium, is_admin, created_at, updated_at)
VALUES (gen_random_uuid(), $1, $2, FALSE, TRUE, NOW(), NOW())
RETURNING id::text, username, password_hash, is_premium, is_admin, created_at, updated_at;

-- name: GetUserByUsername :one
SELECT id::text, username, password_hash, is_premium, is_admin, created_at, updated_at
FROM users
WHERE username = $1;

-- name: GetUserByID :one
SELECT id::text, username, password_hash, is_premium, is_admin, created_at, updated_at
FROM users
WHERE id = $1::uuid;

-- name: CountAdmins :one
SELECT count(*) FROM users WHERE is_admin = TRUE;

-- name: SetUserPremium :exec
UPDATE users
SET is_premium = $1, updated_at = NOW()
WHERE id = $2::uuid;

-- name: CreateSession :one
INSERT INTO sessions (id, user_id, token, expires_at, created_at)
VALUES (gen_random_uuid(), $1::uuid, $2, $3, NOW())
RETURNING id::text, user_id::text, token, expires_at, created_at;

-- name: GetSessionByToken :one
SELECT id::text, user_id::text, token, expires_at, created_at
FROM sessions
WHERE token = $1;

-- name: DeleteSessionByToken :exec
DELETE FROM sessions WHERE token = $1;

-- name: DeleteSessionByID :exec
DELETE FROM sessions WHERE id = $1::uuid;

-- name: DeleteExpiredSessions :execrows
DELETE FROM sessions WHERE expires_at < NOW();
