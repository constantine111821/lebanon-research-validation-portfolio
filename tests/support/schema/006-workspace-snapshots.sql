-- Bounded performance correction. No research rows, policy or certification changes.
begin;
-- Drain existing readers/writers before atomically replacing function contracts.
select pg_advisory_xact_lock(749310091::bigint);

-- Snapshot readers coexist; existing lab_commit writers retain the exclusive lock.
create or replace function lab_private.snapshot_v1() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=lab_private.require_actor(false); n text; rowsv jsonb; revs jsonb;
 records jsonb:='{}'; revisions jsonb:='{}'; wi jsonb; wc jsonb; ds jsonb; profile jsonb;
begin
 perform pg_advisory_xact_lock_shared(749310091::bigint);
 foreach n in array array['facility','incident','incident_facility','query','query_hit','source','claim','claim_source','gap_task','activity_log'] loop
  execute format('select coalesce(jsonb_agg(data order by id),''[]''::jsonb),coalesce(jsonb_object_agg(id,revision),''{}''::jsonb) from public.%I',n) into rowsv,revs;
  records:=records||jsonb_build_object(upper(n),rowsv);revisions:=revisions||jsonb_build_object(upper(n),revs);
 end loop;
 select coalesce(jsonb_object_agg(incident_id,to_jsonb(w)||jsonb_build_object('completion_issues',lab_private.completion_issues(incident_id),'identity_ready',lab_private.identity_ready(incident_id))),'{}'::jsonb) into wi from public.lab_incident_workflow w;
 select coalesce(jsonb_object_agg(claim_id,to_jsonb(w)),'{}'::jsonb) into wc from public.lab_claim_workflow w;
 select coalesce(jsonb_agg(to_jsonb(d) order by updated_at desc),'[]'::jsonb) into ds from public.lab_private_drafts d where owner_id=actor;
 select to_jsonb(p) into profile from public.lab_profiles p where user_id=actor;
 return jsonb_build_object('records',records,'revisions',revisions,'workflow',jsonb_build_object('incidents',wi,'claims',wc),'profile',profile,'drafts',ds,'classifications',(select data from public.lab_seed_metadata where id='approved_classifications'),'source_excerpts',(select data from public.lab_seed_metadata where id='approved_source_excerpts'),'seed_metadata',(select coalesce(jsonb_object_agg(id,data),'{}'::jsonb) from public.lab_seed_metadata));
end $$;

-- Restrict the candidate incident set before evaluating its lock. This is exactly
-- fact_in_scope: shared identity/type facts use current facility links; other
-- families use their originating incident. Preserve sorted IDs and dependencies.
create or replace function lab_private.fact_lock(cid text) returns jsonb
language sql stable set search_path=pg_catalog,public,lab_private as $$
 with candidates as materialized (
  select i.id from public.claim c join public.incident i on
   case when c.data->>'claim_family' in ('IDENTITY','FACILITY_TYPE') then
    exists(select 1 from public.incident_facility f where f.incident_id=i.id
     and f.facility_id=c.facility_id and coalesce((f.data->>'is_current')::boolean,true))
   else c.incident_id=i.id end where c.id=cid
 ), q as materialized (
  select lab_private.disposition_state('fact',cid) s,
   coalesce((select jsonb_agg(id order by id) from candidates where (lab_private.incident_lock(id)->>'locked')::boolean),'[]'::jsonb) locked_cases,
   coalesce((select jsonb_agg(id order by id) from public.claim where data->>'claim_family'='ATTACK_TO_EFFECT_CAUSATION' and coalesce((data->>'is_current')::boolean,true) and (data->>'attack_claim_id'=cid or data->>'effect_claim_id'=cid) and lab_private.disposition_state('fact',id)<>'ACTIVE'),'[]'::jsonb) protected_facts
 ) select jsonb_build_object('locked',s<>'ACTIVE' or jsonb_array_length(locked_cases)>0 or jsonb_array_length(protected_facts)>0,
 'state',case when s<>'ACTIVE' then s when jsonb_array_length(locked_cases)>0 then lab_private.incident_lock(locked_cases->>0)->>'state' when jsonb_array_length(protected_facts)>0 then 'DEPENDENCY_LOCKED' else 'ACTIVE' end,
 'reason',case when s<>'ACTIVE' then (select reason from public.lab_disposition where target_type='fact' and target_id=cid) when jsonb_array_length(locked_cases)>0 then 'This shared fact is protected by an incident disposition or completion. Reopen the protected incident first.' when jsonb_array_length(protected_facts)>0 then 'A deferred or approved causal fact depends on this finding. Reopen the dependent fact before changing its evidence or determination.' end,
 'incident_ids',locked_cases,'protected_fact_ids',protected_facts,'cause',case when s<>'ACTIVE' then 'fact' when jsonb_array_length(locked_cases)>0 then 'incident' when jsonb_array_length(protected_facts)>0 then 'dependency' else null end) from q
