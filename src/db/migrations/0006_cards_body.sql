-- Cards carry their own text; threads are not cards' business anymore.
--
-- 1. `description` becomes `body` (it is card content, not metadata).
-- 2. The card <-> thread bridge goes away entirely: no `cards.thread_id`,
--    no /link endpoints, no forum-home project_name that was derived through
--    this column. Threads and projects are separate things.

ALTER TABLE cards RENAME COLUMN description TO body;
ALTER TABLE cards DROP COLUMN thread_id;
