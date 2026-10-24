BEGIN;

-- A decline is scoped to one driver and one ride. It never changes the passenger's ride.
-- The same driver can still see future requests; only this ride is hidden for them.
CREATE TABLE IF NOT EXISTS driver_ride_declines (
  ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE RESTRICT,
  driver_id uuid NOT NULL REFERENCES driver_profiles(account_id) ON DELETE RESTRICT,
  declined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ride_id, driver_id)
);

CREATE INDEX IF NOT EXISTS driver_ride_declines_by_driver
  ON driver_ride_declines (driver_id, declined_at DESC);

INSERT INTO schema_migrations (version) VALUES ('005_driver_ride_declines')
ON CONFLICT (version) DO NOTHING;

COMMIT;
