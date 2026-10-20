BEGIN;
ALTER TABLE operational.clinics ADD COLUMN IF NOT EXISTS adoption_state text;
ALTER TABLE operational.clinics ADD COLUMN IF NOT EXISTS membership_status text NOT NULL DEFAULT 'active';
ALTER TABLE operational.clinics ADD COLUMN IF NOT EXISTS adoption_changed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE operational.clinics ADD COLUMN IF NOT EXISTS trial_started_at timestamptz;
ALTER TABLE operational.clinics ADD COLUMN IF NOT EXISTS lite_started_at timestamptz;
ALTER TABLE operational.clinics ADD COLUMN IF NOT EXISTS full_started_at timestamptz;
ALTER TABLE operational.clinics ADD COLUMN IF NOT EXISTS left_at timestamptz;
ALTER TABLE operational.clinics ADD COLUMN IF NOT EXISTS left_by integer REFERENCES operational.users(id);
UPDATE operational.clinics SET adoption_state=network_mode::text,
  lite_started_at=CASE WHEN network_mode='lite' THEN joined_at END,
  full_started_at=CASE WHEN network_mode='full' THEN joined_at END
WHERE adoption_state IS NULL;
ALTER TABLE operational.clinics ALTER COLUMN adoption_state SET NOT NULL;
-- Direct operational fixture/bootstrap inserts retain their explicit legacy mode.
-- API clinic creation explicitly chooses Trial instead.
CREATE OR REPLACE FUNCTION operational.clinic_adoption_defaults() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.adoption_state IS NULL THEN NEW.adoption_state:=NEW.network_mode::text; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS clinic_adoption_defaults ON operational.clinics;
CREATE TRIGGER clinic_adoption_defaults BEFORE INSERT ON operational.clinics
 FOR EACH ROW EXECUTE FUNCTION operational.clinic_adoption_defaults();
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='clinic_adoption_consistency') THEN
 ALTER TABLE operational.clinics ADD CONSTRAINT clinic_adoption_consistency CHECK (
   adoption_state IN ('trial','lite','full') AND membership_status IN ('active','left')
   AND (network_mode='full')=(adoption_state='full' AND membership_status='active')
   AND ((membership_status='active' AND left_at IS NULL AND left_by IS NULL)
     OR (membership_status='left' AND adoption_state='lite' AND left_at IS NOT NULL AND left_by IS NOT NULL)));
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS operational.clinic_managers(
 clinic_id integer NOT NULL REFERENCES operational.clinics(clinic_id),
 user_id integer NOT NULL REFERENCES operational.users(id),
 granted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(clinic_id,user_id)
);
-- Delegation is explicitly provisioned by a trusted operator, never inferred from role.
REVOKE ALL ON operational.clinic_managers FROM amal_app;
GRANT SELECT ON operational.clinic_managers TO amal_app;
-- Delegation writers participate in lifecycle ordering even when provisioned
-- outside HTTP. Runtime cannot grant itself this capability.
CREATE OR REPLACE FUNCTION operational.lock_clinic_delegation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(160005);
 PERFORM pg_advisory_xact_lock(761910);
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS clinic_delegation_lock ON operational.clinic_managers;
CREATE TRIGGER clinic_delegation_lock BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
 ON operational.clinic_managers FOR EACH STATEMENT EXECUTE FUNCTION operational.lock_clinic_delegation();
COMMIT;
