-- Snapshot-only bounded read composition, measured to avoid the inherited8s timeout.
-- Acceptance and mutation handlers remain unchanged. No data or ACL widening.
begin;
select pg_advisory_xact_lock(749310091::bigint);
create index claim_current_causal_attack_successor on public.claim ((data->>'attack_claim_id')) where data->>'claim_family'='ATTACK_TO_EFFECT_CAUSATION' and coalesce((data->>'is_current')::boolean,true);
create index claim_current_causal_effect_successor on public.claim ((data->>'effect_claim_id')) where data->>'claim_family'='ATTACK_TO_EFFECT_CAUSATION' and coalesce((data->>'is_current')::boolean,true);
create index lab_incident_required_claims_successor on public.lab_incident_workflow using gin(required_claim_ids);

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
  select w.incident_id from subject c join public.lab_incident_workflow w on w.required_claim_ids @> array[c.id]
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

create or replace function lab_private.snapshot_readiness(iid text,facility_states jsonb) returns jsonb
language sql stable set search_path=pg_catalog,public as $$
with linked_facilities as materialized (
 select distinct facility_id from public.incident_facility where incident_id=iid and coalesce((data->>'is_current')::boolean,true)
), scoped_claims as materialized (
 select c.id from public.claim c where c.incident_id=iid
 union
 select c.id from linked_facilities f join public.claim c on c.facility_id=f.facility_id
), facts_input as materialized (
 select c.id,c.facility_id,c.data,coalesce(m.category,'INCIDENT_FACT') as category,
 lab_private.lab_reviewed(c.id) as reviewed,d.state disposition_state,d.reason disposition_reason,w.dispositions
 from scoped_claims k join public.claim c on c.id=k.id join public.lab_incident_workflow w on w.incident_id=iid
 left join public.lab_claim_requirement m on m.claim_id=c.id
 left join public.lab_disposition d on d.target_type='fact' and d.target_id=c.id
 where coalesce((c.data->>'is_current')::boolean,true) and coalesce(c.data->>'identity_purpose','')<>'facility_comparison'
 and (coalesce(m.category,'')<>'INFORMATIONAL' or c.id=any(w.required_claim_ids))
 and (c.id=any(w.required_claim_ids) or not c.id=any(w.optional_claim_ids))
 and (c.incident_id=iid or (m.category in ('PHYSICAL_IDENTITY','FACILITY_TYPE') or c.id=any(w.required_claim_ids)) and exists(select 1 from linked_facilities z where z.facility_id=c.facility_id))
), facts as (
 select id,facility_id,data,category,reviewed,
 case when (disposition_state='DEFERRED' and lab_private.nonblank(disposition_reason)) or
  (dispositions->id->>'disposition' in ('deferred','unable_to_resolve','not_required') and lab_private.nonblank(dispositions->id->>'reason')) then 'waived'
  when reviewed then 'reviewed' else 'outstanding' end status,
 coalesce(disposition_reason,dispositions->id->>'reason') reason from facts_input
), docs as (
 select jsonb_build_object('claim_id',id,'facility_id',facility_id,'category',category,'subject',data->>'subject','validation_state',data->>'validation_state','value',data->'current_verified_value','lab_reviewed',reviewed,'status',status,'reason',reason) as doc,* from facts
), allfacts as (select coalesce(jsonb_agg(doc order by id),'[]'::jsonb) as v from docs),
other as (
 select coalesce(jsonb_agg(jsonb_build_object('id','LOCATION:'||f.facility_id,'facility_id',f.facility_id,'category','LOCATION','status',case when coalesce(((facility_states->f.facility_id)->>'location_ready')::boolean,false) then 'reviewed' else 'outstanding' end) order by f.facility_id),'[]'::jsonb) as v
 from linked_facilities k join public.lab_facility_workflow f on f.facility_id=k.facility_id where f.location_required
), tasks as (
 select coalesce(jsonb_agg(jsonb_build_object('gap_task_id',g.id,'claim_id',g.claim_id,'state',coalesce(t.lab_task_state,'NOT_ASSESSED'),'revision',coalesce(t.revision,0),'reason',t.reason,'question',g.data->>'factual_question','historical_status',g.data->>'status') order by g.id),'[]'::jsonb) as v
 from public.gap_task g left join public.lab_task_workflow t on t.gap_task_id=g.id where g.incident_id=iid
)
select jsonb_build_object('policy','OWNER_AMENDMENT_008','incident_id',iid,
 'classification',(select data->>'incident_type' from public.incident where id=iid),'facts',a.v,
 'incident_facts',coalesce((select jsonb_agg(doc order by id) from docs where category='INCIDENT_FACT'),'[]'::jsonb),
 'shared_facility_requirements',coalesce((select jsonb_agg(doc order by id) from docs where category<>'INCIDENT_FACT'),'[]'::jsonb),
 'other_requirements',o.v,'tasks',t.v,'total',(select count(*) from facts),
 'reviewed',(select count(*) from facts where status='reviewed'),'waived',(select count(*) from facts where status='waived'),'outstanding',(select count(*) from facts where status='outstanding'),
 'unknown',coalesce((select jsonb_agg(doc order by id) from docs where data->'current_verified_value' is null or data->'current_verified_value'='null'::jsonb),'[]'::jsonb),
 'conflicting',coalesce((select jsonb_agg(doc order by id) from docs where data->>'validation_state'='CONFLICTING'),'[]'::jsonb),
 'requirements_assessed',coalesce((select requirements_assessed from public.lab_incident_workflow where incident_id=iid),false),
 'facility_limitations',coalesce((select jsonb_agg((facility_states->f.id) order by f.id) from linked_facilities k join public.facility f on f.id=k.facility_id),'[]'::jsonb))
