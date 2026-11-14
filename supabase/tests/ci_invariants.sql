-- Disposable local Supabase migration and security invariants.
DO $$
DECLARE
  total_public_tables integer;
  tables_without_rls integer;
  unsafe_definer_functions integer;
  callable_client_rpcs integer;
  auth_account_triggers integer;
  realtime_tables integer;
  legacy_outbox_triggers integer;
BEGIN
  SELECT count(*) INTO total_public_tables FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition;
  IF total_public_tables < 13 THEN RAISE EXCEPTION 'Expected at least 13 public application tables, found %', total_public_tables; END IF;
  SELECT count(*) INTO tables_without_rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition AND NOT c.relrowsecurity;
  IF tables_without_rls <> 0 THEN RAISE EXCEPTION 'Found % public tables without RLS', tables_without_rls; END IF;
  SELECT count(*) INTO unsafe_definer_functions FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosecdef AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) setting WHERE setting LIKE 'search_path=%');
  IF unsafe_definer_functions <> 0 THEN RAISE EXCEPTION 'Found % SECURITY DEFINER functions without a pinned search_path', unsafe_definer_functions; END IF;
  SELECT count(*) INTO callable_client_rpcs FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'rideforge_%' AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF callable_client_rpcs <> 0 THEN RAISE EXCEPTION 'Found % RideForge functions executable by anon/authenticated', callable_client_rpcs; END IF;
  SELECT count(*) INTO auth_account_triggers FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'auth' AND c.relname = 'users' AND t.tgname = 'rideforge_auth_user_created' AND NOT t.tgisinternal;
  IF auth_account_triggers <> 1 THEN RAISE EXCEPTION 'Expected auth.users account-bridge trigger exactly once, found %', auth_account_triggers; END IF;
  SELECT count(*) INTO realtime_tables FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename IN ('rides', 'ride_events');
  IF realtime_tables <> 2 THEN RAISE EXCEPTION 'Expected rides and ride_events in supabase_realtime, found %', realtime_tables; END IF;
  SELECT count(*) INTO legacy_outbox_triggers FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_proc p ON p.oid = t.tgfoid WHERE n.nspname = 'public' AND c.relname = 'ride_events' AND p.proname = 'enqueue_ride_event_notification' AND NOT t.tgisinternal;
  IF legacy_outbox_triggers <> 0 THEN RAISE EXCEPTION 'Legacy ride-event outbox notification trigger is still attached'; END IF;
END
$$;