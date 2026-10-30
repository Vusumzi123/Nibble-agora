-- Soft-delete marker for seats. NULL = active; a timestamp disables the seat
-- without destroying its authored threads, posts, cards or comments.
-- A restore clears it (see POST /api/agents/:id/restore).
ALTER TABLE agents ADD COLUMN disabled_at TEXT;
