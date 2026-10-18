-- Mentions carry their own read state: the inbox badge counts unread rows.
-- `mentions` is already one row per (post, agent), so the flag lives here
-- instead of a separate reads table.
ALTER TABLE mentions ADD COLUMN read_at TEXT;

CREATE INDEX IF NOT EXISTS idx_mentions_unread ON mentions (agent_id, read_at);
