-- Administration additions only. The six source/seed tables remain untouched.
BEGIN;
ALTER TABLE operational.users ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
ALTER TABLE operational.users ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_ci_unique ON operational.users(lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS doctors_email_ci_unique ON operational.doctors(lower(email));
CREATE INDEX IF NOT EXISTS users_admin_listing_idx ON operational.users(clinic_id, id);
CREATE INDEX IF NOT EXISTS devices_admin_listing_idx ON operational.devices(clinic_id, id);

-- Covers administrative changes through either management surface. Login's
-- last_login update does not change credential generation or revoke sessions.
CREATE OR REPLACE FUNCTION operational.invalidate_changed_user_auth() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF ROW(OLD.email,OLD.role,OLD.clinic_id,OLD.doctor_id,OLD.password_hash,OLD.pin_hash,OLD.disabled_at)
    IS DISTINCT FROM
    ROW(NEW.email,NEW.role,NEW.clinic_id,NEW.doctor_id,NEW.password_hash,NEW.pin_hash,NEW.disabled_at) THEN
    NEW.auth_version := OLD.auth_version + 1;
    UPDATE operational.auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=OLD.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS users_invalidate_auth ON operational.users;
CREATE TRIGGER users_invalidate_auth BEFORE UPDATE ON operational.users
  FOR EACH ROW EXECUTE FUNCTION operational.invalidate_changed_user_auth();
REVOKE ALL ON FUNCTION operational.invalidate_changed_user_auth() FROM PUBLIC;
-- Explicitly retain the append-only application boundary.
REVOKE UPDATE, DELETE, TRUNCATE ON operational.audit_log FROM amal_app;
GRANT SELECT, INSERT ON operational.audit_log TO amal_app;
COMMIT;
