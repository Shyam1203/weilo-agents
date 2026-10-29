-- Host fixes, round 3. Expand-only.

-- The event log is append-only for the app: it may add events, never change or remove
-- them. (Grants are also re-applied after every migration run, with the same rule.)
REVOKE UPDATE, DELETE, TRUNCATE ON events FROM weilo_app;

-- An approval's expiry job keeps trying until it works; a give-up would leave the card
-- waiting with nothing to close it.
UPDATE jobs SET max_attempts = 1000000 WHERE queue = 'approvals.expire';
