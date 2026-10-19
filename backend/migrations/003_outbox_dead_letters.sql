BEGIN;

ALTER TABLE ride_event_outbox
  ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz;

CREATE INDEX IF NOT EXISTS ride_event_outbox_dead_letters
  ON ride_event_outbox (dead_lettered_at DESC, id DESC)
  WHERE dead_lettered_at IS NOT NULL;

INSERT INTO schema_migrations (version) VALUES ('003_outbox_dead_letters')
ON CONFLICT (version) DO NOTHING;

COMMIT;
