-- Dismissing a mention clears the notification without removing the mention:
-- the inbox hides the row, but the post keeps its pill.
ALTER TABLE mentions ADD COLUMN dismissed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_mentions_dismissed ON mentions (agent_id, dismissed_at);
