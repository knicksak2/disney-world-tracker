BEGIN;

-- password_reset_tokens: stores transient verification codes and URL reset tokens.
-- Plaintext values are never persisted: code_hash is SHA-256 of 6-digit code,
-- token_hash is SHA-256 of web URL token.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash           TEXT         NOT NULL,
    token_hash          TEXT         NOT NULL UNIQUE,
    attempts            INTEGER      NOT NULL DEFAULT 0,
    expires_at          TIMESTAMPTZ  NOT NULL,
    used_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT password_reset_tokens_attempts_nonnegative CHECK (attempts >= 0)
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS password_reset_tokens_code_hash_idx ON password_reset_tokens(code_hash);
CREATE INDEX IF NOT EXISTS password_reset_tokens_token_hash_idx ON password_reset_tokens(token_hash);

COMMIT;
