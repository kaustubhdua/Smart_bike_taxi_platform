-- Smoke-test the migration's most important integrity invariant on a clean PostgreSQL DB.
BEGIN;

INSERT INTO accounts (id, email, display_name, role, password_hash)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'passenger-one@example.test', 'Passenger One', 'passenger', 'test-hash'),
  ('10000000-0000-4000-8000-000000000002', 'passenger-two@example.test', 'Passenger Two', 'passenger', 'test-hash'),
  ('20000000-0000-4000-8000-000000000001', 'driver@example.test', 'Driver', 'driver', 'test-hash');

INSERT INTO driver_profiles (account_id, vehicle_registration, is_online)
VALUES ('20000000-0000-4000-8000-000000000001', 'TEST-DRIVER-001', true);

INSERT INTO rides (
  id, passenger_id, driver_id, status, pickup_label, pickup_latitude, pickup_longitude,
  destination_label, destination_latitude, destination_longitude, quoted_fare_paise, idempotency_key
) VALUES (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'assigned', 'Pickup', 28.53, 77.35, 'Dropoff', 28.54, 77.36, 4500, 'test-key-0001'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO rides (
      id, passenger_id, driver_id, status, pickup_label, pickup_latitude, pickup_longitude,
      destination_label, destination_latitude, destination_longitude, quoted_fare_paise, idempotency_key
    ) VALUES (
      '30000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000001',
      'in_progress', 'Pickup Two', 28.53, 77.35, 'Dropoff Two', 28.55, 77.37, 5000, 'test-key-0002'
    );
    RAISE EXCEPTION 'Expected active-driver unique index to reject a second ride';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'PASS: driver cannot have two active rides';
  END;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'rides_one_active_ride_per_driver'
  ) THEN
    RAISE EXCEPTION 'Missing active-driver concurrency guard index';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'booking_idempotency'
  ) THEN
    RAISE EXCEPTION 'Missing booking idempotency table';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'route_quotes'
  ) THEN
    RAISE EXCEPTION 'Missing persisted route quote table';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM schema_migrations WHERE version = '001_initial_schema'
  ) THEN
    RAISE EXCEPTION 'Initial schema migration was not recorded atomically';
  END IF;
END $;

ROLLBACK;
