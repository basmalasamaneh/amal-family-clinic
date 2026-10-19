-- Auth-only additions. Never access seed objects.
BEGIN;
CREATE TABLE IF NOT EXISTS operational.auth_devices (
 device_id integer PRIMARY KEY REFERENCES operational.devices(id) ON DELETE CASCADE,
 credential_digest text UNIQUE NOT NULL,
 revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS operational.auth_sessions (
 token_digest text PRIMARY KEY,
 user_id integer NOT NULL REFERENCES operational.users(id) ON DELETE CASCADE,
 device_id integer REFERENCES operational.devices(id) ON DELETE CASCADE,
 csrf_token text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(),
 absolute_expires_at timestamptz,
 pin_verified_at timestamptz,
 revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON operational.auth_sessions(user_id);
CREATE TABLE IF NOT EXISTS operational.auth_pin_state (
 user_id integer PRIMARY KEY REFERENCES operational.users(id) ON DELETE CASCADE,
 failures integer NOT NULL DEFAULT 0,
 locked_until timestamptz
);
CREATE TABLE IF NOT EXISTS operational.auth_throttles (
 key_digest text PRIMARY KEY,
 window_started_at timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE, DELETE ON operational.auth_devices,
 operational.auth_sessions, operational.auth_pin_state, operational.auth_throttles TO amal_app;
COMMIT;
