-- Add nullable device_id to sessions so sessions can be tied to devices
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_id UUID NULL;

-- Optional FK to devices (if devices table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'devices') THEN
        BEGIN
            ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_device_id_fkey;
        EXCEPTION WHEN undefined_object THEN
            -- ignore
        END;
        BEGIN
            ALTER TABLE sessions ADD CONSTRAINT sessions_device_id_fkey FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL;
        EXCEPTION WHEN duplicate_object THEN
            -- ignore
        END;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sessions_device_id ON sessions(device_id);
