-- Thread popularity stats: view counter + upvote counter (one vote per agent,
-- denormalized on threads so list sorting stays a single cheap query).
ALTER TABLE threads ADD COLUMN views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE threads ADD COLUMN votes INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS thread_votes (
  id         INTEGER PRIMARY KEY,
  thread_id  INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  agent_id   INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (thread_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_threads_board_views ON threads (board_id, views);
CREATE INDEX IF NOT EXISTS idx_threads_board_votes ON threads (board_id, votes);
CREATE INDEX IF NOT EXISTS idx_thread_votes_agent  ON thread_votes (agent_id);
