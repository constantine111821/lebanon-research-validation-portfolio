-- Owner-authorized interim amendment. Disposable local/CI only; no hosted apply.
-- 007, factual records, task records, private drafts and historical reference bytes are preserved.
create table public.lab_claim_requirement (
 claim_id text primary key references public.claim(id),
 category text not null check(category in ('PHYSICAL_IDENTITY','FACILITY_TYPE','INFORMATIONAL')),
 authority text not null
);
alter table public.lab_claim_requirement enable row level security;
revoke all on public.lab_claim_requirement from public,anon,authenticated;
alter table public.lab_phase2_approval add column acceptance_snapshot jsonb;

create function lab_private.acceptance_readiness(iid text) returns jsonb
language sql stable set search_path=pg_catalog,public as $$
with facts as (
 select c.id,c.facility_id,c.data,coalesce(m.category,'INCIDENT_FACT') as category,
 lab_private.lab_reviewed(c.id) as reviewed,
 case when (d.state='DEFERRED' and lab_private.nonblank(d.reason)) or
  (w.dispositions->c.id->>'disposition' in ('deferred','unable_to_resolve','not_required') and lab_private.nonblank(w.dispositions->c.id->>'reason')) then 'waived'
  when lab_private.lab_reviewed(c.id) then 'reviewed' else 'outstanding' end as status,
 coalesce(d.reason,w.dispositions->c.id->>'reason') as reason
 from public.claim c join public.lab_incident_workflow w on w.incident_id=iid
 left join public.lab_claim_requirement m on m.claim_id=c.id
 left join public.lab_disposition d on d.target_type='fact' and d.target_id=c.id
 where coalesce((c.data->>'is_current')::boolean,true) and coalesce(c.data->>'identity_purpose','')<>'facility_comparison'
 and (coalesce(m.category,'')<>'INFORMATIONAL' or c.id=any(w.required_claim_ids))
 and (c.id=any(w.required_claim_ids) or not c.id=any(w.optional_claim_ids))
 and (c.incident_id=iid or (m.category in ('PHYSICAL_IDENTITY','FACILITY_TYPE') or c.id=any(w.required_claim_ids)) and lab_private.current_link(iid,c.facility_id))
), docs as (
 select jsonb_build_object('claim_id',id,'facility_id',facility_id,'category',category,'subject',data->>'subject','validation_state',data->>'validation_state','value',data->'current_verified_value','lab_reviewed',reviewed,'status',status,'reason',reason) as doc,* from facts
), allfacts as (select coalesce(jsonb_agg(doc order by id),'[]'::jsonb) as v from docs),
other as (
 select coalesce(jsonb_agg(jsonb_build_object('id','LOCATION:'||f.facility_id,'facility_id',f.facility_id,'category','LOCATION','status',case when coalesce((lab_private.facility_readiness(f.facility_id)->>'location_ready')::boolean,false) then 'reviewed' else 'outstanding' end) order by f.facility_id),'[]'::jsonb) as v
 from public.lab_facility_workflow f where f.location_required and lab_private.current_link(iid,f.facility_id)
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
 'facility_limitations',coalesce((select jsonb_agg(lab_private.facility_readiness(f.id) order by f.id) from public.facility f where lab_private.current_link(iid,f.id)),'[]'::jsonb))
from allfacts a cross join other o cross join tasks t
$$;

-- Informational findings only. Tasks are never completion/advancement blockers.
create or replace function lab_private.completion_issues(iid text) returns jsonb
language sql stable set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(jsonb_build_object('kind',case when x ? 'claim_id' then 'fact' else lower(x->>'category') end,'claim_id',x->>'claim_id','facility_id',x->>'facility_id','message',coalesce(x->>'subject','Recorded requirement remains outstanding; a supervisor may accept this limitation.'))),'[]'::jsonb)
 from jsonb_array_elements((lab_private.acceptance_readiness(iid)->'facts')||(lab_private.acceptance_readiness(iid)->'other_requirements')) x where x->>'status'='outstanding'
$$;
-- Substantive limitations can be accepted. Structural checks remain in lab_commit.
create or replace function lab_private.phase2_hard_issues(iid text) returns jsonb
language sql stable set search_path=pg_catalog,public as $$ select '[]'::jsonb $$;
create or replace function lab_private.phase2_approved(iid text) returns boolean
language sql stable set search_path=pg_catalog,public as $$
 select lab_private.disposition_state('incident',iid)<>'DEFERRED' and lab_private.phase2_completion_current(iid) and exists(
 select 1 from public.lab_phase2_approval a join public.incident i on i.id=a.incident_id
 where i.id=iid and a.status='APPROVED' and a.approved_incident_revision=i.revision and a.approved_by is not null and a.approved_at is not null and lab_private.nonblank(a.approval_reason))
