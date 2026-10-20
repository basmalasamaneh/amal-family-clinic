BEGIN;
SELECT pg_advisory_xact_lock(761929);
-- Keep legacy fixture snapshots distinguishable; never reinterpret their evidence.
ALTER TABLE operational.kpi_snapshots
  ADD COLUMN IF NOT EXISTS period_end date,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS calculation_version text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS generated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE operational.kpi_snapshots SET period_end = date + 1 WHERE period_end IS NULL;
ALTER TABLE operational.kpi_snapshots ALTER COLUMN period_end SET NOT NULL;
ALTER TABLE operational.kpi_snapshots ALTER COLUMN value DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS kpi_period_clinic_unique
  ON operational.kpi_snapshots(date,period_end,metric,clinic_id,source,calculation_version) WHERE clinic_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS kpi_period_network_unique
  ON operational.kpi_snapshots(date,period_end,metric,source,calculation_version) WHERE clinic_id IS NULL;
DROP INDEX IF EXISTS operational.kpi_clinic_date_metric_unique;
DROP INDEX IF EXISTS operational.kpi_network_date_metric_unique;
ALTER TABLE operational.kpi_snapshots DROP CONSTRAINT IF EXISTS kpi_period_check;
ALTER TABLE operational.kpi_snapshots ADD CONSTRAINT kpi_period_check CHECK(period_end > date);
ALTER TABLE operational.kpi_snapshots DROP CONSTRAINT IF EXISTS kpi_source_check;
ALTER TABLE operational.kpi_snapshots ADD CONSTRAINT kpi_source_check CHECK(source IN ('legacy','before','after'));
COMMIT;
