-- Cards gain a blocked marker and a discussion thread of their own.
ALTER TABLE cards ADD COLUMN blocked_at TEXT;

CREATE TABLE IF NOT EXISTS card_comments (
  id         INTEGER PRIMARY KEY,
  card_id    INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES agents(id),
  body       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_card_comments_card ON card_comments (card_id, created_at);
