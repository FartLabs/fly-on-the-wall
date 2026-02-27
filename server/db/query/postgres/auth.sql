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

-- name: CountUsers :one
SELECT count(*) FROM users;

-- name: ListUsers :many
SELECT id::text, username, is_premium, is_admin, created_at, updated_at
FROM users
ORDER BY created_at DESC
LIMIT $1 OFFSET $2;

-- name: UpdateUserPremium :exec
UPDATE users
SET is_premium = $1, updated_at = NOW()
WHERE id = $2::uuid;

-- name: UpdateUserAdmin :exec
UPDATE users
SET is_admin = $1, updated_at = NOW()
WHERE id = $2::uuid;

-- name: SetUserPremium :exec
UPDATE users
SET is_premium = $1, updated_at = NOW()
WHERE id = $2::uuid;

-- name: CreateSession :one
INSERT INTO sessions (id, user_id, token, device_id, device_os, device_version, device_name, expires_at, created_at)
VALUES (gen_random_uuid(), $1::uuid, $2, $3::uuid, $4, $5, $6, $7, NOW())
RETURNING id::text, user_id::text, token, device_id::text, device_os, device_version, device_name, expires_at, created_at;

-- name: GetSessionByToken :one
SELECT id::text, user_id::text, token, device_id::text, device_os, device_version, device_name, expires_at, created_at
FROM sessions
WHERE token = $1;

-- name: DeleteSessionByToken :exec
DELETE FROM sessions WHERE token = $1;

-- name: DeleteSessionByID :exec
DELETE FROM sessions WHERE id = $1::uuid AND user_id = $2::uuid;

-- name: DeleteSessionsByDeviceID :exec
DELETE FROM sessions WHERE device_id = $1::uuid;

-- name: DeleteExpiredSessions :execrows
DELETE FROM sessions WHERE expires_at < NOW();

-- name: ListSessionsByUser :many
SELECT id::text, user_id::text, token, device_id::text, device_os, device_version, device_name, expires_at, created_at
FROM sessions
WHERE user_id = $1::uuid AND expires_at > NOW()
ORDER BY created_at DESC;
