BEGIN;

-- Driver accounts are not dispatch-eligible until an administrator explicitly approves them.
ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS is_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES accounts(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS driver_profiles_dispatch_eligibility
  ON driver_profiles (is_online, last_location_at)
  WHERE is_approved = true;

-- Durable notification outbox. Ride-event inserts and outbox rows commit together;
-- a future worker can publish notifications and retry without losing state changes.
CREATE TABLE IF NOT EXISTS ride_event_outbox (
  id bigserial PRIMARY KEY,
  ride_event_id bigint NOT NULL UNIQUE REFERENCES ride_events(id) ON DELETE RESTRICT,
  ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  claimed_until timestamptz
);

CREATE INDEX IF NOT EXISTS ride_event_outbox_pending
  ON ride_event_outbox (available_at, id)
  WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS admin_audit_events (
  id bigserial PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (length(trim(action)) BETWEEN 1 AND 80),
  target_type text NOT NULL CHECK (length(trim(target_type)) BETWEEN 1 AND 80),
  target_id text NOT NULL CHECK (length(trim(target_id)) BETWEEN 1 AND 160),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_events_recent
  ON admin_audit_events (created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION enqueue_ride_event_notification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO ride_event_outbox (ride_event_id, ride_id)
  VALUES (NEW.id, NEW.ride_id)
  ON CONFLICT (ride_event_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ride_event_notification_outbox ON ride_events;
CREATE TRIGGER ride_event_notification_outbox
  AFTER INSERT ON ride_events
  FOR EACH ROW EXECUTE FUNCTION enqueue_ride_event_notification();

INSERT INTO schema_migrations (version) VALUES ('002_driver_approval_and_outbox')
ON CONFLICT (version) DO NOTHING;

COMMIT;
