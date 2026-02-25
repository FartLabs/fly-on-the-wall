CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_premium INTEGER NOT NULL,
    is_admin INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    device_id TEXT NULL,
    device_os TEXT NULL,
    device_version TEXT NULL,
    device_name TEXT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);
