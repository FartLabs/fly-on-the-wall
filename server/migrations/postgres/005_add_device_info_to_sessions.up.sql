-- Add device OS info columns to sessions
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_os TEXT NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_version TEXT NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_name TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_device_id ON sessions(device_id);
