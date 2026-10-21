BEGIN;
SELECT pg_advisory_xact_lock_shared(761930);
SELECT pg_advisory_xact_lock(761910);
ALTER TABLE operational.clinics ADD COLUMN IF NOT EXISTS reminders_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE operational.patients ADD COLUMN IF NOT EXISTS reminder_opt_out boolean NOT NULL DEFAULT false;
ALTER TABLE operational.appointments ADD COLUMN IF NOT EXISTS reminder_schedule_version integer NOT NULL DEFAULT 1;
ALTER TABLE operational.notifications
  ADD COLUMN IF NOT EXISTS schedule_version integer,
  ADD COLUMN IF NOT EXISTS offset_hours integer,
  ADD COLUMN IF NOT EXISTS text_ar text,
  ADD COLUMN IF NOT EXISTS text_en text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS receipt jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_reminder_identity
  ON operational.notifications(appointment_id,schedule_version,offset_hours)
  WHERE schedule_version IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_reminder_due
  ON operational.notifications(scheduled_at,id) WHERE status='pending' AND schedule_version IS NOT NULL;
ALTER TABLE operational.notifications DROP CONSTRAINT IF EXISTS notifications_reminder_shape;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='notifications_reminder_shape' AND conrelid='operational.notifications'::regclass) THEN
    ALTER TABLE operational.notifications ADD CONSTRAINT notifications_reminder_shape CHECK (
      schedule_version IS NULL OR (
        schedule_version>0 AND appointment_id IS NOT NULL AND offset_hours IS NOT NULL AND offset_hours IN (24,2)
        AND text_ar IS NOT NULL AND text_en IS NOT NULL
        AND ((status='pending' AND sent_at IS NULL AND cancelled_at IS NULL AND receipt IS NULL)
          OR (status='simulated' AND sent_at IS NOT NULL AND receipt IS NOT NULL AND cancelled_at IS NULL)
          OR (status='cancelled' AND cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL AND cancellation_reason IN
            ('missed_window','appointment_changed','appointment_inactive','clinic_disabled','patient_opt_out','stale_schedule')
            AND sent_at IS NULL AND receipt IS NULL))));
  END IF;
END $$;
COMMIT;