$$;

create or replace function lab_private.completion_issues(iid text) returns jsonb
language sql stable set search_path=pg_catalog,public as $$
 with readiness as materialized (select lab_private.acceptance_readiness(iid) r)
 select coalesce(jsonb_agg(jsonb_build_object('kind',case when x ? 'claim_id' then 'fact' else lower(x->>'category') end,'claim_id',x->>'claim_id','facility_id',x->>'facility_id','message',coalesce(x->>'subject','Recorded requirement remains outstanding; a supervisor may accept this limitation.'))),'[]'::jsonb)
 from readiness,jsonb_array_elements((r->'facts')||(r->'other_requirements')) x where x->>'status'='outstanding'
$$;

-- Content identity of observable backing state, not a time/aggregate-count guess.
-- Core revision vectors avoid serializing the research payload. Workflow/history
-- rows and metadata cover derived fields; private draft vectors are owner-only.
create function lab_private.workspace_version(actor uuid) returns text
language sql stable set search_path=pg_catalog,public as $$
 select encode(sha256(convert_to(jsonb_build_array(actor,
  (select jsonb_agg(v order by k) from (
   select 'facility' k,jsonb_object_agg(id,revision) v from public.facility union all
   select 'incident',jsonb_object_agg(id,revision) from public.incident union all
   select 'incident_facility',jsonb_object_agg(id,revision) from public.incident_facility union all
   select 'query',jsonb_object_agg(id,revision) from public.query union all
   select 'query_hit',jsonb_object_agg(id,revision) from public.query_hit union all
   select 'source',jsonb_object_agg(id,revision) from public.source union all
   select 'claim',jsonb_object_agg(id,revision) from public.claim union all
   select 'claim_source',jsonb_object_agg(id,revision) from public.claim_source union all
   select 'gap_task',jsonb_object_agg(id,revision) from public.gap_task union all
   select 'activity_log',jsonb_object_agg(id,revision) from public.activity_log
  ) core),
  (select jsonb_agg(to_jsonb(t) order by user_id) from public.lab_profiles t),
  (select jsonb_object_agg(id,revision) from public.lab_private_drafts where owner_id=actor),
  (select jsonb_agg(to_jsonb(t) order by incident_id) from public.lab_incident_workflow t),
  (select jsonb_agg(to_jsonb(t) order by claim_id) from public.lab_claim_workflow t),
  (select jsonb_agg(to_jsonb(t) order by facility_id) from public.lab_facility_workflow t),
  (select jsonb_agg(to_jsonb(t) order by gap_task_id) from public.lab_task_workflow t),
  (select jsonb_agg(to_jsonb(t) order by incident_id) from public.lab_case_assignment t),
  (select jsonb_agg(to_jsonb(t) order by incident_id) from public.lab_phase2_approval t),
  (select jsonb_agg(to_jsonb(t) order by target_type,target_id) from public.lab_disposition t),
  (select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.lab_disposition_history t),
  (select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.lab_disposition_request t),
  (select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.lab_facility_resolution t),
  (select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.lab_facility_resolution_reopening t),
  (select jsonb_agg(to_jsonb(t) order by claim_id) from public.lab_claim_requirement t),
  (select jsonb_agg(to_jsonb(t) order by id) from public.lab_seed_metadata t)
 )::text,'UTF8')),'hex')
$$;

create function public.lab_actor_profile() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=lab_private.require_actor(false);begin
 return (select to_jsonb(p) from public.lab_profiles p where user_id=actor);
end $$;

create function public.lab_snapshot_if_changed(p_version text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=lab_private.require_actor(false); before_version text; after_version text; s jsonb;
begin
 perform pg_advisory_xact_lock_shared(749310091::bigint);
 before_version:=lab_private.workspace_version(actor);
 if p_version=before_version then
  return jsonb_build_object('unchanged',true,'version',before_version,'profile',public.lab_actor_profile());
 end if;
 s:=public.lab_snapshot();after_version:=lab_private.workspace_version(actor);
 -- Private saves/profile changes do not take the shared-research lock. Never
 -- attach a newer stamp to an older snapshot if either changed during the read.
 return jsonb_build_object('unchanged',false,'snapshot',s,'version',case when before_version=after_version then before_version else null end);
end $$;

revoke all on function lab_private.workspace_version(uuid) from public,anon,authenticated,service_role;
revoke all on function public.lab_actor_profile(),public.lab_snapshot_if_changed(text) from public,anon,authenticated,service_role;
grant execute on function public.lab_actor_profile(),public.lab_snapshot_if_changed(text) to authenticated;
notify pgrst,'reload schema';
commit;
