BEGIN;

CREATE TABLE IF NOT EXISTS support_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES accounts(id),
  ride_id uuid REFERENCES rides(id),
  category text NOT NULL CHECK (category IN ('booking','driver','safety','payment_demo','technical','other')),
  severity text NOT NULL DEFAULT 'normal' CHECK (severity IN ('low','normal','high','urgent')),
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 10 AND 2000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','resolved')),
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS support_reports_status_created
  ON support_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS support_reports_reporter_created
  ON support_reports (reporter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_reports_ride_created
  ON support_reports (ride_id, created_at DESC)
  WHERE ride_id IS NOT NULL;

INSERT INTO schema_migrations (version) VALUES ('004_support_reports')
ON CONFLICT (version) DO NOTHING;

COMMIT;
