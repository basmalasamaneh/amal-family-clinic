-- Installed only by an operator; no schema drops and no seed DDL/DML.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='amal_reset_login') THEN
   CREATE ROLE amal_reset_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
 END IF;
END $$;
ALTER ROLE amal_reset_login LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
-- Reuse amal_app's existing seed SELECT permission without modifying any seed
-- ACL/owner/schema. Membership is one-way: amal_app cannot assume reset.
GRANT amal_app,amal_demo_reset TO amal_reset_login;
REVOKE CREATE ON SCHEMA public FROM amal_reset_login;
GRANT USAGE ON SCHEMA public, operational, operational_meta TO amal_reset_login;
CREATE TABLE IF NOT EXISTS operational_meta.demo_state (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 generation uuid NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO operational_meta.demo_state(singleton,generation) VALUES(true,gen_random_uuid()) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS operational_meta.demo_reset_receipts (
 request_id uuid PRIMARY KEY,
 previous_generation uuid NOT NULL,
 generation uuid NOT NULL,
 completed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS operational.developer_outages (
 clinic_id integer PRIMARY KEY REFERENCES operational.clinics(clinic_id),
 enabled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 enabled_by integer
);
GRANT USAGE ON SCHEMA operational_meta TO amal_app;
GRANT SELECT ON operational_meta.demo_state,operational_meta.demo_reset_receipts TO amal_app;
GRANT SELECT,UPDATE ON operational_meta.demo_state TO amal_reset_login;
GRANT SELECT,INSERT ON operational_meta.demo_reset_receipts TO amal_reset_login;
GRANT SELECT,INSERT,DELETE ON operational.developer_outages TO amal_app;

-- Explicit operational allowlist. Unexpected future tables fail reset closed
-- through their foreign keys rather than being wiped through CASCADE.
GRANT SELECT,INSERT,UPDATE,DELETE ON
 operational.clinics,operational.doctors,operational.users,operational.devices,
 operational.patients,operational.appointments,operational.patient_visit_history,
 operational.patient_consents,operational.visit_alerts,operational.audit_log,
 operational.sync_operations,operational.import_batches,operational.import_rows,
 operational.patient_merge_candidates,operational.notifications,operational.kpi_snapshots,
 operational.auth_devices,operational.auth_sessions,operational.auth_pin_state,operational.auth_throttles,
 operational.appointment_operations,operational.appointment_holds,
 operational.patient_clinic_access,operational.patient_create_receipts,operational.patient_doctor_access,
 operational.consent_operations,operational.import_source_links,operational.import_operations,operational.import_reviews,
 operational.patient_merge_operations,operational.patient_merge_moves,
 operational.sync_device_operations,operational.sync_conflicts,operational.sync_resolution_history,
 operational.sync_changes,operational.device_network_health,operational.clinic_managers,
 operational.developer_outages TO amal_reset_login;
GRANT SELECT,DELETE ON
 operational.auth_devices,operational.auth_sessions,operational.auth_pin_state,operational.auth_throttles,
 operational.patient_doctor_access,operational.consent_operations,operational.import_source_links,
 operational.import_operations,operational.import_reviews,operational.device_network_health,
 operational.clinic_managers,operational.developer_outages TO amal_demo_reset;
GRANT UPDATE ON operational.clinics TO amal_demo_reset;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA operational TO amal_reset_login;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA operational TO amal_reset_login;

-- Sequence RESTART is transactional, unlike setval. The login cannot own or
-- ALTER objects. This no-argument helper can only advance five known sequences.
CREATE OR REPLACE FUNCTION operational_meta.advance_demo_sequences() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE names text[][] := ARRAY[
 ['clinics','clinic_id'],['doctors','doctor_id'],['patients','patient_id'],
 ['appointments','appointment_id'],['patient_visit_history','visit_id']];
 pair text[]; sequence_name text; last_id bigint; called boolean; max_id bigint;
BEGIN
 FOREACH pair SLICE 1 IN ARRAY names LOOP
  sequence_name := pg_get_serial_sequence('operational.'||pair[1],pair[2]);
  EXECUTE format('SELECT last_value,is_called FROM %s',sequence_name) INTO last_id,called;
  EXECUTE format('SELECT coalesce(max(%I),0) FROM operational.%I',pair[2],pair[1]) INTO max_id;
  EXECUTE format('ALTER SEQUENCE %s RESTART WITH %s',sequence_name,
    greatest(max_id+1,last_id+CASE WHEN called THEN 1 ELSE 0 END));
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION operational_meta.advance_demo_sequences() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operational_meta.advance_demo_sequences() TO amal_reset_login;
