BEGIN;

-- sampling_runs: Persists the execution outcome of each Sampling_Pass (admin-panel R7.1).
-- Records timing, outcome status, error message (if any), metrics counts, and a JSONB
-- sample of unmapped live entities.
CREATE TABLE sampling_runs (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at                  TIMESTAMPTZ NOT NULL,
    completed_at                TIMESTAMPTZ NOT NULL,
    outcome                     TEXT        NOT NULL,
    error_message               TEXT,
    parks_sampled_count         INTEGER     NOT NULL DEFAULT 0,
    experiences_mapped_count    INTEGER     NOT NULL DEFAULT 0,
    wait_samples_recorded_count INTEGER     NOT NULL DEFAULT 0,
    unmapped_with_wait_count    INTEGER     NOT NULL DEFAULT 0,
    unmapped_sample             JSONB,
    CONSTRAINT sampling_runs_outcome_chk CHECK (outcome IN ('success', 'failed'))
);

CREATE INDEX sampling_runs_started_at_idx ON sampling_runs(started_at DESC);

-- push_delivery_log: Persists per-token delivery outcomes from Notification_Service (admin-panel R10.1).
CREATE TABLE push_delivery_log (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id            UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status             TEXT        NOT NULL,
    notification_kind  TEXT        NOT NULL,
    CONSTRAINT push_delivery_log_status_chk
        CHECK (status IN ('ok', 'device_unregistered', 'error')),
    CONSTRAINT push_delivery_log_kind_chk
        CHECK (notification_kind IN (
            'share_delivered', 'friend_request_received', 'trip_invite_created',
            'rode_with_tag_created', 'food_list_shared', 'food_list_role_changed',
            'experience_list_shared', 'experience_list_role_changed'
        ))
);

CREATE INDEX push_delivery_log_occurred_at_idx ON push_delivery_log(occurred_at DESC);
CREATE INDEX push_delivery_log_user_id_idx ON push_delivery_log(user_id);

COMMIT;
