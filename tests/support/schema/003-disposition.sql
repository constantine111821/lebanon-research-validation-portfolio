-- Pass 3: authorized for disposable local environments only.
-- Extend the accepted transaction engine; historical factual records remain intact.
create table public.lab_disposition (
 target_type text not null check(target_type in ('fact','incident')),
 target_id text not null,
 state text not null default 'ACTIVE' check(state in ('ACTIVE','DEFERRED','APPROVED')),
 reason text, actor uuid references auth.users(id), decided_at timestamptz,
 revision bigint not null default 0, initialized boolean not null default true,
 primary key(target_type,target_id)
);
insert into public.lab_disposition(target_type,target_id) select 'fact',id from public.claim;
insert into public.lab_disposition(target_type,target_id) select 'incident',id from public.incident;
create function lab_private.initialize_disposition() returns trigger language plpgsql set search_path=public,lab_private,pg_temp as $$ begin
 insert into public.lab_disposition(target_type,target_id) values(case when TG_TABLE_NAME='claim' then 'fact' else 'incident' end,new.id) on conflict do nothing;return new;
end $$;
create trigger claim_initialize_disposition after insert on public.claim for each row execute function lab_private.initialize_disposition();
create trigger incident_initialize_disposition after insert on public.incident for each row execute function lab_private.initialize_disposition();
create table public.lab_disposition_request (
 id uuid primary key default gen_random_uuid(), incident_id text not null references public.incident(id),
 requester uuid not null references auth.users(id), requested_action text not null check(requested_action in ('DEFER','APPROVE')),
 explanation text not null check(length(trim(explanation)) between 1 and 4000), incident_revision bigint not null,
 status text not null default 'PENDING' check(status in ('PENDING','ACCEPTED','DECLINED')),
 created_at timestamptz not null default clock_timestamp(), resolved_at timestamptz, resolved_by uuid references auth.users(id), resolution_reason text
);
create unique index lab_disposition_request_pending on public.lab_disposition_request(incident_id,requester,requested_action,incident_revision) where status='PENDING';
create table public.lab_disposition_history (
 id uuid primary key default gen_random_uuid(), operation_id uuid not null,
 incident_id text not null references public.incident(id), target_type text not null, target_id text not null,
 actor uuid not null references auth.users(id), occurred_at timestamptz not null default clock_timestamp(),
 action text not null, prior_state text, new_state text, reason text not null,
 revision bigint not null, request_id uuid references public.lab_disposition_request(id),
 before_state jsonb, after_state jsonb, invalidation jsonb not null default '[]'
);
create index lab_disposition_history_target on public.lab_disposition_history(target_type,target_id,occurred_at);
create trigger disposition_history_no_rewrite before update or delete on public.lab_disposition_history for each row execute function lab_private.immutable_history();
alter table public.lab_disposition enable row level security;
alter table public.lab_disposition_request enable row level security;
alter table public.lab_disposition_history enable row level security;
revoke all on public.lab_disposition,public.lab_disposition_request,public.lab_disposition_history from public,anon,authenticated;
-- Reads and writes go through the existing active-profile RPC boundary.

create function lab_private.disposition_state(tt text, tid text) returns text language sql stable set search_path=public,lab_private,pg_temp as $$
 select coalesce((select state from public.lab_disposition where target_type=tt and target_id=tid),'ACTIVE')
$$;
create function lab_private.incident_lock(iid text) returns jsonb language sql stable set search_path=public,lab_private,pg_temp as $$
 select jsonb_build_object('locked',s<>'ACTIVE','state',s,'reason',coalesce(d.reason,case when s='APPROVED' then 'Existing incident completion requires supervisor reopening.' end))
 from (select case when lab_private.disposition_state('incident',iid)<>'ACTIVE' then lab_private.disposition_state('incident',iid)
 when exists(select 1 from public.lab_incident_workflow where incident_id=iid and status in ('review_complete','supervisor_override')) then 'APPROVED' else 'ACTIVE' end s) q
 left join public.lab_disposition d on d.target_type='incident' and d.target_id=iid
