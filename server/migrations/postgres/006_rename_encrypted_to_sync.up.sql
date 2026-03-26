-- Rename encrypted_notes -> sync_notes
ALTER TABLE encrypted_notes RENAME TO sync_notes;
ALTER INDEX idx_encrypted_notes_user_id RENAME TO idx_sync_notes_user_id;
ALTER INDEX idx_encrypted_notes_updated_at RENAME TO idx_sync_notes_updated_at;
ALTER INDEX idx_encrypted_notes_user_updated RENAME TO idx_sync_notes_user_updated;

-- Rename encrypted_recordings -> sync_recordings and drop legacy encryption column names
ALTER TABLE encrypted_recordings RENAME TO sync_recordings;
ALTER TABLE sync_recordings RENAME COLUMN encrypted_meta TO meta;
ALTER INDEX idx_encrypted_recordings_user_id RENAME TO idx_sync_recordings_user_id;
ALTER INDEX idx_encrypted_recordings_updated_at RENAME TO idx_sync_recordings_updated_at;
