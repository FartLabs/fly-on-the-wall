-- Remove display_name from users
ALTER TABLE users DROP COLUMN IF EXISTS display_name;

-- Migrate encrypted_notes from inline blob to object-store-backed
ALTER TABLE encrypted_notes ADD COLUMN IF NOT EXISTS object_key TEXT;
ALTER TABLE encrypted_notes ADD COLUMN IF NOT EXISTS payload_size BIGINT;

-- Set defaults for any existing rows (they will need backfill)
UPDATE encrypted_notes SET object_key = '' WHERE object_key IS NULL;
UPDATE encrypted_notes SET payload_size = 0 WHERE payload_size IS NULL;

-- Make columns NOT NULL after backfill defaults
ALTER TABLE encrypted_notes ALTER COLUMN object_key SET NOT NULL;
ALTER TABLE encrypted_notes ALTER COLUMN object_key SET DEFAULT '';
ALTER TABLE encrypted_notes ALTER COLUMN payload_size SET NOT NULL;
ALTER TABLE encrypted_notes ALTER COLUMN payload_size SET DEFAULT 0;

-- Drop the old inline payload columns
ALTER TABLE encrypted_notes DROP COLUMN IF EXISTS encrypted_content;
ALTER TABLE encrypted_notes DROP COLUMN IF EXISTS content_nonce;
