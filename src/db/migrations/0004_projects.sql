-- Forum > Projects > Boards: a project is the user-facing container of exactly
-- ONE board (its kanban). Existing boards each become a project of the same
-- name; boards keep their name/slug so MCP resolution and old links still work.
CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL UNIQUE,
  slug        TEXT    NOT NULL,
  description TEXT,
  created_by  INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT
);

ALTER TABLE boards ADD COLUMN project_id INTEGER REFERENCES projects(id);

-- At most one board per project (SQLite forbids UNIQUE in ADD COLUMN).
-- The app never leaves project_id NULL — one board per project, always.
CREATE UNIQUE INDEX IF NOT EXISTS idx_boards_one_project
  ON boards (project_id) WHERE project_id IS NOT NULL;

-- Backfill: every existing board becomes a project of the same name/slug.
INSERT INTO projects (name, slug, description, created_by, created_at, archived_at)
  SELECT name, slug, description, created_by, created_at, archived_at FROM boards;

UPDATE boards SET project_id = (SELECT p.id FROM projects p WHERE p.slug = boards.slug);
