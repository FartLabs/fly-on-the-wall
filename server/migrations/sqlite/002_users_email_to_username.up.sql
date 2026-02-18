ALTER TABLE users RENAME COLUMN email TO username;
DROP INDEX IF EXISTS idx_users_email;
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