from allfacts a cross join other o cross join tasks t
$$;

revoke all on function lab_private.snapshot_readiness(text,jsonb) from public,anon,authenticated,service_role;

create or replace function lab_private.snapshot_fact_lock(cid text,incident_states_map jsonb) returns jsonb
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
  select w.incident_id from subject c join public.lab_incident_workflow w on w.required_claim_ids @> array[c.id]
 ), candidate_locks as materialized (
  select i.id,c.incident_id origin_id,c.family,(incident_states_map->i.id) l
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

revoke all on function lab_private.snapshot_fact_lock(text,jsonb) from public,anon,authenticated,service_role;

-- Snapshot-only composition. Original write/acceptance functions remain intact.
create or replace function public.lab_snapshot() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,lab_private as $$
declare actor uuid:=lab_private.require_actor(false); n text; rowsv jsonb; revs jsonb;
 records jsonb:='{}'; revisions jsonb:='{}'; wi jsonb; wc jsonb; ds jsonb; profile jsonb;
 fs jsonb; readiness jsonb; incident_locks jsonb; s jsonb;
begin
 perform pg_advisory_xact_lock_shared(749310091::bigint);
 select jsonb_object_agg(id,lab_private.incident_lock(id)) into incident_locks from public.incident;
 select coalesce(jsonb_object_agg(id,lab_private.facility_readiness(id)),'{}'::jsonb) into fs from public.facility;
 select coalesce(jsonb_object_agg(id,lab_private.snapshot_readiness(id,fs)),'{}'::jsonb) into readiness from public.incident;
 foreach n in array array['facility','incident','incident_facility','query','query_hit','source','claim','claim_source','gap_task','activity_log'] loop
  execute format('select coalesce(jsonb_agg(data order by id),''[]''::jsonb),coalesce(jsonb_object_agg(id,revision),''{}''::jsonb) from public.%I',n) into rowsv,revs;
  records:=records||jsonb_build_object(upper(n),rowsv);revisions:=revisions||jsonb_build_object(upper(n),revs);
 end loop;
 with identity_flags as materialized (
  select w.incident_id,to_jsonb(w) data,
   exists(select 1 from public.incident_facility x where x.incident_id=w.incident_id and coalesce((x.data->>'is_current')::boolean,true))
   and not exists(select 1 from public.incident_facility x where x.incident_id=w.incident_id and coalesce((x.data->>'is_current')::boolean,true) and not (fs->x.facility_id->>'identity_ready')::boolean) identity_ready
  from public.lab_incident_workflow w
 ), facility_flags as materialized (
  select *,identity_ready and not exists(select 1 from public.incident_facility x where x.incident_id=w.incident_id and coalesce((x.data->>'is_current')::boolean,true) and not (fs->x.facility_id->>'downstream_ready')::boolean) facility_ready from identity_flags w
 )
 select coalesce(jsonb_object_agg(incident_id,data||jsonb_build_object(
  'completion_issues',(select coalesce(jsonb_agg(jsonb_build_object('kind',case when x ? 'claim_id' then 'fact' else lower(x->>'category') end,'claim_id',x->>'claim_id','facility_id',x->>'facility_id','message',coalesce(x->>'subject','Recorded requirement remains outstanding; a supervisor may accept this limitation.'))),'[]'::jsonb) from jsonb_array_elements((readiness->incident_id->'facts')||(readiness->incident_id->'other_requirements')) x where x->>'status'='outstanding'),
  'identity_ready',identity_ready,'facility_ready',facility_ready,
  'downstream_ready',data->>'status' in ('review_complete','supervisor_override') and coalesce((data->'completion'->>'completion_revision')::bigint,0)=(revisions->'INCIDENT'->>incident_id)::bigint and facility_ready and
   (select case when i.data->>'incident_type' in ('kinetic episode','combined supported causal episode') then exists(select 1 from public.claim c where c.incident_id=w.incident_id and c.data->>'claim_family'='KINETIC_EVENT' and c.data->'current_verified_value'='true'::jsonb and lab_private.lab_eligible(c.id)) else i.data->>'incident_type'='operational episode' end from public.incident i where i.id=w.incident_id)
 )),'{}'::jsonb) into wi from facility_flags w;
 select coalesce(jsonb_object_agg(claim_id,to_jsonb(w)),'{}'::jsonb) into wc from public.lab_claim_workflow w;
 select coalesce(jsonb_agg(to_jsonb(d) order by updated_at desc),'[]'::jsonb) into ds from public.lab_private_drafts d where owner_id=actor;
 select to_jsonb(p) into profile from public.lab_profiles p where user_id=actor;
 s:=jsonb_build_object('records',records,'revisions',revisions,'profile',profile,'drafts',ds,
  'classifications',(select data from public.lab_seed_metadata where id='approved_classifications'),
  'source_excerpts',(select data from public.lab_seed_metadata where id='approved_source_excerpts'),
  'seed_metadata',(select coalesce(jsonb_object_agg(id,data),'{}'::jsonb) from public.lab_seed_metadata),
  'workflow',jsonb_build_object('incidents',wi,'claims',wc,'facilities',fs,
   'tasks',(select coalesce(jsonb_object_agg(gap_task_id,to_jsonb(w)),'{}'::jsonb) from public.lab_task_workflow w),
   'facility_resolutions',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('is_current',lab_private.facility_resolution_current(r.id),'reopening',(select to_jsonb(x) from public.lab_facility_resolution_reopening x where x.resolution_id=r.id)) order by r.reviewed_at,r.id),'[]'::jsonb) from public.lab_facility_resolution r),
   'facility_resolution_reopenings',(select coalesce(jsonb_agg(to_jsonb(x) order by reopened_at,id),'[]'::jsonb) from public.lab_facility_resolution_reopening x)),
  'assignments',(select coalesce(jsonb_object_agg(incident_id,to_jsonb(a)),'{}'::jsonb) from public.lab_case_assignment a),
  'team',(select coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'display_name',display_name,'role',role,'active',active) order by display_name,user_id),'[]'::jsonb) from public.lab_profiles where active),
  'phase2_approvals',(select coalesce(jsonb_object_agg(incident_id,to_jsonb(a)),'{}'::jsonb) from public.lab_phase2_approval a),
  'dispositions',jsonb_build_object('facts',coalesce((select jsonb_object_agg(target_id,to_jsonb(d)) from public.lab_disposition d where target_type='fact'),'{}'),'incidents',coalesce((select jsonb_object_agg(target_id,to_jsonb(d)) from public.lab_disposition d where target_type='incident'),'{}')),
  'disposition_locks',jsonb_build_object('facts',(select jsonb_object_agg(id,lab_private.snapshot_fact_lock(id,incident_locks)) from public.claim),'incidents',incident_locks),
  'disposition_requests',coalesce((select jsonb_agg(to_jsonb(r) order by created_at,id) from public.lab_disposition_request r),'[]'),
  'disposition_history',coalesce((select jsonb_agg(to_jsonb(h) order by occurred_at,id) from public.lab_disposition_history h),'[]'),
  'acceptance_policy','OWNER_AMENDMENT_008',
  'requirement_categories',coalesce((select jsonb_object_agg(claim_id,category) from public.lab_claim_requirement),'{}'::jsonb),
  'acceptance_readiness',readiness,
  'output_eligibility',coalesce((select jsonb_object_agg(id,lab_private.phase2_approved(id)) from public.incident),'{}'::jsonb));
 return s;
end $$;

notify pgrst,'reload schema';
commit;