$$;
create function lab_private.fact_lock(cid text) returns jsonb language sql stable set search_path=public,lab_private,pg_temp as $$
 select jsonb_build_object('locked',s<>'ACTIVE' or jsonb_array_length(locked_cases)>0 or jsonb_array_length(protected_facts)>0,'state',case when s<>'ACTIVE' then s when jsonb_array_length(locked_cases)>0 then lab_private.incident_lock(locked_cases->>0)->>'state' when jsonb_array_length(protected_facts)>0 then 'DEPENDENCY_LOCKED' else 'ACTIVE' end,
 'reason',case when s<>'ACTIVE' then (select reason from public.lab_disposition where target_type='fact' and target_id=cid) when jsonb_array_length(locked_cases)>0 then 'This shared fact is protected by an incident disposition or completion. Reopen the protected incident first.' when jsonb_array_length(protected_facts)>0 then 'A deferred or approved causal fact depends on this finding. Reopen the dependent fact before changing its evidence or determination.' end,
 'incident_ids',locked_cases,'protected_fact_ids',protected_facts,'cause',case when s<>'ACTIVE' then 'fact' when jsonb_array_length(locked_cases)>0 then 'incident' when jsonb_array_length(protected_facts)>0 then 'dependency' else null end)
 from (select lab_private.disposition_state('fact',cid) s,coalesce((select jsonb_agg(id order by id) from public.incident where lab_private.fact_in_scope(cid,id) and (lab_private.incident_lock(id)->>'locked')::boolean),'[]') locked_cases,
 coalesce((select jsonb_agg(id order by id) from public.claim where data->>'claim_family'='ATTACK_TO_EFFECT_CAUSATION' and coalesce((data->>'is_current')::boolean,true) and (data->>'attack_claim_id'=cid or data->>'effect_claim_id'=cid) and lab_private.disposition_state('fact',id)<>'ACTIVE'),'[]') protected_facts) q
$$;
create function lab_private.assert_unlocked(lockv jsonb) returns void language plpgsql set search_path=public,lab_private,pg_temp as $$ begin
 if coalesce((lockv->>'locked')::boolean,false) then raise exception using errcode='PT423',message=coalesce(lockv->>'reason','Supervisor reopening is required.'),detail=lockv::text;end if;
end $$;
create function lab_private.assert_facility_unlocked(fid text) returns void language plpgsql set search_path=public,lab_private,pg_temp as $$ declare r record;begin
 for r in select id from public.incident where lab_private.current_link(id,fid) loop perform lab_private.assert_unlocked(lab_private.incident_lock(r.id));end loop;
 for r in select id from public.claim where facility_id=fid and data->>'claim_family' in ('IDENTITY','FACILITY_TYPE') and coalesce((data->>'is_current')::boolean,true) loop perform lab_private.assert_unlocked(lab_private.fact_lock(r.id));end loop;
end $$;
create function lab_private.disposition_event(op uuid,iid text,tt text,tid text,act text,ps text,ns text,why text,bef jsonb,aft jsonb,inv jsonb default '[]',req uuid default null) returns void language plpgsql set search_path=public,lab_private,pg_temp as $$ begin
 insert into public.lab_disposition_history(operation_id,incident_id,target_type,target_id,actor,action,prior_state,new_state,reason,revision,request_id,before_state,after_state,invalidation)
 values(op,iid,tt,tid,auth.uid(),act,ps,ns,why,(select revision from public.incident where id=iid),req,bef,aft,inv);
 perform lab_private.audit(iid,case when tt='fact' then 'CLAIM' else 'INCIDENT' end,tid,'revise','Disposition workflow: '||act,bef,aft,jsonb_build_object('disposition',true,'action',act,'reason',why,'prior_state',ps,'new_state',ns,'request_id',req,'invalidation',inv));
