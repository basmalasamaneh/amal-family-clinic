BEGIN;
ALTER TABLE operational.patients ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK(version>0);
CREATE OR REPLACE FUNCTION operational.patient_version_update() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'Merged patient is a retained alias' USING ERRCODE='23514';
  END IF;
  NEW.version := OLD.version+1;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS patient_version_update ON operational.patients;
CREATE TRIGGER patient_version_update BEFORE UPDATE ON operational.patients
FOR EACH ROW EXECUTE FUNCTION operational.patient_version_update();

-- Stale operational writers cannot attach new clinical references to a retained
-- alias. FOR KEY SHARE coordinates this check with merge's patient row lock.
-- Audit, consent history, imports and receipts deliberately retain source IDs.
CREATE OR REPLACE FUNCTION operational.require_active_patient_reference() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE target_merged integer;
BEGIN
  SELECT merged_into_id INTO target_merged FROM operational.patients
    WHERE patient_id=NEW.patient_id FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Patient reference does not exist' USING ERRCODE='23503';
  END IF;
  IF target_merged IS NOT NULL THEN
    RAISE EXCEPTION 'Clinical reference requires an active patient' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
DO $$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['appointments','patient_visit_history','visit_alerts','notifications','appointment_holds'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS active_patient_reference ON operational.%I',relation_name);
    EXECUTE format('CREATE TRIGGER active_patient_reference BEFORE INSERT OR UPDATE OF patient_id ON operational.%I FOR EACH ROW EXECUTE FUNCTION operational.require_active_patient_reference()',relation_name);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION operational.require_active_patient_reference() FROM PUBLIC;

CREATE TABLE IF NOT EXISTS operational.patient_merge_operations (
  client_op_id uuid PRIMARY KEY,
  actor_id integer NOT NULL REFERENCES operational.users(id),
  clinic_id integer NOT NULL REFERENCES operational.clinics(clinic_id),
  source_id integer NOT NULL UNIQUE REFERENCES operational.patients(patient_id),
  target_id integer NOT NULL REFERENCES operational.patients(patient_id),
  request_hash text NOT NULL,
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(source_id<>target_id)
);
CREATE TABLE IF NOT EXISTS operational.patient_merge_moves (
  client_op_id uuid NOT NULL REFERENCES operational.patient_merge_operations(client_op_id) DEFERRABLE INITIALLY DEFERRED,
  relation_name text NOT NULL,
  record_id integer NOT NULL,
  source_id integer NOT NULL REFERENCES operational.patients(patient_id),
  target_id integer NOT NULL REFERENCES operational.patients(patient_id),
  PRIMARY KEY(client_op_id,relation_name,record_id)
);
-- Composite identity FKs must be checked against the final merged state.
ALTER TABLE operational.visit_alerts ALTER CONSTRAINT alerts_visit_patient_fk DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE operational.notifications ALTER CONSTRAINT notifications_appointment_patient_clinic_fk DEFERRABLE INITIALLY IMMEDIATE;

-- Runtime grants remain read-only. A narrow helper acquires only relation locks:
-- concurrent grant deletion/provisioning cannot change visibility during merge.
CREATE OR REPLACE FUNCTION operational.lock_patient_merge_access() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  LOCK TABLE operational.patient_clinic_access,operational.patient_doctor_access IN SHARE MODE;
END;
$$;
REVOKE ALL ON FUNCTION operational.lock_patient_merge_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operational.lock_patient_merge_access() TO amal_app;
REVOKE ALL ON FUNCTION operational.patient_version_update() FROM PUBLIC;
GRANT SELECT,INSERT ON operational.patient_merge_operations,operational.patient_merge_moves TO amal_app;
GRANT SELECT,DELETE ON operational.patient_merge_operations,operational.patient_merge_moves TO amal_demo_reset;
COMMIT;
