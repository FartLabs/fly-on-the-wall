-- name: CreateUser :one
INSERT INTO users (id, username, password_hash, is_premium, is_admin, created_at, updated_at)
VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), ?, ?, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
RETURNING id, username, password_hash, is_premium, is_admin, created_at, updated_at;

-- name: CreateUserAdmin :one
INSERT INTO users (id, username, password_hash, is_premium, is_admin, created_at, updated_at)
VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), ?, ?, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
RETURNING id, username, password_hash, is_premium, is_admin, created_at, updated_at;

-- name: GetUserByUsername :one
SELECT id, username, password_hash, is_premium, is_admin, created_at, updated_at
FROM users
WHERE username = ?;

-- name: GetUserByID :one
SELECT id, username, password_hash, is_premium, is_admin, created_at, updated_at
FROM users
WHERE id = ?;

-- name: CountAdmins :one
SELECT count(*) FROM users WHERE is_admin = 1;

-- name: SetUserPremium :exec
UPDATE users
SET is_premium = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?;

-- name: CreateSession :one
INSERT INTO sessions (id, user_id, token, device_id, expires_at, created_at)
VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), ?, ?, ?, ?, CURRENT_TIMESTAMP)
RETURNING id, user_id, token, device_id, expires_at, created_at;

-- name: GetSessionByToken :one
SELECT id, user_id, token, device_id, expires_at, created_at
FROM sessions
WHERE token = ?;

-- name: DeleteSessionByToken :exec
DELETE FROM sessions WHERE token = ?;

-- name: DeleteSessionByID :exec
DELETE FROM sessions WHERE id = ? AND user_id = ?;

-- name: DeleteSessionsByDeviceID :exec
DELETE FROM sessions WHERE device_id = ?;

-- name: DeleteExpiredSessions :execrows
DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP;

-- name: ListSessionsByUser :many
SELECT id, user_id, token, device_id, expires_at, created_at
FROM sessions
WHERE user_id = ? AND expires_at > CURRENT_TIMESTAMP
ORDER BY created_at DESC;