end $$;
create function lab_private.write_disposition(tt text,tid text,ns text,why text) returns void language sql set search_path=public,lab_private,pg_temp as $$
 insert into public.lab_disposition(target_type,target_id,state,reason,actor,decided_at,revision,initialized) values(tt,tid,ns,why,auth.uid(),clock_timestamp(),1,false)
 on conflict(target_type,target_id) do update set state=ns,reason=why,actor=auth.uid(),decided_at=clock_timestamp(),revision=public.lab_disposition.revision+1,initialized=false
$$;
-- A shared fact's dependent completions/approvals are invalidated in this same transaction.
create function lab_private.invalidate_disposition_dependents(cid text,origin text,op uuid,why text) returns jsonb language plpgsql set search_path=public,lab_private,pg_temp as $$
declare r record;b jsonb;a jsonb;inv jsonb:='[]';ps text;begin
 for r in select id from public.incident where lab_private.fact_in_scope(cid,id) order by id loop
  select jsonb_build_object('workflow',to_jsonb(w),'phase2',to_jsonb(p),'disposition',lab_private.disposition_state('incident',r.id)) into b from public.lab_incident_workflow w left join public.lab_phase2_approval p on p.incident_id=w.incident_id where w.incident_id=r.id;
  if r.id<>origin then update public.incident set revision=revision+1 where id=r.id;end if;
  update public.lab_incident_workflow set revision=(select revision from public.incident where id=r.id),status=case when status in ('review_complete','supervisor_override') then 'reopened' else status end where incident_id=r.id;
  update public.lab_phase2_approval set status='NEEDS_REAPPROVAL',revision=revision+1,changed_by=auth.uid(),changed_at=clock_timestamp(),change_reason=why where incident_id=r.id and status='APPROVED';
  ps:=lab_private.disposition_state('incident',r.id);
  if ps='APPROVED' then perform lab_private.write_disposition('incident',r.id,'ACTIVE',why);end if;
  select jsonb_build_object('workflow',to_jsonb(w),'phase2',to_jsonb(p),'disposition',lab_private.disposition_state('incident',r.id)) into a from public.lab_incident_workflow w left join public.lab_phase2_approval p on p.incident_id=w.incident_id where w.incident_id=r.id;
  inv:=inv||jsonb_build_array(jsonb_build_object('incident_id',r.id,'before',b,'after',a));
  perform lab_private.disposition_event(op,r.id,'incident',r.id,'INVALIDATE_DEPENDENCY',ps,lab_private.disposition_state('incident',r.id),why,b,a,jsonb_build_array(jsonb_build_object('claim_id',cid)));
 end loop;return inv;end $$;

alter function public.lab_commit(jsonb) set schema lab_private;
alter function lab_private.lab_commit(jsonb) rename to commit_pre007;
alter function public.lab_snapshot() set schema lab_private;
alter function lab_private.lab_snapshot() rename to snapshot_pre007;

create function public.lab_commit(p_request jsonb) returns jsonb language plpgsql security definer set search_path=public,lab_private,pg_temp as $$
declare actor uuid:=lab_private.require_actor(false);op uuid;kindv text:=p_request->>'kind';p jsonb:=p_request->'payload';iid text:=p_request->>'incident_id';
 digestv text;prior public.lab_idempotency%rowtype;rev bigint;resultv jsonb;inner_request jsonb;tt text;tid text;act text;ps text;ns text;why text;targetrev bigint;
 bef jsonb;aft jsonb;inv jsonb:='[]';req public.lab_disposition_request%rowtype;reqid uuid;ch jsonb;cid text;fid text;r record;reviewv jsonb;
