CREATE TABLE devices (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    device_name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    wrapped_user_key TEXT NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE encrypted_notes (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    object_key TEXT NOT NULL,
    payload_size BIGINT NOT NULL,
    version INTEGER NOT NULL,
    recording_ref TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ
);

CREATE TABLE encrypted_recordings (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    object_key TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    content_nonce BYTEA NOT NULL,
    encrypted_meta BYTEA NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ
);

CREATE TABLE sync_cursors (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    device_id UUID NOT NULL,
    entity TEXT NOT NULL,
    cursor TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
