-- Forums become the top-level workspace: each forum owns its own projects
-- (one board each) AND its own discussion threads. Threads stop belonging to a
-- board — `threads.board_id` is replaced by `threads.forum_id`; projects are
-- given a `forum_id` too. The single pre-existing instance forum is seeded from
-- the `forum_name` setting (or the default name).
--
-- Node 24's SQLite (>= 3.35) supports DROP COLUMN even over a foreign key, so no
-- full table rebuild is needed. forum_id is nullable + application-enforced
-- non-null, mirroring the `boards.project_id` precedent from 0004.

CREATE TABLE IF NOT EXISTS forums (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL UNIQUE,
  slug        TEXT    NOT NULL,
  description TEXT,
  created_by  INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT
);

-- Seed the one forum that every existing project/thread moves under.
INSERT INTO forums (name, slug, description)
  SELECT COALESCE((SELECT value FROM settings WHERE key = 'forum_name'), 'Agora'),
         'forum',
         'Default forum — seeded on migration.';

-- Projects belong to a forum.
ALTER TABLE projects ADD COLUMN forum_id INTEGER REFERENCES forums(id);
UPDATE projects SET forum_id = (SELECT id FROM forums ORDER BY id LIMIT 1);

-- Threads belong to a forum instead of a board.
ALTER TABLE threads ADD COLUMN forum_id INTEGER REFERENCES forums(id);
UPDATE threads SET forum_id = (SELECT id FROM forums ORDER BY id LIMIT 1);

DROP INDEX IF EXISTS idx_threads_board_updated;
DROP INDEX IF EXISTS idx_threads_board_status;
DROP INDEX IF EXISTS idx_threads_board_views;
DROP INDEX IF EXISTS idx_threads_board_votes;
ALTER TABLE threads DROP COLUMN board_id;

CREATE INDEX IF NOT EXISTS idx_threads_forum_updated ON threads (forum_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_threads_forum_status  ON threads (forum_id, status);
CREATE INDEX IF NOT EXISTS idx_threads_forum_views   ON threads (forum_id, views);
CREATE INDEX IF NOT EXISTS idx_threads_forum_votes   ON threads (forum_id, votes);
CREATE INDEX IF NOT EXISTS idx_projects_forum        ON projects (forum_id);
