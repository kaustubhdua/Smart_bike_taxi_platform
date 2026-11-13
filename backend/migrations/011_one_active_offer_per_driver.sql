BEGIN;

-- Multiple dispatch workers may reserve different rides concurrently. The
-- worker-side eligibility query avoids busy drivers, while this partial unique
-- index is the final transactional guard if two workers race on the same driver.
DO $block$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ride_offers
    WHERE status='offered'
    GROUP BY driver_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'cannot add one-active-offer-per-driver index: duplicate active driver offers exist';
  END IF;
END
$block$;

CREATE UNIQUE INDEX IF NOT EXISTS ride_offers_one_active_per_driver
  ON ride_offers (driver_id)
  WHERE status='offered';

INSERT INTO public.schema_migrations (version)
VALUES ('011_one_active_offer_per_driver')
ON CONFLICT (version) DO NOTHING;

COMMIT;
