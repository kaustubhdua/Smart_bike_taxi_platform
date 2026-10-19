BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE account_role AS ENUM ('passenger', 'driver', 'admin');
CREATE TYPE ride_status AS ENUM ('requested', 'matching', 'assigned', 'driver_arriving', 'in_progress', 'completed', 'cancelled', 'failed');

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(trim(email))),
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
  phone text,
  role account_role NOT NULL DEFAULT 'passenger',
  password_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE driver_profiles (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE RESTRICT,
  vehicle_registration text NOT NULL UNIQUE,
  is_online boolean NOT NULL DEFAULT false,
  current_latitude double precision,
  current_longitude double precision,
  last_location_at timestamptz,
  rating numeric(3,2) NOT NULL DEFAULT 5.00 CHECK (rating BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((current_latitude IS NULL AND current_longitude IS NULL) OR
         (current_latitude BETWEEN -90 AND 90 AND current_longitude BETWEEN -180 AND 180))
);

CREATE TABLE rides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  driver_id uuid REFERENCES driver_profiles(account_id) ON DELETE RESTRICT,
  status ride_status NOT NULL DEFAULT 'requested',
  pickup_label text NOT NULL CHECK (length(trim(pickup_label)) BETWEEN 1 AND 240),
  pickup_latitude double precision NOT NULL CHECK (pickup_latitude BETWEEN -90 AND 90),
  pickup_longitude double precision NOT NULL CHECK (pickup_longitude BETWEEN -180 AND 180),
  destination_label text NOT NULL CHECK (length(trim(destination_label)) BETWEEN 1 AND 240),
  destination_latitude double precision NOT NULL CHECK (destination_latitude BETWEEN -90 AND 90),
  destination_longitude double precision NOT NULL CHECK (destination_longitude BETWEEN -180 AND 180),
  route_distance_m integer CHECK (route_distance_m > 0),
  quoted_fare_paise integer NOT NULL CHECK (quoted_fare_paise >= 0),
  final_fare_paise integer CHECK (final_fare_paise >= 0),
  currency char(3) NOT NULL DEFAULT 'INR',
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  assigned_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (passenger_id, idempotency_key),
  CHECK (pickup_latitude <> destination_latitude OR pickup_longitude <> destination_longitude),
  CHECK (status <> 'completed' OR (final_fare_paise IS NOT NULL AND completed_at IS NOT NULL))
);

-- Final concurrency guard: the database refuses two active rides for one driver.
CREATE UNIQUE INDEX rides_one_active_ride_per_driver ON rides(driver_id)
  WHERE driver_id IS NOT NULL AND status IN ('assigned', 'driver_arriving', 'in_progress');
CREATE INDEX rides_passenger_history ON rides(passenger_id, created_at DESC);
CREATE INDEX rides_driver_history ON rides(driver_id, created_at DESC);
CREATE INDEX rides_dispatch_queue ON rides(created_at) WHERE status IN ('requested', 'matching');

CREATE TABLE ride_events (
  id bigserial PRIMARY KEY,
  ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  previous_status ride_status,
  new_status ride_status NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ride_events_by_ride ON ride_events(ride_id, created_at);

CREATE TABLE route_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_label text NOT NULL CHECK (length(trim(pickup_label)) BETWEEN 2 AND 240),
  pickup_latitude double precision NOT NULL CHECK (pickup_latitude BETWEEN -90 AND 90),
  pickup_longitude double precision NOT NULL CHECK (pickup_longitude BETWEEN -180 AND 180),
  destination_label text NOT NULL CHECK (length(trim(destination_label)) BETWEEN 2 AND 240),
  destination_latitude double precision NOT NULL CHECK (destination_latitude BETWEEN -90 AND 90),
  destination_longitude double precision NOT NULL CHECK (destination_longitude BETWEEN -180 AND 180),
  route_distance_m integer NOT NULL CHECK (route_distance_m > 0),
  route_duration_seconds integer NOT NULL CHECK (route_duration_seconds > 0),
  fare_paise integer NOT NULL CHECK (fare_paise >= 0),
  currency char(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (pickup_latitude <> destination_latitude OR pickup_longitude <> destination_longitude)
);
CREATE INDEX route_quotes_expiry ON route_quotes(expires_at);
CREATE INDEX route_quotes_created_at ON route_quotes(created_at DESC);

CREATE TABLE booking_idempotency (
  passenger_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  ride_id uuid REFERENCES rides(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (passenger_id, idempotency_key)
);

INSERT INTO schema_migrations (version) VALUES ('001_initial_schema');

COMMIT;
