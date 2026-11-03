-- Host fixes, round 4. Expand-only.

-- The runner names each event it writes before trying, so an event whose commit
-- succeeded but whose reply was lost (Postgres went away) isn't written twice when it
-- is tried again. Older events have none.
ALTER TABLE events ADD COLUMN event_id uuid;
CREATE UNIQUE INDEX events_thread_event_id ON events (thread_id, event_id)
    WHERE event_id IS NOT NULL;
