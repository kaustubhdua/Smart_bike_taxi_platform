INSERT INTO route_quotes (
  id, pickup_label, pickup_latitude, pickup_longitude,
  destination_label, destination_latitude, destination_longitude,
  route_distance_m, route_duration_seconds, fare_paise, currency, expires_at
) VALUES
  ('40000000-0000-4000-8000-000000000001', 'CI Pickup', 28.5300, 77.3500,
   'CI Destination', 28.5400, 77.3600, 2500, 600, 4750, 'INR', now() + interval '5 minutes'),
  ('40000000-0000-4000-8000-000000000002', 'CI Pickup Two', 28.5300, 77.3500,
   'CI Destination Two', 28.5500, 77.3700, 3500, 900, 5850, 'INR', now() + interval '5 minutes'),
  ('40000000-0000-4000-8000-000000000003', 'Expired Pickup', 28.5300, 77.3500,
   'Expired Destination', 28.5600, 77.3800, 4500, 1200, 6950, 'INR', now() - interval '1 minute');
