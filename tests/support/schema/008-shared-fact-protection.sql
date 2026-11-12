-- Preparation only: disposition is not edit protection. No backing-row writes.
begin;
select pg_advisory_xact_lock(749310091::bigint);
create or replace function lab_private.fact_lock(cid text) returns jsonb
language sql stable set search_path=pg_catalog,public,lab_private as $$
 with candidates as materialized (
  select i.id,lab_private.incident_lock(i.id) l from public.claim c join public.incident i on
   (case when c.data->>'claim_family' in ('IDENTITY','FACILITY_TYPE') then
    exists(select 1 from public.incident_facility f where f.incident_id=i.id
     and f.facility_id=c.facility_id and coalesce((f.data->>'is_current')::boolean,true))
   else c.incident_id=i.id end
   or exists(select 1 from public.lab_incident_workflow w where w.incident_id=i.id and c.id=any(w.required_claim_ids)))
  where c.id=cid and (
   lab_private.incident_lock(i.id)->>'state'='APPROVED'
   or exists(select 1 from public.lab_incident_workflow w where w.incident_id=i.id and w.status in ('review_complete','supervisor_override'))
   -- Nonshared incident facts still cannot be edited through a deferred case.
   or (i.id=c.incident_id and c.data->>'claim_family' not in ('IDENTITY','FACILITY_TYPE')))
 ), q as materialized (
  select lab_private.disposition_state('fact',cid) s,
   coalesce((select jsonb_agg(id order by id) from candidates where (l->>'locked')::boolean),'[]'::jsonb) locked_cases,
   coalesce((select jsonb_object_agg(id,l->>'state') from candidates where (l->>'locked')::boolean),'{}'::jsonb) incident_states,
   exists(select 1 from candidates where l->>'state'='APPROVED' or exists(select 1 from public.lab_incident_workflow w where w.incident_id=candidates.id and w.status in ('review_complete','supervisor_override'))) completed,
   coalesce((select jsonb_agg(id order by id) from public.claim where data->>'claim_family'='ATTACK_TO_EFFECT_CAUSATION' and coalesce((data->>'is_current')::boolean,true) and (data->>'attack_claim_id'=cid or data->>'effect_claim_id'=cid) and lab_private.disposition_state('fact',id)<>'ACTIVE'),'[]'::jsonb) protected_facts
 ) select jsonb_build_object('locked',s<>'ACTIVE' or jsonb_array_length(locked_cases)>0 or jsonb_array_length(protected_facts)>0,
 'state',s,'fact_disposition',s,
 'protection_state',case when s<>'ACTIVE' then 'FACT_DISPOSITION' when jsonb_array_length(locked_cases)>0 then case when completed then 'INCIDENT_COMPLETED' else 'INCIDENT_DEFERRED' end when jsonb_array_length(protected_facts)>0 then 'DEPENDENCY_LOCKED' else 'UNLOCKED' end,
 'reason',case when s<>'ACTIVE' then (select reason from public.lab_disposition where target_type='fact' and target_id=cid) when jsonb_array_length(locked_cases)>0 then case when completed then 'Protected by a completed incident. A supervisor must reopen it before shared changes.' else 'Editing is locked in this deferred incident. A supervisor must reopen the incident first.' end when jsonb_array_length(protected_facts)>0 then 'A deferred or approved causal fact depends on this finding. Reopen the dependent fact before changing its evidence or determination.' end,
 'incident_ids',locked_cases,'incident_states',incident_states,'protected_fact_ids',protected_facts,'cause',case when s<>'ACTIVE' then 'fact' when jsonb_array_length(locked_cases)>0 then 'incident' when jsonb_array_length(protected_facts)>0 then 'dependency' else null end) from q
$$;

-- Shared facility operations protect accepted/completed cases and explicitly
-- locked shared facts. A deferred sibling alone is not a facility-wide veto.
-- If every linked case is deferred, retain the existing incident protection.
create or replace function lab_private.assert_facility_unlocked(fid text) returns void
language plpgsql set search_path=pg_catalog,public,lab_private as $$
declare r record; active_case boolean;begin
 select exists(select 1 from public.incident where lab_private.current_link(id,fid) and lab_private.incident_lock(id)->>'state'='ACTIVE') into active_case;
 for r in select id from public.incident where lab_private.current_link(id,fid) and (lab_private.incident_lock(id)->>'state'='APPROVED' or not active_case or exists(select 1 from public.lab_incident_workflow w where w.incident_id=incident.id and w.status in ('review_complete','supervisor_override'))) loop
  perform lab_private.assert_unlocked(lab_private.incident_lock(r.id));
 end loop;
 for r in select id from public.claim where facility_id=fid and data->>'claim_family' in ('IDENTITY','FACILITY_TYPE') and coalesce((data->>'is_current')::boolean,true) loop
  perform lab_private.assert_unlocked(lab_private.fact_lock(r.id));
 end loop;
end $$;

-- Conditional reads must observe changed lock semantics without touching rows.
create or replace function lab_private.workspace_version(actor uuid) returns text
language sql stable set search_path=pg_catalog,public as $$
 select encode(sha256(convert_to(jsonb_build_array(actor,'shared-fact-protection-012',
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
notify pgrst,'reload schema';
commit;
