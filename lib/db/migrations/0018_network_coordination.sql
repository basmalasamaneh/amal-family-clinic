-- Applied transactionally by the targeted operator runner (no nested COMMIT).
SELECT pg_advisory_xact_lock_shared(761930);
SELECT pg_advisory_xact_lock(160005);
CREATE TABLE IF NOT EXISTS operational.network_coordinator_scope (
  user_id integer NOT NULL REFERENCES operational.users(id),
  clinic_id integer NOT NULL REFERENCES operational.clinics(clinic_id),
  granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(user_id,clinic_id)
);
REVOKE ALL ON operational.network_coordinator_scope FROM PUBLIC,amal_app;
GRANT SELECT ON operational.network_coordinator_scope TO amal_app;
GRANT SELECT,DELETE ON operational.network_coordinator_scope TO amal_demo_reset;
