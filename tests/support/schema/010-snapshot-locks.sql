-- Equivalent 012 protection lookup with bounded candidate IDs. No policy or row changes.
-- Local successor reliability correction; hosted application remains unauthorized.
begin;
select pg_advisory_xact_lock(749310091::bigint);
create or replace function lab_private.fact_lock(cid text) returns jsonb
language sql stable set search_path=pg_catalog,public,lab_private as $$
 with subject as materialized (
  select c.id,c.incident_id,c.facility_id,c.data->>'claim_family' family,
   coalesce(c.data->>'claim_family' in ('IDENTITY','FACILITY_TYPE'),false) shared
  from public.claim c where c.id=cid
 ), candidate_ids as materialized (
  select f.incident_id id from subject c join public.incident_facility f on f.facility_id=c.facility_id
   where c.shared and coalesce((f.data->>'is_current')::boolean,true)
  union
  select c.incident_id from subject c where not c.shared
  union
  select w.incident_id from subject c join public.lab_incident_workflow w on c.id=any(w.required_claim_ids)
 ), candidate_locks as materialized (
  select i.id,c.incident_id origin_id,c.family,lab_private.incident_lock(i.id) l
  from candidate_ids k join public.incident i on i.id=k.id cross join subject c
 ), candidates as materialized (
  select id,l from candidate_locks c where l->>'state'='APPROVED'
   or exists(select 1 from public.lab_incident_workflow w where w.incident_id=c.id and w.status in ('review_complete','supervisor_override'))
   or (id=origin_id and family not in ('IDENTITY','FACILITY_TYPE'))
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
notify pgrst,'reload schema';
commit;
