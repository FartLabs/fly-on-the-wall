-- Add device_id column to sessions in SQLite by recreating the table (safe across SQLite versions)

CREATE TABLE sessions_new (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    device_id TEXT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

INSERT INTO sessions_new (id, user_id, token, device_id, expires_at, created_at)
    SELECT id, user_id, token, NULL AS device_id, expires_at, created_at FROM sessions;

DROP TABLE IF EXISTS sessions;
ALTER TABLE sessions_new RENAME TO sessions;

-- Recreate indexes/constraints (token uniqueness is part of table definition above)
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
