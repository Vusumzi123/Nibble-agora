-- Project cards in the Boards view become drag-reorderable. Positions are
-- 0-based and dense per database; new projects append at the end.
ALTER TABLE projects ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

UPDATE projects
   SET position = (SELECT COUNT(*) FROM projects p WHERE p.id < projects.id);
