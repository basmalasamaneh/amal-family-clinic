-- Additive task 10 persistence. No seed relations or historical bookings are rewritten.
BEGIN;
ALTER TABLE operational.appointments ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK (version > 0);
CREATE TABLE IF NOT EXISTS operational.appointment_operations (
  client_op_id uuid PRIMARY KEY,
  actor_id integer NOT NULL REFERENCES operational.users(id),
  clinic_id integer NOT NULL REFERENCES operational.clinics(clinic_id),
  doctor_id integer NOT NULL REFERENCES operational.doctors(doctor_id),
  payload_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS operational.appointment_holds (
  token uuid PRIMARY KEY,
  owner_id integer NOT NULL REFERENCES operational.users(id),
  clinic_id integer NOT NULL REFERENCES operational.clinics(clinic_id),
  doctor_id integer NOT NULL,
  patient_id integer NOT NULL REFERENCES operational.patients(patient_id),
  appointment_id integer REFERENCES operational.appointments(appointment_id),
  starts_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 1 AND 1440),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (doctor_id, clinic_id) REFERENCES operational.doctors(doctor_id, clinic_id)
);
CREATE INDEX IF NOT EXISTS appointment_holds_doctor_expiry_idx ON operational.appointment_holds(doctor_id, expires_at);
GRANT SELECT, INSERT ON operational.appointment_operations TO amal_app;
GRANT SELECT, INSERT, DELETE ON operational.appointment_holds TO amal_app;
GRANT SELECT, DELETE ON operational.appointment_operations, operational.appointment_holds TO amal_demo_reset;
COMMIT;
