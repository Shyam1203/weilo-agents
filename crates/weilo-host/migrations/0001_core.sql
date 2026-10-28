-- Release-1 core schema. Expand-only: later migrations add, never rename or drop.
-- Ids are UUID v7, made by the host.

CREATE TABLE settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE spaces (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
    id uuid PRIMARY KEY,
    space_id uuid NOT NULL REFERENCES spaces (id),
    name text NOT NULL,
    token_hash bytea NOT NULL UNIQUE,
    paired_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz,
    revoked_at timestamptz
);

CREATE TABLE agents (
    id uuid PRIMARY KEY,
    space_id uuid NOT NULL REFERENCES spaces (id),
    name text NOT NULL,
    slug text NOT NULL,
    color text NOT NULL,
    engine text NOT NULL,
    model text,
    instructions text,
    main_thread_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    stopped_at timestamptz,
    UNIQUE (space_id, slug)
);

CREATE TABLE channels (
    id uuid PRIMARY KEY,
    space_id uuid NOT NULL REFERENCES spaces (id),
    slug text NOT NULL,
    title text NOT NULL,
    archived_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (space_id, slug)
);

CREATE TABLE threads (
    id uuid PRIMARY KEY,
    space_id uuid NOT NULL REFERENCES spaces (id),
    kind text NOT NULL CHECK (kind IN ('agent', 'chat', 'session')),
    channel_id uuid REFERENCES channels (id),
    agent_id uuid REFERENCES agents (id),
    owner_host uuid NOT NULL,
    owner_epoch bigint NOT NULL,
    last_seq bigint NOT NULL DEFAULT 0,
    title text NOT NULL,
    state text NOT NULL DEFAULT 'idle' CHECK (state IN ('idle', 'working', 'needs_you')),
    live_line text NOT NULL DEFAULT '',
    engine text,
    folder text,
    engine_session_id text,
    worktree text,
    started_by text,
    tainted boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
) WITH (fillfactor = 70);

CREATE INDEX threads_channel ON threads (channel_id);
CREATE INDEX threads_agent ON threads (agent_id);

ALTER TABLE agents ADD CONSTRAINT agents_main_thread
    FOREIGN KEY (main_thread_id) REFERENCES threads (id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE events (
    thread_id uuid NOT NULL REFERENCES threads (id),
    seq bigint NOT NULL,
    space_id uuid NOT NULL REFERENCES spaces (id),
    actor_id uuid,
    source text NOT NULL,
    tainted boolean NOT NULL DEFAULT false,
    kind text NOT NULL,
    body jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (thread_id, seq)
);

CREATE TABLE call_results (
    device_id uuid NOT NULL REFERENCES devices (id),
    call_id uuid NOT NULL,
    result jsonb NOT NULL,
    at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (device_id, call_id)
);

-- Follows Graphile Worker's design: lease with locked_by/locked_until, claim with SKIP LOCKED.
CREATE TABLE jobs (
    id uuid PRIMARY KEY,
    space_id uuid REFERENCES spaces (id),
    queue text NOT NULL,
    job_key text UNIQUE,
    run_at timestamptz NOT NULL DEFAULT now(),
    attempts int NOT NULL DEFAULT 0,
    max_attempts int NOT NULL DEFAULT 5,
    locked_by text,
    locked_until timestamptz,
    payload jsonb NOT NULL DEFAULT '{}',
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX jobs_due ON jobs (run_at) WHERE attempts < max_attempts;

CREATE TABLE approvals (
    id uuid PRIMARY KEY,
    space_id uuid NOT NULL REFERENCES spaces (id),
    thread_id uuid NOT NULL REFERENCES threads (id),
    seq bigint NOT NULL,
    class text NOT NULL,
    agent_id uuid REFERENCES agents (id),
    tool text NOT NULL DEFAULT '',
    -- What "Always allow" covers, like `folder:/path/to/repo`.
    scope text NOT NULL DEFAULT '',
    state text NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'allowed', 'denied', 'expired')),
    card jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
    decided_by_device uuid REFERENCES devices (id),
    decided_via text,
    decided_at timestamptz
);

CREATE INDEX approvals_pending ON approvals (expires_at) WHERE state = 'pending';

CREATE TABLE allow_rules (
    id uuid PRIMARY KEY,
    space_id uuid NOT NULL REFERENCES spaces (id),
    agent_id uuid REFERENCES agents (id),
    tool text NOT NULL,
    scope text NOT NULL,
    created_by_device uuid REFERENCES devices (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz
);

CREATE TABLE ui_prefs (
    device_id uuid PRIMARY KEY REFERENCES devices (id),
    prefs jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_head (
    space_id uuid PRIMARY KEY REFERENCES spaces (id),
    seq bigint NOT NULL,
    hash bytea NOT NULL
);

CREATE TABLE audit (
    space_id uuid NOT NULL REFERENCES spaces (id),
    seq bigint NOT NULL,
    at timestamptz NOT NULL,
    actor text NOT NULL,
    device_id uuid,
    action text NOT NULL,
    detail jsonb NOT NULL,
    prev_hash bytea NOT NULL,
    hash bytea NOT NULL,
    PRIMARY KEY (space_id, seq)
);

CREATE TABLE projector_cursors (
    projection text NOT NULL,
    thread_id uuid NOT NULL REFERENCES threads (id),
    seq bigint NOT NULL,
    PRIMARY KEY (projection, thread_id)
);
