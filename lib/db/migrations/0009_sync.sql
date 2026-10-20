BEGIN;
SELECT pg_advisory_xact_lock(761910);
ALTER TABLE operational.appointment_operations
  ADD COLUMN IF NOT EXISTS request jsonb,
  ADD COLUMN IF NOT EXISTS device_id integer REFERENCES operational.devices(id),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'applied' CHECK(status IN ('applied','conflict','rejected')),
  ADD COLUMN IF NOT EXISTS conflict_id uuid;
ALTER TABLE operational.appointment_operations DROP CONSTRAINT IF EXISTS appointment_operations_status_check;
ALTER TABLE operational.appointment_operations ADD CONSTRAINT appointment_operations_status_check
  CHECK(status IN ('applied','conflict','rejected'));
CREATE TABLE IF NOT EXISTS operational.sync_device_operations (
  device_id integer NOT NULL REFERENCES operational.devices(id),
  sequence integer NOT NULL CHECK(sequence > 0),
  client_op_id uuid NOT NULL REFERENCES operational.appointment_operations(client_op_id),
  PRIMARY KEY(device_id,sequence),
  UNIQUE(device_id,client_op_id)
);
CREATE TABLE IF NOT EXISTS operational.sync_conflicts (
  id uuid PRIMARY KEY,
  client_op_id uuid NOT NULL UNIQUE REFERENCES operational.appointment_operations(client_op_id),
  actor_id integer NOT NULL REFERENCES operational.users(id),
  device_id integer REFERENCES operational.devices(id),
  clinic_id integer NOT NULL REFERENCES operational.clinics(clinic_id),
  doctor_id integer NOT NULL REFERENCES operational.doctors(doctor_id),
  operation jsonb NOT NULL,
  target_id integer,
  base_version integer,
  server_state jsonb,
  reasons jsonb NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS operational.sync_resolution_history (
  id bigserial PRIMARY KEY,
  conflict_id uuid NOT NULL REFERENCES operational.sync_conflicts(id),
  client_op_id uuid NOT NULL UNIQUE REFERENCES operational.appointment_operations(client_op_id),
  actor_id integer NOT NULL REFERENCES operational.users(id),
  action text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS operational.sync_changes (
  id bigserial PRIMARY KEY,
  clinic_id integer NOT NULL,
  doctor_id integer NOT NULL,
  kind text NOT NULL CHECK(kind IN ('appointment','conflict')),
  entity_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS sync_changes_scope_idx ON operational.sync_changes(clinic_id,doctor_id,id);
CREATE INDEX IF NOT EXISTS sync_conflicts_scope_idx ON operational.sync_conflicts(actor_id,clinic_id,status,created_at,id);
CREATE OR REPLACE FUNCTION operational.sync_capture_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE r record; data jsonb; identifier text;
BEGIN
  PERFORM pg_advisory_xact_lock(761910);
  -- The explicitly gated demo reset clears the whole operational dataset and
  -- feed. Its dedicated role cannot be assumed by the application login.
  -- Ordinary application deletes must still emit tombstones.
  IF TG_OP='DELETE' AND current_user='amal_demo_reset' THEN RETURN NULL; END IF;
  IF TG_OP='DELETE' THEN r:=OLD; ELSE r:=NEW; END IF;
  IF TG_TABLE_NAME='appointments' THEN
    identifier:=r.appointment_id::text;
    data:=jsonb_build_object('id',r.appointment_id,'clinicId',r.clinic_id,'doctorId',r.doctor_id,
      'patientId',r.patient_id,'startsAt',r.scheduled_at,'endsAt',r.scheduled_at+r.duration_minutes*interval '1 minute',
      'status',r.status,'source',r.booking_method,'clientOpId',r.client_op_id,'version',r.version,'deleted',TG_OP='DELETE');
  ELSE
    identifier:=r.id::text;
    data:=jsonb_build_object('id',r.id,'actorId',r.actor_id,'status',r.status,'version',r.version,'clientOpId',r.client_op_id);
  END IF;
  INSERT INTO operational.sync_changes(clinic_id,doctor_id,kind,entity_id,payload)
    VALUES(r.clinic_id,r.doctor_id,CASE WHEN TG_TABLE_NAME='appointments' THEN 'appointment' ELSE 'conflict' END,identifier,data);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS sync_appointments_change ON operational.appointments;
CREATE TRIGGER sync_appointments_change AFTER INSERT OR UPDATE OR DELETE ON operational.appointments
  FOR EACH ROW EXECUTE FUNCTION operational.sync_capture_change();
DROP TRIGGER IF EXISTS sync_conflicts_change ON operational.sync_conflicts;
CREATE TRIGGER sync_conflicts_change AFTER INSERT OR UPDATE ON operational.sync_conflicts
  FOR EACH ROW EXECUTE FUNCTION operational.sync_capture_change();
INSERT INTO operational.sync_changes(clinic_id,doctor_id,kind,entity_id,payload)
SELECT clinic_id,doctor_id,'appointment',appointment_id::text,
  jsonb_build_object('id',appointment_id,'clinicId',clinic_id,'doctorId',doctor_id,'patientId',patient_id,
    'startsAt',scheduled_at,'endsAt',scheduled_at+duration_minutes*interval '1 minute',
    'status',status,'source',booking_method,'clientOpId',client_op_id,'version',version,'deleted',false)
FROM operational.appointments a
WHERE NOT EXISTS(SELECT 1 FROM operational.sync_changes c WHERE c.kind='appointment' AND c.entity_id=a.appointment_id::text);
GRANT UPDATE ON operational.appointment_operations TO amal_app;
GRANT SELECT,INSERT ON operational.sync_device_operations,operational.sync_resolution_history,operational.sync_changes TO amal_app;
GRANT SELECT,INSERT,UPDATE ON operational.sync_conflicts TO amal_app;
GRANT USAGE,SELECT ON SEQUENCE operational.sync_resolution_history_id_seq,operational.sync_changes_id_seq TO amal_app;
GRANT SELECT,DELETE ON operational.sync_device_operations,operational.sync_resolution_history,operational.sync_changes,operational.sync_conflicts TO amal_demo_reset;
COMMIT;