$$;

alter function public.lab_commit(jsonb) set schema lab_private;
alter function lab_private.lab_commit(jsonb) rename to commit_pre008;
create function public.lab_commit(p_request jsonb) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,lab_private as $$
declare actor uuid:=lab_private.require_actor(false);p jsonb:=p_request->'payload';kindv text:=p_request->>'kind';iid text:=p_request->>'incident_id';op uuid;digestv text;prior public.lab_idempotency%rowtype;
 rev bigint;nextrev bigint;why text;ps text;reqid uuid;req public.lab_disposition_request%rowtype;w public.lab_incident_workflow%rowtype;a public.lab_phase2_approval%rowtype;
 bef jsonb;aft jsonb;summary jsonb;resultv jsonb;item jsonb;cid text;cat text;oldstate text;isaccept boolean;dep record;priorreview jsonb;
begin
 if jsonb_typeof(p_request) is distinct from 'object' or length(p_request::text)>2000000 then raise exception 'Submission is missing or exceeds the pilot limit.';end if;
 perform pg_advisory_xact_lock(749310091::bigint);
 op:=(p_request->>'operation_id')::uuid;if op is null then raise exception 'An operation ID is required.';end if;
 digestv:=encode(sha256(convert_to(p_request::text,'UTF8')),'hex');select * into prior from public.lab_idempotency where operation_id=op;
 if found then if prior.owner_id<>actor or prior.request_hash<>digestv then raise exception using errcode='23505',message='This submission ID has already been used for a different request.';end if;return prior.result;end if;
 isaccept:=kindv in ('complete_incident','approve_phase2') or kindv='set_disposition' and p->>'target_type'='incident' and p->>'action'='APPROVE';
 if isaccept then
  perform lab_private.require_actor(true);
  if not lab_private.nonblank(iid) or jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p_request->'expected_revision') is distinct from 'number' or (p_request->>'expected_revision')::numeric<>(p_request->>'expected_revision')::bigint or (p_request->>'expected_revision')::bigint<0 then raise exception 'Use an exact nonnegative incident revision and a valid incident.';end if;
  why:=p->>'reason';if jsonb_typeof(p->'reason') is distinct from 'string' or not lab_private.nonblank(why) or length(why)>4000 then raise exception 'Record an explicit supervisor reason of at most 4000 characters.';end if;
  if p->'attestation' is distinct from 'true'::jsonb then raise exception 'Explicit supervisor acceptance attestation is required.';end if;
  select revision into rev from public.incident where id=iid for update;
  if not found or rev<>(p_request->>'expected_revision')::bigint then raise exception using errcode='PT409',message='This incident changed. Reload the latest version before acceptance.';end if;
  select * into w from public.lab_incident_workflow where incident_id=iid for update;if not found then raise exception 'The incident workflow is missing.';end if;
  select * into a from public.lab_phase2_approval where incident_id=iid for update;
  ps:=lab_private.disposition_state('incident',iid);
  if ps='DEFERRED' then raise exception using errcode='PT423',message='Reopen the deferred incident before approval.',detail=lab_private.incident_lock(iid)::text;end if;
  if kindv='set_disposition' then
   if p->>'target_id' is distinct from iid or jsonb_typeof(p->'expected_target_revision') is distinct from 'number' or (p->>'expected_target_revision')::numeric<>(p->>'expected_target_revision')::bigint or (p->>'expected_target_revision')::bigint<>rev then raise exception using errcode='PT409',message='Disposition target or revision changed.';end if;
   if ps<>'ACTIVE' or lab_private.phase2_completion_current(iid) then raise exception 'Reopen approved work before another incident decision.';end if;
  elsif kindv='approve_phase2' then
   if jsonb_typeof(p->'expected_approval_revision') is distinct from 'number' or (p->>'expected_approval_revision')::numeric<>(p->>'expected_approval_revision')::bigint or (p->>'expected_approval_revision')::bigint<>coalesce(a.revision,0) then raise exception using errcode='PT409',message='Phase 2 approval changed. Reload the latest version.';end if;
   if p->>'mode' is null or p->>'mode' not in ('approve','defer_nonessential') then raise exception 'Choose an approval mode.';end if;
  elsif lab_private.incident_lock(iid)->>'locked'='true' then perform lab_private.assert_unlocked(lab_private.incident_lock(iid));
  end if;
  reqid:=nullif(p->>'request_id','')::uuid;
  if reqid is not null then
   select * into req from public.lab_disposition_request where id=reqid and incident_id=iid for update;
   if not found or req.status<>'PENDING' or req.requested_action<>'APPROVE' or req.incident_revision<>rev then raise exception using errcode='PT409',message='Request or incident changed; a fresh request decision is required.';end if;
  end if;
  summary:=lab_private.acceptance_readiness(iid);
  if length(summary::text)>1000000 then raise exception 'Acceptance snapshot exceeds the bounded pilot limit.';end if;
  bef:=jsonb_build_object('disposition',(select to_jsonb(d) from public.lab_disposition d where target_type='incident' and target_id=iid),'workflow',to_jsonb(w),'phase2',to_jsonb(a));nextrev:=rev+1;
  update public.incident set revision=nextrev where id=iid;
  update public.lab_incident_workflow set status='review_complete',revision=nextrev,
   completion=jsonb_build_object('supervisor',actor,'timestamp',clock_timestamp(),'reviewed_revision',rev,'completion_revision',nextrev,'reason',why,'override',false,'attestation',true,'policy','OWNER_AMENDMENT_008','acceptance_snapshot',summary,'unresolved_items',lab_private.completion_issues(iid),'previous_completion',w.completion,'previous_status',w.status) where incident_id=iid;
  insert into public.lab_phase2_approval(incident_id,approved_by,approved_at,approved_incident_revision,approval_reason,approval_mode,outstanding_tasks_at_approval,unresolved_facts_at_approval,status,changed_by,changed_at,change_reason,acceptance_snapshot)
  values(iid,actor,clock_timestamp(),nextrev,why,'approve',summary->'tasks',jsonb_build_object('outstanding',coalesce((select jsonb_agg(x) from jsonb_array_elements(summary->'facts') x where x->>'status'='outstanding'),'[]'::jsonb),'waived',coalesce((select jsonb_agg(x) from jsonb_array_elements(summary->'facts') x where x->>'status'='waived'),'[]'::jsonb),'unknown',summary->'unknown','conflicting',summary->'conflicting'),'APPROVED',actor,clock_timestamp(),why,summary)
  on conflict(incident_id) do update set approved_by=actor,approved_at=excluded.approved_at,approved_incident_revision=nextrev,approval_reason=why,approval_mode='approve',outstanding_tasks_at_approval=excluded.outstanding_tasks_at_approval,unresolved_facts_at_approval=excluded.unresolved_facts_at_approval,status='APPROVED',changed_by=actor,changed_at=excluded.changed_at,change_reason=why,acceptance_snapshot=summary,revision=public.lab_phase2_approval.revision+1;
  perform lab_private.write_disposition('incident',iid,'APPROVED',why);
  if reqid is not null then update public.lab_disposition_request set status='ACCEPTED',resolved_by=actor,resolved_at=clock_timestamp(),resolution_reason=why where id=reqid;end if;
  aft:=jsonb_build_object('disposition',(select to_jsonb(d) from public.lab_disposition d where target_type='incident' and target_id=iid),'workflow',(select to_jsonb(z) from public.lab_incident_workflow z where incident_id=iid),'phase2',(select to_jsonb(z) from public.lab_phase2_approval z where incident_id=iid),'acceptance_snapshot',summary);
  perform lab_private.disposition_event(op,iid,'incident',iid,'APPROVE',ps,'APPROVED',why,bef,aft,'[]'::jsonb,reqid);
  perform lab_private.audit(iid,'INCIDENT',iid,'validate','Supervisor accepted recorded incident for validated output',bef,aft,jsonb_build_object('policy','OWNER_AMENDMENT_008','operation_id',op,'attestation',true));
  resultv:=jsonb_build_object('operation_id',op,'incident_id',iid,'revision',nextrev,'status','review_complete','disposition','APPROVED','phase2_status','APPROVED','approval_revision',(select revision from public.lab_phase2_approval where incident_id=iid),'output_eligible',lab_private.phase2_approved(iid),'request_id',reqid,'created_ids','[]'::jsonb);
  insert into public.lab_idempotency(operation_id,owner_id,request_hash,result) values(op,actor,digestv,resultv);return resultv;
 end if;
 oldstate:=case when kindv='set_disposition' and p->>'target_type'='fact' then lab_private.disposition_state('fact',p->>'target_id') else null end;
 resultv:=lab_private.commit_pre008(p_request);
 -- Explicit categories are declared at new-facility intake. No family-only selection.
 if kindv='create_incident' and p->'new_facility' is not null and p->'new_facility'<>'null'::jsonb then
  for item in select value from jsonb_array_elements(coalesce(p->'changes','[]'::jsonb)) loop
   cat:=item->'claim'->>'requirement_category';cid:=item->'claim'->>'claim_id';
   if cat is not null then
    if cat not in ('PHYSICAL_IDENTITY','FACILITY_TYPE','INFORMATIONAL') or not exists(select 1 from public.claim c where c.id=cid and c.incident_id=iid and ((cat='PHYSICAL_IDENTITY' and c.data->>'claim_family'='IDENTITY') or (cat='FACILITY_TYPE' and c.data->>'claim_family'='FACILITY_TYPE') or cat='INFORMATIONAL')) then raise exception 'Invalid explicit facility requirement category.';end if;
    insert into public.lab_claim_requirement values(cid,cat,'Explicit canonical requirement declared at new facility intake');
   end if;
  end loop;
 end if;
 if kindv='set_disposition' and p->>'target_type'='fact' and p->>'action'='REOPEN' and oldstate='DEFERRED' then
  cid:=p->>'target_id';
  update public.claim set revision=revision+1 where id=cid;
  insert into public.lab_claim_workflow(claim_id,review_needed,lab_review_state) values(cid,true,'REOPENED') on conflict(claim_id) do update set review_needed=true,lab_review_state='REOPENED',revision=public.lab_claim_workflow.revision+1;
  perform lab_private.disposition_event(op,iid,'fact',cid,'REOPEN_WAIVER_REVIEW','ACTIVE','ACTIVE',p->>'reason',jsonb_build_object('prior_waiver','DEFERRED'),jsonb_build_object('review',(select to_jsonb(z) from public.lab_claim_workflow z where claim_id=cid)));
  for dep in select id from public.claim where data->>'claim_family'='ATTACK_TO_EFFECT_CAUSATION' and coalesce((data->>'is_current')::boolean,true) and (data->>'attack_claim_id'=cid or data->>'effect_claim_id'=cid) order by id loop
   select jsonb_build_object('claim',c.data,'review',to_jsonb(z),'disposition',lab_private.disposition_state('fact',dep.id)) into priorreview from public.claim c left join public.lab_claim_workflow z on z.claim_id=c.id where c.id=dep.id;
   update public.claim set revision=revision+1 where id=dep.id;
   insert into public.lab_claim_workflow(claim_id,review_needed,lab_review_state) values(dep.id,true,'REOPENED') on conflict(claim_id) do update set review_needed=true,lab_review_state='REOPENED',revision=public.lab_claim_workflow.revision+1;
   if lab_private.disposition_state('fact',dep.id)='APPROVED' then perform lab_private.write_disposition('fact',dep.id,'ACTIVE','Dependent factual review reopened: '||(p->>'reason'));end if;
   perform lab_private.disposition_event(op,iid,'fact',dep.id,'INVALIDATE_FACT_DEPENDENCY',priorreview->>'disposition',lab_private.disposition_state('fact',dep.id),p->>'reason',priorreview,jsonb_build_object('review',(select to_jsonb(z) from public.lab_claim_workflow z where claim_id=dep.id),'claim',(select data from public.claim where id=dep.id)),jsonb_build_array(jsonb_build_object('reopened_claim_id',cid)));
  end loop;
 end if;
 return resultv;
end $$;

alter function public.lab_snapshot() set schema lab_private;
alter function lab_private.lab_snapshot() rename to snapshot_pre008;
create function public.lab_snapshot() returns jsonb language plpgsql security definer set search_path=pg_catalog,public,lab_private as $$
declare s jsonb;begin
 perform lab_private.require_actor(false);s:=lab_private.snapshot_pre008();
 return s||jsonb_build_object('acceptance_policy','OWNER_AMENDMENT_008','requirement_categories',coalesce((select jsonb_object_agg(claim_id,category) from public.lab_claim_requirement),'{}'::jsonb),'acceptance_readiness',coalesce((select jsonb_object_agg(id,lab_private.acceptance_readiness(id)) from public.incident),'{}'::jsonb),'output_eligibility',coalesce((select jsonb_object_agg(id,lab_private.phase2_approved(id)) from public.incident),'{}'::jsonb));
end $$;
revoke all on all functions in schema lab_private from public,anon,authenticated;
grant execute on function lab_private.active_user() to authenticated;
revoke all on function public.lab_commit(jsonb),public.lab_snapshot() from public,anon;
grant execute on function public.lab_commit(jsonb),public.lab_snapshot() to authenticated;
