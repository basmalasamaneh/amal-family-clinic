BEGIN;
-- Trusted doctor links are provisioned from immutable source identities only.
-- New local patients need an explicit, independently verified doctor assignment.
CREATE TABLE IF NOT EXISTS operational.patient_doctor_access (
  patient_id integer NOT NULL REFERENCES operational.patients(patient_id) ON DELETE CASCADE,
  clinic_id integer NOT NULL REFERENCES operational.clinics(clinic_id),
  doctor_id integer NOT NULL,
  PRIMARY KEY(patient_id,clinic_id,doctor_id),
  FOREIGN KEY(doctor_id,clinic_id) REFERENCES operational.doctors(doctor_id,clinic_id) ON DELETE CASCADE
);
-- These authorization links are dependent metadata, not retained clinical/audit
-- history. Existing privileged parent cleanup must not leave orphaned links.
ALTER TABLE operational.patient_doctor_access DROP CONSTRAINT patient_doctor_access_patient_id_fkey;
ALTER TABLE operational.patient_doctor_access ADD CONSTRAINT patient_doctor_access_patient_id_fkey
  FOREIGN KEY(patient_id) REFERENCES operational.patients(patient_id) ON DELETE CASCADE;
ALTER TABLE operational.patient_doctor_access DROP CONSTRAINT patient_doctor_access_doctor_id_clinic_id_fkey;
ALTER TABLE operational.patient_doctor_access ADD CONSTRAINT patient_doctor_access_doctor_id_clinic_id_fkey
  FOREIGN KEY(doctor_id,clinic_id) REFERENCES operational.doctors(doctor_id,clinic_id) ON DELETE CASCADE;
INSERT INTO operational.patient_doctor_access(patient_id,clinic_id,doctor_id)
SELECT source.patient_id,source.clinic_id,source.doctor_id FROM (
  SELECT patient_id,clinic_id,doctor_id FROM public.appointments
  UNION SELECT patient_id,clinic_id,doctor_id FROM public.patient_visit_history
) source
JOIN operational.patients p ON p.patient_id=source.patient_id
JOIN operational.doctors d ON d.doctor_id=source.doctor_id AND d.clinic_id=source.clinic_id
ON CONFLICT DO NOTHING;
GRANT SELECT ON operational.patient_doctor_access TO amal_app;

ALTER TABLE operational.patient_consents ADD COLUMN IF NOT EXISTS recorded_clinic_id integer REFERENCES operational.clinics(clinic_id);
ALTER TABLE operational.patient_consents ADD COLUMN IF NOT EXISTS evidence text CHECK(evidence IN ('signed','verbal'));
-- Legacy attribution is a one-time migration, never a history rewrite on rerun.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid='operational.patient_consents'::regclass
      AND tgname='consent_history_immutable' AND NOT tgisinternal
  ) THEN
    UPDATE operational.patient_consents c SET recorded_clinic_id=u.clinic_id
    FROM operational.users u
    WHERE c.recorded_by_user=u.id AND c.recorded_clinic_id IS NULL AND u.clinic_id IS NOT NULL;
  END IF;
END;
$$;
-- Flush deferred age checks after the attribution backfill before subsequent DDL.
SET CONSTRAINTS ALL IMMEDIATE;
CREATE INDEX IF NOT EXISTS consents_patient_latest_idx ON operational.patient_consents(patient_id,id DESC);
CREATE TABLE IF NOT EXISTS operational.consent_operations (
  clinic_id integer NOT NULL REFERENCES operational.clinics(clinic_id) ON DELETE CASCADE,
  client_op_id uuid NOT NULL,
  actor_id integer NOT NULL REFERENCES operational.users(id) ON DELETE CASCADE,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(clinic_id,client_op_id)
);
ALTER TABLE operational.consent_operations DROP CONSTRAINT consent_operations_clinic_id_fkey;
ALTER TABLE operational.consent_operations ADD CONSTRAINT consent_operations_clinic_id_fkey
  FOREIGN KEY(clinic_id) REFERENCES operational.clinics(clinic_id) ON DELETE CASCADE;
ALTER TABLE operational.consent_operations DROP CONSTRAINT consent_operations_actor_id_fkey;
ALTER TABLE operational.consent_operations ADD CONSTRAINT consent_operations_actor_id_fkey
  FOREIGN KEY(actor_id) REFERENCES operational.users(id) ON DELETE CASCADE;
GRANT SELECT,INSERT ON operational.consent_operations TO amal_app;
-- Runtime history can only be appended, or transition once to withdrawn.
-- Use column privileges for immutable evidence, not a new privileged-reset
-- exception. Existing administrative ownership/cleanup rights are unchanged.
CREATE OR REPLACE FUNCTION operational.guard_consent_history() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD.withdrawn_at IS NULL AND NEW.withdrawn_at IS NOT NULL
      AND (to_jsonb(OLD)-'withdrawn_at')=(to_jsonb(NEW)-'withdrawn_at') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'Consent history is retained' USING ERRCODE='42501';
END;
$$;
DROP TRIGGER IF EXISTS consent_history_immutable ON operational.patient_consents;
CREATE TRIGGER consent_history_immutable BEFORE UPDATE OF withdrawn_at ON operational.patient_consents
FOR EACH ROW EXECUTE FUNCTION operational.guard_consent_history();
DROP TRIGGER IF EXISTS consent_history_no_truncate ON operational.patient_consents;
REVOKE UPDATE,DELETE,TRUNCATE ON operational.patient_consents FROM amal_app;
GRANT UPDATE(withdrawn_at) ON operational.patient_consents TO amal_app;
REVOKE ALL ON FUNCTION operational.guard_consent_history() FROM PUBLIC;
-- Existing append-only audit triggers and runtime privileges remain unchanged.
COMMIT;
