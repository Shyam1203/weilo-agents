-- Release-1 fixes. Expand-only.

-- A call that changes something is marked running before it starts, so a retry after
-- a crash answers "unknown" instead of doing it twice.
ALTER TABLE call_results ADD COLUMN running boolean NOT NULL DEFAULT false;
CREATE INDEX call_results_at ON call_results (at);

-- Finished jobs are pruned after 30 days.
ALTER TABLE jobs ADD COLUMN finished_at timestamptz;
CREATE INDEX jobs_finished ON jobs (finished_at) WHERE finished_at IS NOT NULL;
