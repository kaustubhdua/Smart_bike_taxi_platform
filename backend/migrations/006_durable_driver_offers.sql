BEGIN;

-- Durable, time-limited, one-driver-at-a-time dispatch offers.
CREATE TABLE IF NOT EXISTS ride_offers (
  id bigserial PRIMARY KEY,
  ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE RESTRICT,
  driver_id uuid NOT NULL REFERENCES driver_profiles(account_id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'offered'
    CHECK (status IN ('offered','accepted','declined','expired','superseded')),
  offered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '45 seconds'),
  responded_at timestamptz,
  CHECK (expires_at > offered_at),
  UNIQUE (ride_id, driver_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ride_offers_one_active_per_ride
  ON ride_offers (ride_id) WHERE status = 'offered';
CREATE INDEX IF NOT EXISTS ride_offers_expiry
  ON ride_offers (expires_at) WHERE status = 'offered';
CREATE INDEX IF NOT EXISTS ride_offers_by_driver
  ON ride_offers (driver_id, offered_at DESC);

INSERT INTO schema_migrations (version) VALUES ('006_durable_driver_offers')
ON CONFLICT (version) DO NOTHING;

COMMIT;
