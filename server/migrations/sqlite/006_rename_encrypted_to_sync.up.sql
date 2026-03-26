-- Rename encrypted_notes -> sync_notes (SQLite supports ALTER TABLE ... RENAME TO)
ALTER TABLE encrypted_notes RENAME TO sync_notes;

-- For encrypted_recordings, rebuild the table to rename the encrypted_meta column -> meta
-- (SQLite does not support renaming columns directly in older versions)
ALTER TABLE encrypted_recordings RENAME TO sync_recordings;

CREATE TABLE sync_recordings_new (
    id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
    user_id TEXT NOT NULL,
    object_key TEXT UNIQUE NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    content_nonce BLOB NOT NULL,
    meta BLOB NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO sync_recordings_new (id, user_id, object_key, size_bytes, content_nonce, meta, version, created_at, updated_at, deleted_at)
    SELECT id, user_id, object_key, size_bytes, content_nonce, encrypted_meta, version, created_at, updated_at, deleted_at FROM sync_recordings;

DROP TABLE sync_recordings;
ALTER TABLE sync_recordings_new RENAME TO sync_recordings;

CREATE INDEX idx_sync_recordings_user_id ON sync_recordings(user_id);
CREATE INDEX idx_sync_recordings_updated_at ON sync_recordings(updated_at);
