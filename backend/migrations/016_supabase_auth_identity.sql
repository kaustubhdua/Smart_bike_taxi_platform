BEGIN;

-- Supabase Auth becomes the identity provider. Keep the internal account UUID
-- because all ride foreign keys and audit records already reference it.
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS auth_user_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.accounts'::regclass
      AND conname = 'accounts_auth_user_id_fkey'
  ) THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_auth_user_id_fkey
      FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_auth_user_id_unique
  ON public.accounts(auth_user_id)
  WHERE auth_user_id IS NOT NULL;

COMMENT ON COLUMN public.accounts.auth_user_id IS
  'Supabase Auth identity. Internal accounts.id remains the RideForge domain identity.';

INSERT INTO public.schema_migrations(version)
VALUES ('016_supabase_auth_identity')
ON CONFLICT (version) DO NOTHING;

COMMIT;
