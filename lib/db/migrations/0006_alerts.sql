BEGIN;
ALTER TABLE operational.visit_alerts ADD COLUMN IF NOT EXISTS extractor_rule_id text;
ALTER TABLE operational.visit_alerts ADD COLUMN IF NOT EXISTS dictionary_version text;
ALTER TABLE operational.visit_alerts ADD COLUMN IF NOT EXISTS label_params jsonb NOT NULL DEFAULT '{}';
ALTER TABLE operational.visit_alerts ADD COLUMN IF NOT EXISTS excerpt_start integer;
ALTER TABLE operational.visit_alerts ADD COLUMN IF NOT EXISTS excerpt_end integer;
CREATE UNIQUE INDEX IF NOT EXISTS visit_alerts_extractor_rule_unique
  ON operational.visit_alerts(visit_id,extractor_rule_id) WHERE extractor_rule_id IS NOT NULL;
-- Validate new/replaced evidence against its source, not unrelated historical
-- manual evidence. A later note edit must not rewrite or delete manual records.
CREATE OR REPLACE FUNCTION operational.check_alert_provenance() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_TABLE_NAME='visit_alerts' THEN
    IF EXISTS (
      SELECT 1 FROM operational.visit_alerts a
      JOIN operational.patient_visit_history v ON v.visit_id=a.visit_id
      WHERE a.id=NEW.id AND (a.patient_id<>v.patient_id
        OR length(a.source_note_excerpt)=0 OR strpos(v.diagnosis_notes,a.source_note_excerpt)=0
        OR (a.extractor_rule_id IS NOT NULL AND (
          a.dictionary_version IS NULL OR a.excerpt_start IS NULL OR a.excerpt_end IS NULL
          OR a.excerpt_start<0 OR a.excerpt_end<=a.excerpt_start
          OR jsonb_typeof(a.label_params)<>'object')))
    ) THEN
      RAISE EXCEPTION 'Alert requires verbatim source evidence and patient provenance' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
-- Prevent stale derived evidence even if a future writer forgets re-extraction.
-- Runs within the note-write transaction and its row lock. Manual flags survive.
CREATE OR REPLACE FUNCTION operational.invalidate_extracted_alerts() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.diagnosis_notes IS DISTINCT FROM OLD.diagnosis_notes THEN
    DELETE FROM operational.visit_alerts WHERE visit_id=OLD.visit_id AND extractor_rule_id IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS invalidate_extracted_alerts ON operational.patient_visit_history;
CREATE TRIGGER invalidate_extracted_alerts AFTER UPDATE OF diagnosis_notes ON operational.patient_visit_history
FOR EACH ROW EXECUTE FUNCTION operational.invalidate_extracted_alerts();
REVOKE ALL ON FUNCTION operational.invalidate_extracted_alerts() FROM PUBLIC;
COMMIT;
