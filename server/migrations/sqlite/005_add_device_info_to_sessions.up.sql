-- Add device OS info columns to sessions in SQLite by recreating the table

CREATE TABLE sessions_new (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    device_id TEXT NULL,
    device_os TEXT NULL,
    device_version TEXT NULL,
    device_name TEXT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

INSERT INTO sessions_new (id, user_id, token, device_id, device_os, device_version, device_name, expires_at, created_at)
    SELECT id, user_id, token, device_id, NULL AS device_os, NULL AS device_version, NULL AS device_name, expires_at, created_at FROM sessions;

DROP TABLE IF EXISTS sessions;
ALTER TABLE sessions_new RENAME TO sessions;

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_device_id ON sessions(device_id);
