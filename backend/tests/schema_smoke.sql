-- Smoke-test the migration's most important integrity invariant on a clean PostgreSQL DB.
BEGIN;

INSERT INTO accounts (id, email, display_name, role, password_hash)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'passenger-one@example.test', 'Passenger One', 'passenger', 'test-hash'),
  ('10000000-0000-4000-8000-000000000002', 'passenger-two@example.test', 'Passenger Two', 'passenger', 'test-hash'),
  ('20000000-0000-4000-8000-000000000001', 'driver@example.test', 'Driver', 'driver', 'test-hash');

INSERT INTO driver_profiles (account_id, vehicle_registration, is_online, is_approved)
VALUES ('20000000-0000-4000-8000-000000000001', 'TEST-DRIVER-001', true, true);

INSERT INTO rides (
  id, passenger_id, driver_id, status, pickup_label, pickup_latitude, pickup_longitude,
  destination_label, destination_latitude, destination_longitude, quoted_fare_paise, idempotency_key
) VALUES (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'assigned', 'Pickup', 28.53, 77.35, 'Dropoff', 28.54, 77.36, 4500, 'test-key-0001'
);

-- Ride state events and durable notification-outbox rows must be atomic.
INSERT INTO ride_events (ride_id, actor_id, previous_status, new_status, details)
VALUES (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'requested', 'assigned', '{"source":"schema-smoke"}'::jsonb
);

DO $
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ride_event_outbox
    WHERE ride_id = '30000000-0000-4000-8000-000000000001'
      AND published_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Expected ride event to create a durable notification outbox row';
  END IF;
END $;

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

ROLLBACK;
