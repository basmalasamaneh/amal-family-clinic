BEGIN;
ALTER TABLE operational.patients ADD COLUMN IF NOT EXISTS created_clinic_id integer REFERENCES operational.clinics(clinic_id);
-- Authorization links are independent of mutable bookings. Runtime only reads.
CREATE TABLE IF NOT EXISTS operational.patient_clinic_access (
  patient_id integer NOT NULL REFERENCES operational.patients(patient_id),
  clinic_id integer NOT NULL REFERENCES operational.clinics(clinic_id),
  PRIMARY KEY(patient_id,clinic_id)
);
INSERT INTO operational.patient_clinic_access(patient_id,clinic_id)
SELECT p.patient_id,c.clinic_id FROM (
  SELECT patient_id,clinic_id FROM public.appointments
  UNION SELECT patient_id,clinic_id FROM public.patient_visit_history
) source
JOIN operational.patients p ON p.patient_id=source.patient_id
JOIN operational.clinics c ON c.clinic_id=source.clinic_id
ON CONFLICT DO NOTHING;
GRANT SELECT ON operational.patient_clinic_access TO amal_app;
GRANT SELECT, DELETE ON operational.patient_clinic_access TO amal_demo_reset;
CREATE INDEX IF NOT EXISTS patient_clinic_access_clinic_idx ON operational.patient_clinic_access(clinic_id);
-- Receipts deliberately do not reference patients: deleting an eligible record must
-- not erase its idempotency/audit trail or allow a replay to recreate it.
CREATE TABLE IF NOT EXISTS operational.patient_create_receipts (
  user_id integer NOT NULL REFERENCES operational.users(id),
  client_op_id uuid NOT NULL,
  clinic_id integer NOT NULL REFERENCES operational.clinics(clinic_id),
  request_hash text NOT NULL,
  patient_id integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(clinic_id, client_op_id)
);
GRANT SELECT, INSERT ON operational.patient_create_receipts TO amal_app;
GRANT SELECT, DELETE ON operational.patient_create_receipts TO amal_demo_reset;
CREATE INDEX IF NOT EXISTS patients_created_clinic_idx ON operational.patients(created_clinic_id);
CREATE INDEX IF NOT EXISTS patients_normalized_idx ON operational.patients(name_normalized);
COMMIT;
