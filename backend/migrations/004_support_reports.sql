BEGIN;

CREATE TABLE IF NOT EXISTS support_reports (
  id bigserial PRIMARY KEY,
  reporter_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  ride_id uuid REFERENCES rides(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (category IN ('booking','driver','payment','safety','technical','other')),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 10 AND 2000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','resolved','rejected')),
  resolution_note text NOT NULL DEFAULT '' CHECK (length(resolution_note) <= 2000),
  resolved_by uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK ((status IN ('resolved','rejected') AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
      OR (status IN ('open','in_review') AND resolved_at IS NULL AND resolved_by IS NULL))
);

CREATE INDEX IF NOT EXISTS support_reports_reporter_recent
  ON support_reports (reporter_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS support_reports_status_recent
  ON support_reports (status, created_at DESC, id DESC);

INSERT INTO schema_migrations (version) VALUES ('004_support_reports')
ON CONFLICT (version) DO NOTHING;

COMMIT;
