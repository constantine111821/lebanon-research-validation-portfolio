-- Preparation only: no hosted application authorized by this file.
begin;
-- Match the intended opt-in API grants for future postgres-owned public objects.
-- Table RLS does not protect TRUNCATE; remove inherited non-DML rights as well.
alter default privileges for role postgres in schema public revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on functions from public, anon, authenticated, service_role;
-- PostgreSQL's built-in PUBLIC function EXECUTE is a global default: a
-- per-schema REVOKE cannot remove it. This affects future postgres-owned
-- functions only; explicit application RPC grants remain unchanged.
alter default privileges for role postgres revoke execute on functions from public;
-- Preserve the optional existing RLS event trigger and its SECURITY DEFINER owner.
-- event_trigger functions are not application RPCs; they need no client EXECUTE.
do $hardening$ declare t record; begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    if (select prorettype <> 'event_trigger'::regtype or not prosecdef or proconfig is distinct from array['search_path=pg_catalog'] from pg_proc where oid='public.rls_auto_enable()'::regprocedure) then
      raise exception 'Unexpected rls_auto_enable definition; stop and reconcile target drift';
    end if;
    revoke all on function public.rls_auto_enable() from public, anon, authenticated, service_role;
  end if;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and (c.relname like 'lab\_%' escape '\' or c.relname in ('facility','incident','incident_facility','query','query_hit','source','claim','claim_source','gap_task','activity_log')) loop
    execute format('revoke truncate,references,trigger,maintain on table public.%I from public,anon,authenticated,service_role',t.relname);
  end loop;
end $hardening$;
commit;