begin
 if jsonb_typeof(p_request) is distinct from 'object' or length(p_request::text)>2000000 or jsonb_typeof(p) is distinct from 'object' then raise exception 'Submit a bounded command and payload.';end if;
 perform pg_advisory_xact_lock(749310091::bigint);
 op:=(p_request->>'operation_id')::uuid;if op is null then raise exception 'An operation ID is required.';end if;
 digestv:=encode(sha256(convert_to(p_request::text,'UTF8')),'hex');select * into prior from public.lab_idempotency where operation_id=op;
 if found then if prior.owner_id<>actor or prior.request_hash<>digestv then raise exception using errcode='23505',message='This submission ID has already been used for a different request.';end if;return prior.result;end if;
 if kindv not in ('set_disposition','request_disposition','decline_disposition_request') then
 -- Existing commands remain governed by the same locks, including supervisor use.
 if kindv='complete_incident' then perform lab_private.require_actor(true);end if;
 if kindv not in ('reopen_incident','approve_phase2','revoke_phase2','assign_case') then perform lab_private.assert_unlocked(lab_private.incident_lock(iid));end if;
 if kindv='approve_phase2' and lab_private.disposition_state('incident',iid)='DEFERRED' then perform lab_private.assert_unlocked(lab_private.incident_lock(iid));end if;
 if kindv in ('submit_changes','create_incident') then
  for ch in select value from jsonb_array_elements(p->'changes') loop
   cid:=case when ch->>'type'='task' then coalesce(ch->'task'->>'claim_id',(select claim_id from public.gap_task where id=ch->'task'->>'gap_task_id')) else ch->>'claim_id' end;
   if cid is not null then perform lab_private.assert_unlocked(lab_private.fact_lock(cid));end if;
   if ch->>'type'='new_fact' and ch->'claim'->>'claim_family' in ('IDENTITY','FACILITY_TYPE') then
    fid:=ch->'claim'->>'facility_id';
    perform lab_private.assert_facility_unlocked(fid);
   end if;
   if ch->>'type'='evidence' and ch->>'source_id' is not null and ch->'source' is not null and ch->'source'<>'null'::jsonb then raise exception 'Existing shared sources are immutable. Reuse the source ID unchanged or add a distinct source.';end if;
  end loop;
 end if;
 if kindv in ('resolve_facility','reopen_facility_identity','review_location','facility_evidence') then
  for fid in select distinct value from unnest(array[p->>'facility_id',p->>'target_facility_id',(select target_facility_id from public.lab_facility_resolution where id=p->>'resolution_id')]) value where value is not null loop
   perform lab_private.assert_facility_unlocked(fid);
  end loop;
 end if;
 if kindv='create_incident' and jsonb_typeof(p->'facility_evidence')='array' and jsonb_array_length(p->'facility_evidence')>0 then perform lab_private.assert_facility_unlocked(p->>'facility_id');end if;
 if kindv='update_requirements' and jsonb_typeof(p->'facility_requirements')='object' then
  for fid in select jsonb_object_keys(p->'facility_requirements') loop perform lab_private.assert_facility_unlocked(fid);end loop;
 end if;
 end if;
 if kindv='create_incident' then return lab_private.commit_pre007(p_request);end if;
 if jsonb_typeof(p_request->'expected_revision') is distinct from 'number' or (p_request->>'expected_revision')::numeric<>(p_request->>'expected_revision')::bigint then raise exception 'An exact incident revision is required.';end if;
 select revision into rev from public.incident where id=iid for update;
 if not found or rev<>(p_request->>'expected_revision')::bigint then raise exception using errcode='PT409',message='This incident changed. Reload the latest version.';end if;
 if kindv in ('request_disposition','decline_disposition_request') then
  if kindv='request_disposition' then
   if not exists(select 1 from public.lab_profiles where user_id=actor and role='researcher') then raise exception 'Only researchers submit supervisor disposition requests.';end if;
   if p->>'requested_action' is null or p->>'requested_action' not in ('DEFER','APPROVE') or jsonb_typeof(p->'explanation') is distinct from 'string' or length(trim(p->>'explanation')) not between 1 and 4000 then raise exception 'Choose a request action and record an explanation of at most 4000 characters.';end if;
   perform lab_private.assert_unlocked(lab_private.incident_lock(iid));
   insert into public.lab_disposition_request(incident_id,requester,requested_action,explanation,incident_revision) values(iid,actor,p->>'requested_action',p->>'explanation',rev)
    on conflict(incident_id,requester,requested_action,incident_revision) where status='PENDING' do nothing returning id into reqid;
   if reqid is null then
    select * into req from public.lab_disposition_request where incident_id=iid and requester=actor and requested_action=p->>'requested_action' and incident_revision=rev and status='PENDING';reqid:=req.id;
    if req.explanation is distinct from p->>'explanation' then raise exception using errcode='PT409',message='A pending request already exists with a different explanation. Review that request before submitting another rationale.';end if;
   else perform lab_private.disposition_event(op,iid,'incident',iid,'REQUEST_'||(p->>'requested_action'),'ACTIVE','ACTIVE',p->>'explanation',null,jsonb_build_object('request_id',reqid),'[]',reqid);end if;
  else
   perform lab_private.require_actor(true);why:=p->>'reason';if jsonb_typeof(p->'reason') is distinct from 'string' or length(trim(why)) not between 1 and 4000 then raise exception 'Record a decline reason of at most 4000 characters.';end if;
   reqid:=(p->>'request_id')::uuid;select * into req from public.lab_disposition_request where id=reqid and incident_id=iid for update;
   if not found or req.status<>'PENDING' then raise exception using errcode='PT409',message='This request is no longer pending.';end if;
   update public.lab_disposition_request set status='DECLINED',resolved_by=actor,resolved_at=clock_timestamp(),resolution_reason=why where id=reqid;
   perform lab_private.disposition_event(op,iid,'incident',iid,'DECLINE_REQUEST',lab_private.disposition_state('incident',iid),lab_private.disposition_state('incident',iid),why,to_jsonb(req),(select to_jsonb(q) from public.lab_disposition_request q where id=reqid),'[]',reqid);
  end if;
  resultv:=jsonb_build_object('operation_id',op,'incident_id',iid,'revision',rev,'request_id',reqid,'created_ids','[]'::jsonb);
  insert into public.lab_idempotency(operation_id,owner_id,request_hash,result) values(op,actor,digestv,resultv);return resultv;
 end if;
 if kindv='set_disposition' then
  perform lab_private.require_actor(true);tt:=p->>'target_type';tid:=p->>'target_id';act:=p->>'action';why:=p->>'reason';
  if tt is null or tt not in ('fact','incident') or act is null or act not in ('DEFER','APPROVE','REOPEN') or jsonb_typeof(p->'reason') is distinct from 'string' or length(trim(why)) not between 1 and 4000 then raise exception 'Choose a target, action and explicit supervisor reason of at most 4000 characters.';end if;
  if act<>'REOPEN' and p->'attestation' is distinct from 'true'::jsonb then raise exception 'Explicitly attest that you reviewed this target and its available evidence.';end if;
  if tt='incident' then if tid is distinct from iid then raise exception 'Incident target does not match this case.';end if;targetrev:=rev;
  else perform lab_private.assert_claim_scope(tid,iid);select revision into targetrev from public.claim where id=tid for update;end if;
  if jsonb_typeof(p->'expected_target_revision') is distinct from 'number' or (p->>'expected_target_revision')::numeric<>targetrev then raise exception using errcode='PT409',message='The disposition target changed. Reload the latest version.';end if;
  ps:=lab_private.disposition_state(tt,tid);
  if tt='incident' and ps='ACTIVE' and (lab_private.incident_lock(iid)->>'locked')::boolean then ps:='APPROVED';end if;
  if (act='REOPEN' and ps='ACTIVE') or (act<>'REOPEN' and ps<>'ACTIVE') then raise exception 'Reopen a deferred or approved target before making a different decision.';end if;
  -- Explicit fact REOPEN may invalidate protected dependent incidents. All other
  -- fact decisions require every dependent incident to be open.
  if tt='fact' and act<>'REOPEN' then perform lab_private.assert_unlocked(lab_private.fact_lock(tid));end if;
  reqid:=nullif(p->>'request_id','')::uuid;
  if reqid is not null then
   select * into req from public.lab_disposition_request where id=reqid and incident_id=iid for update;
   if not found or req.status<>'PENDING' or req.requested_action<>act or tt<>'incident' or req.incident_revision<>rev then raise exception using errcode='PT409',message='Request or incident changed; a fresh request decision is required.';end if;
  end if;
  select jsonb_build_object('disposition',(select to_jsonb(d) from public.lab_disposition d where target_type=tt and target_id=tid),'claim',(select data from public.claim where tt='fact' and id=tid),'review',(select to_jsonb(w) from public.lab_claim_workflow w where tt='fact' and claim_id=tid),'workflow',(select to_jsonb(w) from public.lab_incident_workflow w where incident_id=iid),'phase2',(select to_jsonb(a) from public.lab_phase2_approval a where incident_id=iid)) into bef;
  if tt='fact' then
   reviewv:=p->'review';
   if act='APPROVE' and (jsonb_typeof(reviewv) is distinct from 'object' or reviewv->>'type' is distinct from 'review' or reviewv->>'claim_id' is distinct from tid) then raise exception 'Fact approval requires the existing typed factual review for this exact fact.';end if;
   inner_request:=p_request||jsonb_build_object('kind','submit_changes','payload',jsonb_build_object('changes',case when act='APPROVE' then jsonb_build_array(reviewv||jsonb_build_object('expected_claim_revision',targetrev)) else '[]'::jsonb end));
  else inner_request:=p_request||jsonb_build_object('kind',case when act='APPROVE' then 'complete_incident' else 'reopen_incident' end,'payload',jsonb_build_object('reason',why,'override',coalesce(p->'override','false'::jsonb)));end if;
  if tt='fact' and act<>'APPROVE' then
   -- Deferral/reopening is workflow-only: never manufacture an empty factual submission.
   update public.incident set revision=revision+1 where id=iid;
   update public.lab_incident_workflow set revision=rev+1 where incident_id=iid;
   resultv:=jsonb_build_object('operation_id',op,'incident_id',iid,'revision',rev+1,'created_ids','[]'::jsonb);
   insert into public.lab_idempotency(operation_id,owner_id,request_hash,result) values(op,actor,digestv,resultv);
  else resultv:=lab_private.commit_pre007(inner_request);end if;
  ns:=case act when 'DEFER' then 'DEFERRED' when 'APPROVE' then 'APPROVED' else 'ACTIVE' end;
  perform lab_private.write_disposition(tt,tid,ns,why);
  if tt='fact' then
   if act='REOPEN' and ps='APPROVED' then
    update public.claim set revision=revision+1 where id=tid;
    insert into public.lab_claim_workflow(claim_id,review_needed,lab_review_state) values(tid,true,'REOPENED') on conflict(claim_id) do update set review_needed=true,lab_review_state='REOPENED',revision=public.lab_claim_workflow.revision+1;
    for r in select id from public.claim where data->>'claim_family'='ATTACK_TO_EFFECT_CAUSATION' and coalesce((data->>'is_current')::boolean,true) and (data->>'attack_claim_id'=tid or data->>'effect_claim_id'=tid) order by id loop
     select jsonb_build_object('claim',c.data,'review',to_jsonb(w),'disposition',lab_private.disposition_state('fact',r.id)) into reviewv from public.claim c left join public.lab_claim_workflow w on w.claim_id=c.id where c.id=r.id;
     update public.claim set revision=revision+1 where id=r.id;
     insert into public.lab_claim_workflow(claim_id,review_needed,lab_review_state) values(r.id,true,'REOPENED') on conflict(claim_id) do update set review_needed=true,lab_review_state='REOPENED',revision=public.lab_claim_workflow.revision+1;
     if lab_private.disposition_state('fact',r.id)='APPROVED' then perform lab_private.write_disposition('fact',r.id,'ACTIVE','Dependent factual review reopened: '||why);end if;
     perform lab_private.disposition_event(op,iid,'fact',r.id,'INVALIDATE_FACT_DEPENDENCY',reviewv->>'disposition',lab_private.disposition_state('fact',r.id),why,reviewv,jsonb_build_object('review',(select to_jsonb(w) from public.lab_claim_workflow w where claim_id=r.id),'claim',(select data from public.claim where id=r.id)),jsonb_build_array(jsonb_build_object('reopened_claim_id',tid)));
    end loop;
   end if;
   inv:=lab_private.invalidate_disposition_dependents(tid,iid,op,'Fact disposition '||act||': '||why);
  end if;
  if reqid is not null then update public.lab_disposition_request set status='ACCEPTED',resolved_by=actor,resolved_at=clock_timestamp(),resolution_reason=why where id=reqid;end if;
  select jsonb_build_object('disposition',(select to_jsonb(d) from public.lab_disposition d where target_type=tt and target_id=tid),'claim',(select data from public.claim where tt='fact' and id=tid),'review',(select to_jsonb(w) from public.lab_claim_workflow w where tt='fact' and claim_id=tid),'workflow',(select to_jsonb(w) from public.lab_incident_workflow w where incident_id=iid),'phase2',(select to_jsonb(a) from public.lab_phase2_approval a where incident_id=iid)) into aft;
  perform lab_private.disposition_event(op,iid,tt,tid,act,ps,ns,why,bef,aft,inv,reqid);
  resultv:=resultv||jsonb_build_object('disposition',ns,'request_id',reqid,'invalidation',inv,'revision',(select revision from public.incident where id=iid),'status',(select status from public.lab_incident_workflow where incident_id=iid));
  -- The old engine created its retry record using the translated command. Replace
  -- it with the original command digest before this transaction can commit.
  update public.lab_idempotency set request_hash=digestv,result=resultv where operation_id=op;return resultv;
 end if;
 bef:=jsonb_build_object('disposition',lab_private.disposition_state('incident',iid),'workflow',(select to_jsonb(w) from public.lab_incident_workflow w where incident_id=iid),'phase2',(select to_jsonb(a) from public.lab_phase2_approval a where incident_id=iid));
 resultv:=lab_private.commit_pre007(p_request);
 if kindv='reopen_incident' or (kindv in ('complete_incident','approve_phase2') and (select status from public.lab_incident_workflow where incident_id=iid) in ('review_complete','supervisor_override')) then
  ps:=lab_private.disposition_state('incident',iid);ns:=case when kindv='reopen_incident' then 'ACTIVE' else 'APPROVED' end;
  if ps<>ns or kindv='reopen_incident' then
   perform lab_private.write_disposition('incident',iid,ns,p->>'reason');
   perform lab_private.disposition_event(op,iid,'incident',iid,case when kindv='reopen_incident' then 'REOPEN' else 'APPROVE_EXISTING_COMPLETION' end,ps,ns,p->>'reason',bef,jsonb_build_object('workflow',(select to_jsonb(w) from public.lab_incident_workflow w where incident_id=iid),'phase2',(select to_jsonb(a) from public.lab_phase2_approval a where incident_id=iid)));
  end if;
 end if;
 return resultv;
