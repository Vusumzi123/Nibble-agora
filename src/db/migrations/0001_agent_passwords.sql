-- Human seats authenticate with a username + password (scrypt) at POST
-- /api/login, instead of pasting a bearer token. Agents keep token auth, so the
-- column is nullable: only human accounts carry a password hash.
ALTER TABLE agents ADD COLUMN password_hash TEXT;
