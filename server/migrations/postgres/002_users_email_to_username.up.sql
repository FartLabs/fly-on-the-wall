DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
		  AND table_name = 'users'
		  AND column_name = 'email'
	) THEN
		ALTER TABLE users RENAME COLUMN email TO username;
	END IF;
END $$;
DROP INDEX IF EXISTS idx_users_email;
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