end $$;

create function public.lab_snapshot() returns jsonb language plpgsql security definer set search_path=public,lab_private,pg_temp as $$
declare s jsonb;begin
 perform lab_private.require_actor(false);s:=lab_private.snapshot_pre007();
 return s||jsonb_build_object(
 'dispositions',jsonb_build_object('facts',coalesce((select jsonb_object_agg(target_id,to_jsonb(d)) from public.lab_disposition d where target_type='fact'),'{}'),'incidents',coalesce((select jsonb_object_agg(target_id,to_jsonb(d)) from public.lab_disposition d where target_type='incident'),'{}')),
 'disposition_locks',jsonb_build_object('facts',(select jsonb_object_agg(id,lab_private.fact_lock(id)) from public.claim),'incidents',(select jsonb_object_agg(id,lab_private.incident_lock(id)) from public.incident)),
 'disposition_requests',coalesce((select jsonb_agg(to_jsonb(r) order by created_at,id) from public.lab_disposition_request r),'[]'),
 'disposition_history',coalesce((select jsonb_agg(to_jsonb(h) order by occurred_at,id) from public.lab_disposition_history h),'[]'));
end $$;
revoke all on all functions in schema lab_private from public,anon,authenticated;
grant execute on function lab_private.active_user() to authenticated;
revoke all on function public.lab_commit(jsonb),public.lab_snapshot() from public,anon;
grant execute on function public.lab_commit(jsonb),public.lab_snapshot() to authenticated;

