-- Release-1 fixes, round 2. Expand-only.

-- Bumped each time an agent's instructions change. A thread remembers the revision it
-- last told its engine, so changed instructions reach conversations already under way.
ALTER TABLE agents ADD COLUMN instructions_rev bigint NOT NULL DEFAULT 0;
ALTER TABLE threads ADD COLUMN instructions_rev_sent bigint;
