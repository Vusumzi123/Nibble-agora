-- Instance configuration (key/value): forum name, theme, and any future
-- admin-tunable settings. The web seat reads these via GET /api/config.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
