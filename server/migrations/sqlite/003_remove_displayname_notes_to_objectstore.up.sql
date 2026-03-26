-- SQLite does not support DROP COLUMN before 3.35.0, so we recreate
-- the users table without display_name and encrypted_notes with object_key

-- 1. Recreate users without display_name
CREATE TABLE users_new (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_premium INTEGER NOT NULL DEFAULT 0,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO users_new (id, username, password_hash, is_premium, is_admin, created_at, updated_at)
    SELECT id, username, password_hash, is_premium, is_admin, created_at, updated_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE UNIQUE INDEX idx_users_username ON users(username);

-- 2. Recreate encrypted_notes with object_key instead of encrypted_content/content_nonce
CREATE TABLE encrypted_notes_new (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
    user_id TEXT NOT NULL,
    object_key TEXT NOT NULL DEFAULT '',
    payload_size INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    recording_ref TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
INSERT INTO encrypted_notes_new (id, user_id, object_key, payload_size, version, recording_ref, created_at, updated_at, deleted_at)
    SELECT id, user_id, '', 0, version, recording_ref, created_at, updated_at, deleted_at FROM encrypted_notes;
DROP TABLE encrypted_notes;
ALTER TABLE encrypted_notes_new RENAME TO encrypted_notes;
CREATE INDEX idx_encrypted_notes_user_id ON encrypted_notes(user_id);
CREATE INDEX idx_encrypted_notes_updated_at ON encrypted_notes(updated_at);
CREATE INDEX idx_encrypted_notes_user_updated ON encrypted_notes(user_id, updated_at);
