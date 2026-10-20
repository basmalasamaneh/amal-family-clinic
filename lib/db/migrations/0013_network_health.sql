-- Development migration only; managed production schema changes use Publish.
-- No seed objects or legacy sync_queue snapshots are read or changed.
BEGIN;
CREATE TABLE IF NOT EXISTS operational.device_network_health (
  device_id integer PRIMARY KEY REFERENCES operational.devices(id) ON DELETE CASCADE,
  heartbeat_sequence bigint,
  last_heartbeat_at timestamptz,
  unsubmitted_operation_count integer,
  last_successful_sync_at timestamptz,
  CONSTRAINT network_heartbeat_check CHECK (
    (heartbeat_sequence IS NULL AND last_heartbeat_at IS NULL AND unsubmitted_operation_count IS NULL)
    OR (heartbeat_sequence BETWEEN 1 AND 9007199254740991 AND last_heartbeat_at IS NOT NULL
      AND unsubmitted_operation_count BETWEEN 0 AND 1000000)),
  CONSTRAINT network_sequence_presence_check CHECK (
    (heartbeat_sequence IS NULL) = (last_heartbeat_at IS NULL)
    AND (heartbeat_sequence IS NULL) = (unsubmitted_operation_count IS NULL))
);
GRANT SELECT, INSERT, UPDATE ON operational.device_network_health TO amal_app;
COMMIT;