-- Corpus staging fragment: supabase/corpus/staging.sql (tested independently).
-- Pass 3 local-only corpus staging. Incorporated verbatim into additive 007.
-- Private schema; no Data API/RPC import endpoint and no client grants.
create schema if not exists lab_corpus;
revoke all on schema lab_corpus from public, anon, authenticated;

create table if not exists lab_corpus.artifacts (
  sha256 text primary key check (sha256 ~ '^[0-9a-f]{64}$'),
  row_hash text not null check (row_hash ~ '^[0-9a-f]{64}$'),
  data jsonb not null check (jsonb_typeof(data) = 'object' and data->>'sha256' = sha256)
);
create table if not exists lab_corpus.source_records (
  source_record_id text primary key,
  historical_state text not null check (historical_state in ('RESEARCH_COMPLETED','IDENTITY_BLOCKED','DEFERRED')),
  import_key text not null unique,
  row_hash text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object' and data->>'source_record_id' = source_record_id)
);
create table if not exists lab_corpus.evidence_relationships (
  id text primary key,
  source_record_id text not null references lab_corpus.source_records(source_record_id),
  artifact_sha256 text not null references lab_corpus.artifacts(sha256),
  relationship text not null,
  historical_local_id text,
  row_hash text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object' and data->>'id' = id)
);
create table if not exists lab_corpus.mappings (
  mapping_id text primary key,
  source_record_id text not null references lab_corpus.source_records(source_record_id),
  target_entity text not null check (target_entity in ('FACILITY','INCIDENT','CLAIM')),
  target_id text not null,
  status text not null check (status in ('APPROVED_EXISTING','PROPOSED')),
  authority_sha256 text not null references lab_corpus.artifacts(sha256),
  row_hash text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object' and data->>'mapping_id' = mapping_id)
);
create table if not exists lab_corpus.proposed_entities (
  entity text not null,
  id text not null,
  mapping_status text not null check (mapping_status = 'PROPOSED'),
  validated_representation boolean not null default false check (validated_representation = false),
  row_hash text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object' and data->>'mapping_status' = 'PROPOSED'),
  primary key (entity,id)
);
create table if not exists lab_corpus.crosswalk (
  source_record_id text primary key references lab_corpus.source_records(source_record_id),
  mapping_status text not null check (mapping_status in ('APPROVED_EXISTING','PROPOSED','UNRESOLVED','IDENTITY_BLOCKED','DEFERRED')),
  row_hash text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object' and data->>'source_record_id' = source_record_id)
);
create table if not exists lab_corpus.imports (
  plan_digest text primary key check (plan_digest ~ '^[0-9a-f]{64}$'),
  row_hash text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object')
);
create index if not exists corpus_evidence_source_record on lab_corpus.evidence_relationships(source_record_id);
create index if not exists corpus_mapping_source_record on lab_corpus.mappings(source_record_id);
-- Client roles get neither schema usage nor table privileges; RLS is defense in depth.
do $corpus_security$ declare tab text; begin
  foreach tab in array array['artifacts','source_records','evidence_relationships','mappings','proposed_entities','crosswalk','imports'] loop
    execute format('alter table lab_corpus.%I enable row level security', tab);
    execute format('revoke all on lab_corpus.%I from public,anon,authenticated', tab);
  end loop;
end $corpus_security$;
