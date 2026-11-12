
-- MASTERBUILD V3 Persistent Lab Pilot V1, 2026-09-24.
-- Run as project owner. No secrets, no seed facts, no new Core research entity.
begin;
create schema if not exists lab_private;
revoke all on schema lab_private from public, anon, authenticated;
revoke create on schema public from public, anon, authenticated;

-- Lossless canonical JSON plus physical identity/revision and FK projections.
do $ddl$
declare n text; k text;
begin
  foreach n in array array['facility','incident','incident_facility','query','query_hit','source','claim','claim_source','gap_task','activity_log'] loop
    k := case n when 'activity_log' then 'activity_id' else n||'_id' end;
    execute format('create table public.%I (id text primary key, data jsonb not null, revision bigint not null default 1 check(revision>0), check(jsonb_typeof(data)=''object'' and data->>%L is not null and data->>%L=id))',n,k,k);
  end loop;
end $ddl$;
alter table public.incident_facility add column incident_id text generated always as (data->>'incident_id') stored references public.incident(id) deferrable initially deferred,
 add column facility_id text generated always as (data->>'facility_id') stored references public.facility(id) deferrable initially deferred;
alter table public.claim add column incident_id text generated always as (data->>'incident_id') stored references public.incident(id) deferrable initially deferred,
 add column facility_id text generated always as (data->>'facility_id') stored references public.facility(id) deferrable initially deferred,
 add column attack_claim_id text generated always as (data->>'attack_claim_id') stored references public.claim(id) deferrable initially deferred,
 add column effect_claim_id text generated always as (data->>'effect_claim_id') stored references public.claim(id) deferrable initially deferred;
alter table public.claim_source add column claim_id text generated always as (data->>'claim_id') stored references public.claim(id) deferrable initially deferred,
 add column source_id text generated always as (data->>'source_id') stored references public.source(id) deferrable initially deferred;
alter table public.query add column incident_id text generated always as (data->>'incident_id') stored references public.incident(id) deferrable initially deferred;
alter table public.query_hit add column query_id text generated always as (data->>'query_id') stored references public.query(id) deferrable initially deferred,
 add column promoted_source_id text generated always as (data->>'promoted_source_id') stored references public.source(id) deferrable initially deferred;
alter table public.gap_task add column incident_id text generated always as (data->>'incident_id') stored references public.incident(id) deferrable initially deferred,
 add column claim_id text generated always as (data->>'claim_id') stored references public.claim(id) deferrable initially deferred;
alter table public.activity_log add column incident_id text generated always as (data->>'incident_id') stored references public.incident(id) deferrable initially deferred,
 add column facility_id text generated always as (data->>'facility_id') stored references public.facility(id) deferrable initially deferred;
create index on public.claim(incident_id);
create index on public.claim(facility_id);
create index on public.claim_source(claim_id);
create index on public.claim_source(source_id);
create index on public.incident_facility(facility_id);
create index on public.incident_facility(incident_id);
create index on public.gap_task(incident_id);
create index on public.activity_log(incident_id);

-- Non-Core application state. No authoritative factual values in workflow.
create table public.lab_profiles(
 user_id uuid primary key references auth.users(id), display_name text not null check(length(btrim(display_name))>0),
 role text not null check(role in ('researcher','supervisor')), active boolean not null default true
);
create table public.lab_private_drafts(
 id text not null, owner_id uuid not null references public.lab_profiles(user_id), revision bigint not null default 1 check(revision>0),
 payload jsonb not null, updated_at timestamptz not null default now(), primary key(owner_id,id)
);
create table public.lab_incident_workflow(
 incident_id text primary key references public.incident(id), status text not null default 'preserved_unassessed'
 check(status in ('preserved_unassessed','in_progress','research_lead','review_complete','supervisor_override','reopened')),
 working_type text, required_claim_ids text[] not null default '{}', optional_claim_ids text[] not null default '{}',
 dispositions jsonb not null default '{}', requirements_assessed boolean not null default false,
 completion jsonb, revision bigint not null default 1 check(revision>0), entered_by uuid references public.lab_profiles(user_id),
 entered_at timestamptz not null default now()
);
create table public.lab_claim_workflow(
 claim_id text primary key references public.claim(id), proposal jsonb, review_needed boolean not null default false,
 revision bigint not null default 1 check(revision>0)
);
create table public.lab_idempotency(
 operation_id uuid primary key, owner_id uuid not null references public.lab_profiles(user_id), request_hash text not null,
 result jsonb, created_at timestamptz not null default now()
);
create table public.lab_seed_metadata(id text primary key,data jsonb not null);

create function lab_private.active_user() returns boolean language sql stable security definer set search_path=pg_catalog,public
as $$ select exists(select 1 from public.lab_profiles where user_id=auth.uid() and active) $$;
create function lab_private.require_actor(p_supervisor boolean default false) returns uuid language plpgsql security definer set search_path=pg_catalog,public
as $$ declare u uuid:=auth.uid(); r text; begin
 select role into r from public.lab_profiles where user_id=u and active;
 if r is null then raise exception using errcode='42501',message='An active lab account is required.'; end if;
 if p_supervisor and r<>'supervisor' then raise exception using errcode='42501',message='This action requires a supervisor.'; end if;
 return u;
end $$;

-- Reads are shared only with active approved lab accounts; all DML is RPC-only.
do $policies$ declare n text; begin
 foreach n in array array['facility','incident','incident_facility','query','query_hit','source','claim','claim_source','gap_task','activity_log','lab_profiles','lab_incident_workflow','lab_claim_workflow','lab_seed_metadata'] loop
  execute format('alter table public.%I enable row level security',n);
  execute format('revoke all on public.%I from public,anon,authenticated',n);
  execute format('grant select on public.%I to authenticated',n);
  execute format('create policy lab_read on public.%I for select to authenticated using(lab_private.active_user())',n);
 end loop;
end $policies$;
-- RLS expressions need this single boolean helper, not private mutation helpers.
grant usage on schema lab_private to authenticated;
grant execute on function lab_private.active_user() to authenticated;
alter table public.lab_private_drafts enable row level security;
alter table public.lab_idempotency enable row level security;
revoke all on public.lab_private_drafts,public.lab_idempotency from public,anon,authenticated;
grant select on public.lab_private_drafts to authenticated;
create policy own_drafts on public.lab_private_drafts for select to authenticated using(owner_id=auth.uid() and lab_private.active_user());
create function lab_private.immutable_history() returns trigger language plpgsql set search_path=pg_catalog
as $$ begin raise exception using errcode='55000',message='Research activity is append-only. Record a new event instead.'; end $$;
create trigger activity_no_rewrite before update or delete on public.activity_log for each row execute function lab_private.immutable_history();
create trigger seed_metadata_no_rewrite before update or delete on public.lab_seed_metadata for each row execute function lab_private.immutable_history();

create function lab_private.nonblank(v text) returns boolean language sql immutable set search_path=pg_catalog
as $$ select v is not null and length(btrim(v))>0 $$;
create function lab_private.new_id(prefix text) returns text language sql volatile set search_path=pg_catalog
as $$ select prefix||'-'||gen_random_uuid()::text $$;
create function lab_private.valid_day(v text) returns boolean language plpgsql immutable set search_path=pg_catalog
as $$ begin
 if v is null or v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
 return to_char(v::date,'YYYY-MM-DD')=v;
 exception when others then return false;
end $$;
create function lab_private.assert_date(v jsonb,p text) returns void language plpgsql immutable set search_path=pg_catalog
as $$ declare t text:=v#>>'{}'; begin
 if p is null or p not in ('DAY','MONTH','APPROXIMATE','RANGE','UNKNOWN') then raise exception 'Choose an approved date precision.'; end if;
 if p='UNKNOWN' then
  if v is not null and v<>'null'::jsonb then raise exception 'Unknown dates must be null.'; end if;
 elsif v is null or v='null'::jsonb then raise exception 'A known date precision needs a date value.';
 elsif p='DAY' then
  if jsonb_typeof(v)<>'string' or not lab_private.valid_day(t) then raise exception 'Day precision needs a valid YYYY-MM-DD date.'; end if;
 elsif p='MONTH' then
  if jsonb_typeof(v)<>'string' or t !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Month precision needs YYYY-MM, without an invented day.'; end if;
 elsif p='RANGE' then
  if jsonb_typeof(v)<>'object' or not lab_private.valid_day(v->>'start') or not lab_private.valid_day(v->>'end') or (v->>'start')::date>(v->>'end')::date then raise exception 'A date range needs valid ordered start and end dates.'; end if;
 elsif p='APPROXIMATE' then
  if not ((jsonb_typeof(v)='string' and lab_private.nonblank(t)) or (jsonb_typeof(v)='object' and lab_private.nonblank(v->>'label'))) then raise exception 'Describe the approximate date explicitly.'; end if;
 end if;
end $$;

create function lab_private.assert_source(s jsonb) returns void language plpgsql immutable set search_path=pg_catalog
as $$ declare sf jsonb:=s->'social_fields'; k text; val text; pub jsonb:=s->'publication_date'; begin
 if jsonb_typeof(s)<>'object' or not lab_private.nonblank(s->>'title') or not lab_private.nonblank(s->>'publisher_platform') or not lab_private.nonblank(coalesce(s->>'original_url',s->>'canonical_url')) then raise exception 'Source title, publisher/account and URL or identifier are required.'; end if;
 if s->>'source_type' is null or s->>'source_type' not in ('news','official','humanitarian','social','human OSINT','mapping','other') then raise exception 'Choose an approved source type.'; end if;
 if s->>'retrieval_body_status' is null or s->>'retrieval_body_status' not in ('USABLE_BODY','PARTIAL_USABLE_BODY','INDEXED_ONLY','INACCESSIBLE_NEUTRAL','REJECTED_WRONG_TARGET','REJECTED_IRRELEVANT','DUPLICATE_OR_DEPENDENT','UNKNOWN') then raise exception 'Record the source access state explicitly.'; end if;
 if jsonb_typeof(pub) is distinct from 'object' then raise exception 'Publication date needs an explicit value and precision, including Unknown.'; end if;
 perform lab_private.assert_date(pub->'value',pub->>'precision');
 if jsonb_typeof(s->'content_preservation_status') is distinct from 'object' or not lab_private.nonblank(s->'content_preservation_status'->>'excerpt') or not lab_private.nonblank(s->'content_preservation_status'->>'preservation') then raise exception 'Record the relevant passage/description and preservation method.'; end if;
 if not lab_private.nonblank(s->>'limitations') then raise exception 'Record limitations explicitly; None identified or Unknown is allowed.'; end if;
 if s->>'source_type'='social' then
  if jsonb_typeof(sf) is distinct from 'object' then raise exception 'Social evidence needs explicit verification metadata.'; end if;
  foreach k in array array['platform','account','post','timestamp','access','originality','geo','chronology','match','preservation','limitations'] loop
   val:=case k when 'post' then coalesce(sf->>'post_id',sf->>'postId',sf->>'post_url',s->>'original_url')
    when 'timestamp' then coalesce(sf->>'timestamp_status',sf->>'timestampStatus')
    when 'geo' then coalesce(sf->>'geo_status',sf->>'geo')
    when 'chronology' then coalesce(sf->>'chronology_status',sf->>'chronology')
    when 'match' then coalesce(sf->>'facility_match',sf->>'match')
    else sf->>k end;
   if not lab_private.nonblank(val) then raise exception 'Social field % must be explicit; Unknown/Unverified is allowed.',k; end if;
  end loop;
 end if;
end $$;

create function lab_private.apply_changes(iid text,changes jsonb) returns jsonb language plpgsql set search_path=pg_catalog,public
as $$ declare ch jsonb; c jsonb; old jsonb; newdoc jsonb; s jsonb; rel jsonb; v jsonb; task jsonb;
 cid text; sid text; rid text; gid text; fid text; aid text; f text; t text; statev text; p text; unitv text; basis text;
 rev bigint; act boolean:=false; one_material boolean; sources_count int; supports_count int; contrary_count int; limits_count int;
 extra jsonb; artifact jsonb; created jsonb:='[]'; touched text[]:='{}'; k text; disposition text;
 begin
 if jsonb_typeof(changes) is distinct from 'array' or jsonb_array_length(changes)>150 then raise exception 'Submit a bounded list of at most 150 changes.'; end if;
 for ch in select value from jsonb_array_elements(changes) loop
  if ch->>'type'='new_fact' then
   c:=ch->'claim'; cid:=coalesce(nullif(c->>'claim_id',''),lab_private.new_id('C')); f:=c->>'claim_family';t:=c->>'value_type';fid:=nullif(c->>'facility_id','');
   if not lab_private.nonblank(c->>'subject') then raise exception 'Enter the exact factual proposition.'; end if;
   if length(cid)>200 then raise exception 'Fact identifier is too long.'; end if;
   perform lab_private.assert_value(f,t,c->'proposed_value',c->>'date_precision',c->>'quantitative_unit',c->>'impact_basis');
   if f in ('IDENTITY','FACILITY_TYPE') and (fid is null or not exists(select 1 from public.incident_facility where incident_id=iid and facility_id=fid)) then raise exception 'Identity/type facts must refer to this physical facility.'; end if;
   if fid is not null and not exists(select 1 from public.incident_facility where incident_id=iid and facility_id=fid) then raise exception 'Facility scope does not match this incident.'; end if;
   newdoc:=jsonb_build_object('claim_id',cid,'incident_id',iid,'facility_id',fid,'claim_family',f,'subject',c->>'subject','value_type',t,'current_verified_value',null,'ai_original_value',null,'ai_original_provenance',null,'validation_state','NOT_REVIEWED','validation_origin','UNKNOWN','individual_human_factual_adjudication','NO','reviewer',null,'reviewed_at',null,'review_notes',null,'current_value_authority',null,'is_current',true,'date_precision',case when t in ('DATE','DATE_RANGE') then 'UNKNOWN' else null end,'quantitative_unit',c->>'quantitative_unit','impact_basis',c->>'impact_basis','supersedes_claim_revision',null,'legacy_refs','[]'::jsonb,'open_factual_question',c->>'open_factual_question');
   insert into public.claim(id,data) values(cid,newdoc);
   insert into public.lab_claim_workflow(claim_id,proposal) values(cid,jsonb_build_object('value',coalesce(c->'proposed_value','null'::jsonb),'date_precision',c->>'date_precision','quantitative_unit',c->>'quantitative_unit','impact_basis',c->>'impact_basis','source_described_type',c->>'source_described_type','attack_claim_id',c->>'attack_claim_id','effect_claim_id',c->>'effect_claim_id','entered_by',auth.uid(),'entered_at',clock_timestamp()));
   update public.lab_incident_workflow set required_claim_ids=array_append(required_claim_ids,cid) where incident_id=iid;
   perform lab_private.audit(iid,'CLAIM',cid,'create','New unreviewed fact proposed',null,newdoc,jsonb_build_object('proposed_fact',c,'proposal_status','NOT_REVIEWED'));
   created:=created||jsonb_build_array(jsonb_build_object('type','CLAIM','id',cid));act:=true;
  elsif ch->>'type'='evidence' then
   cid:=ch->>'claim_id'; perform lab_private.assert_claim_scope(cid,iid);
   s:=ch->'source'; sid:=nullif(ch->>'source_id','');
   if sid is null then
    perform lab_private.assert_source(s);
    sid:=coalesce(nullif(s->>'source_id',''),lab_private.new_id('S'));
    -- Only source fields are accepted; no caller may inject review/actor authority.
    select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into newdoc from jsonb_each(s) where key=any(array['source_type','title','publisher_platform','original_url','canonical_url','publication_date','retrieval_body_status','content_preservation_status','evidence_locator','limitations','social_fields']);
    -- Submission time is activity time; it is not evidence of a historical retrieval.
    newdoc:=newdoc||jsonb_build_object('source_id',sid,'retrieval_date',null,'legacy_refs','[]'::jsonb);
    insert into public.source(id,data) values(sid,newdoc);
    created:=created||jsonb_build_array(jsonb_build_object('type','SOURCE','id',sid));
   elsif not exists(select 1 from public.source where id=sid) then raise exception 'Choose an existing source or enter a new source.'; end if;
   rel:=ch->'relation';
   if rel->>'support_direction' is null or rel->>'support_direction' not in ('SUPPORTS','CONTRADICTS','LIMITS','CONTEXT_ONLY') then raise exception 'Choose how this source relates to the fact.'; end if;
   if rel->>'directness' is not null and rel->>'directness' not in ('direct','secondary','inferred','indexed-only','contextual') then raise exception 'Unknown directness must be null; do not invent a category.'; end if;
   if rel->>'originality' is null or rel->>'originality' not in ('original','republication','syndication','repost','unknown') then raise exception 'Record source originality explicitly.'; end if;
   if jsonb_typeof(rel->'evidence_locator') is distinct from 'array' or jsonb_array_length(rel->'evidence_locator')=0 or not exists(select 1 from jsonb_array_elements(rel->'evidence_locator') x where lab_private.nonblank(x->>'locator') and lab_private.nonblank(coalesce(x->>'excerpt',x->>'description'))) then raise exception 'Record the exact evidence location and passage or description.'; end if;
   if not lab_private.nonblank(rel->>'limitations') then raise exception 'Record the relation limitations explicitly.'; end if;
   rid:=lab_private.new_id('CS');
   newdoc:=jsonb_build_object('claim_source_id',rid,'claim_id',cid,'source_id',sid,'support_direction',rel->>'support_direction','directness',rel->>'directness','originality',rel->>'originality','dependency_group_id',nullif(rel->>'dependency_group_id',''),'dependency_provenance',rel->'dependency_provenance','evidence_locator',rel->'evidence_locator','limitations',rel->>'limitations','evidence_role',coalesce(rel->>'evidence_role','context'),'reviewer',null,'reviewed_at',null);
   insert into public.claim_source(id,data) values(rid,newdoc);
   one_material:=(rel->>'support_direction'='CONTRADICTS') or coalesce((ch->>'material')::boolean,false) or (rel->>'support_direction'='LIMITS' and not (coalesce(ch->>'material','')='false' and lab_private.nonblank(ch->>'material_reason')));
   if one_material then
    insert into public.lab_claim_workflow(claim_id,review_needed) values(cid,true) on conflict(claim_id) do update set review_needed=true,revision=public.lab_claim_workflow.revision+1;
    -- Reuse the existing unresolved question rather than duplicating one per source.
    if not exists(select 1 from public.gap_task where claim_id=cid and data->>'status'<>'resolved') then
     gid:=lab_private.new_id('G');
     insert into public.gap_task(id,data) values(gid,jsonb_build_object('gap_task_id',gid,'incident_id',iid,'claim_id',cid,'factual_question','Does the new evidence change this factual finding?','reason','New evidence may contradict or materially limit the prior review.','next_action','Check the preserved evidence before making another factual decision.','status','blocked','task_disposition','active','opened_date',current_date,'resolution',null));
    end if;
    act:=true;
   end if;
   select facility_id into fid from public.claim where id=cid and data->>'claim_family' in ('IDENTITY','FACILITY_TYPE');
   if fid is not null and one_material then touched:=array_append(touched,fid); end if;
   perform lab_private.audit(iid,'CLAIM_SOURCE',rid,'create','Evidence added without factual adjudication',null,newdoc,jsonb_build_object('source_id',sid,'material',one_material,'material_reason',ch->>'material_reason'));
   created:=created||jsonb_build_array(jsonb_build_object('type','CLAIM_SOURCE','id',rid));
  elsif ch->>'type'='review' then
   cid:=ch->>'claim_id'; perform lab_private.assert_claim_scope(cid,iid);
   select data,revision into old,rev from public.claim where id=cid for update;
   if ch ? 'expected_claim_revision' and (ch->>'expected_claim_revision')::bigint<>rev then raise exception using errcode='40001',message='Someone else changed this fact. Reload the latest version before submitting.'; end if;
   statev:=ch->>'validation_state';v:=coalesce(ch->'value','null'::jsonb);f:=old->>'claim_family';t:=old->>'value_type';p:=ch->>'date_precision';unitv:=ch->>'quantitative_unit';basis:=ch->>'impact_basis';
   if t in ('DATE','DATE_RANGE') then
    t:=case when p='RANGE' then 'DATE_RANGE' when p in ('DAY','MONTH','APPROXIMATE') then 'DATE' else t end;
   end if;
   if coalesce((ch->>'attestation')::boolean,false) is not true or not lab_private.nonblank(ch->>'review_notes') then raise exception 'Review the proposition, evidence and limitations, then explicitly attest.'; end if;
   if statev is null or statev not in ('SUPPORTED','NOT_SUPPORTED','CONFLICTING','NEEDS_MORE_EVIDENCE','NOT_APPLICABLE') then raise exception 'Choose a factual review determination.'; end if;
   if t='TEXT_WHERE_REQUIRED' and jsonb_typeof(old->'current_verified_value') in ('object','array') and v=old->'current_verified_value' then
    -- Preserved structured baseline values may be reviewed unchanged. This does
    -- not authorize a new arbitrary object vocabulary or a silent flattening.
    if p is distinct from old->>'date_precision' or unitv is distinct from old->>'quantitative_unit' or basis is distinct from old->>'impact_basis' then raise exception 'Preserving this detailed recorded value must also preserve its precision, unit and basis.'; end if;
   else perform lab_private.assert_value(f,t,v,p,unitv,basis); end if;
   if statev='SUPPORTED' and v='null'::jsonb then raise exception 'A supported finding needs a known typed value.'; end if;
   if statev='NOT_APPLICABLE' and v<>'null'::jsonb then raise exception 'Not Applicable must not assert a factual Yes, No, number, or date.'; end if;
   if f='RESTORATION_DATE' and t='QUANTITATIVE' and v<>'null'::jsonb and basis<>'directly reported' then raise exception 'Only directly source-reported duration may be certified; do not certify an estimate or manufacture an endpoint.'; end if;
   select count(*),count(*) filter(where data->>'support_direction'='SUPPORTS'),count(*) filter(where data->>'support_direction'='CONTRADICTS'),count(*) filter(where data->>'support_direction'='LIMITS') into sources_count,supports_count,contrary_count,limits_count from public.claim_source where claim_id=cid;
   if sources_count=0 then raise exception 'Attach assessed evidence before human certification.'; end if;
   if statev='SUPPORTED' and supports_count=0 and not lab_private.nonblank(ch->>'basis_explanation') then raise exception 'Supported requires supporting evidence or an explicit exception explanation.'; end if;
   if statev='NOT_SUPPORTED' and contrary_count+limits_count=0 and not lab_private.nonblank(ch->>'basis_explanation') then raise exception 'Not Supported requires contrary/limiting evidence or explicit basis.'; end if;
   if statev='CONFLICTING' and not (supports_count>0 and contrary_count>0) and not lab_private.nonblank(ch->>'basis_explanation') then raise exception 'Conflicting requires competing evidence or an explicit conflict basis.'; end if;
   if f='ATTACK_TO_EFFECT_CAUSATION' and ((ch->>'effect_claim_id' is not null and old->>'effect_claim_id' is not null and old->>'effect_claim_id' is distinct from ch->>'effect_claim_id') or (ch->>'attack_claim_id' is not null and old->>'attack_claim_id' is not null and old->>'attack_claim_id' is distinct from ch->>'attack_claim_id')) then raise exception 'This causal proposition already has a specific attack and effect. Propose a distinct causal fact for a different pair.'; end if;
   if f='ATTACK_TO_EFFECT_CAUSATION' and statev='SUPPORTED' and v='true'::jsonb then
    if not exists(select 1 from public.claim a join public.claim e on e.id=ch->>'effect_claim_id' where a.id=ch->>'attack_claim_id' and a.incident_id=iid and e.incident_id=iid and a.data->>'claim_family'='KINETIC_EVENT' and a.data->'current_verified_value'='true'::jsonb and lab_private.effect_family(e.data->>'claim_family') and lab_private.eligible(a.id) and lab_private.eligible(e.id)) then raise exception 'Supported causation must link this reviewed attack to this particular reviewed operational effect.'; end if;
   end if;
   aid:=lab_private.new_id('ACT');
   -- Hash exact reviewed proposal and evidence snapshot, avoiding circular hashes.
   select jsonb_build_object('claim_id',cid,'prior_revision',rev,'proposal',ch,'evidence',coalesce(jsonb_agg(data order by id),'[]'::jsonb),'reviewer',auth.uid(),'reviewed_at',clock_timestamp()) into artifact from public.claim_source where claim_id=cid;
   newdoc:=old||jsonb_build_object('current_verified_value',v,'value_type',t,'validation_state',statev,'date_precision',case when t in ('DATE','DATE_RANGE') then p else null end,'quantitative_unit',unitv,'impact_basis',basis,'validation_origin','V3_HUMAN_CLAIM_VALIDATION','individual_human_factual_adjudication','YES','reviewer',auth.uid()::text,'reviewed_at',clock_timestamp(),'review_notes',ch->>'review_notes','supersedes_claim_revision',jsonb_build_object('claim_id',cid,'revision',rev),'current_value_authority',jsonb_build_object('authority_artifact',aid,'authority_path','ACTIVITY_LOG/'||aid||'/authority_artifact/payload/operation/review_artifact','authority_scope',old->>'subject','authority_type','V3_HUMAN_CLAIM_VALIDATION','authority_date',current_date,'authority_sha256',encode(sha256(convert_to(artifact::text,'UTF8')),'hex'),'recording_basis','CONTEMPORANEOUSLY_RECORDED','supersedes_ref',jsonb_build_object('claim_id',cid,'revision',rev)));
   if f='ATTACK_TO_EFFECT_CAUSATION' then
    if ch->>'attack_claim_id' is not null or ch->>'effect_claim_id' is not null then
     if not exists(select 1 from public.claim a join public.claim e on e.id=ch->>'effect_claim_id' where a.id=ch->>'attack_claim_id' and a.incident_id=iid and e.incident_id=iid and a.data->>'claim_family'='KINETIC_EVENT' and lab_private.effect_family(e.data->>'claim_family')) then raise exception 'Causal bindings require same-incident attack and effect facts.'; end if;
     newdoc:=newdoc||jsonb_build_object('attack_claim_id',ch->>'attack_claim_id','effect_claim_id',ch->>'effect_claim_id');
    end if;
   end if;
   if f='FACILITY_TYPE' and lab_private.nonblank(ch->>'source_described_type') then newdoc:=newdoc||jsonb_build_object('source_described_type',ch->>'source_described_type'); end if;
   update public.claim set data=newdoc,revision=revision+1 where id=cid;
   insert into public.lab_claim_workflow(claim_id,review_needed,proposal) values(cid,false,null) on conflict(claim_id) do update set review_needed=false,proposal=null,revision=public.lab_claim_workflow.revision+1;
   perform lab_private.audit(iid,'CLAIM',cid,'validate','Human factual review',old,newdoc,jsonb_build_object('basis_explanation',ch->>'basis_explanation','review_artifact',artifact),aid);
   -- Facility identity authority is claim-derived, never from a typed shell name.
   if f in ('IDENTITY','FACILITY_TYPE') then
    fid:=old->>'facility_id';touched:=array_append(touched,fid);
    if f='IDENTITY' and t in ('BOOLEAN','TEXT_WHERE_REQUIRED') then
     select data into c from public.facility where id=fid;
     if c->>'identity_status' in ('POSSIBLE_DUPLICATE_OR_RELATED_RECORD','POSSIBLE_SUPPLEMENTAL_MATCH_NEEDS_REVIEW') and not (coalesce(ch->>'identity_disposition','')='different' and lab_private.nonblank(ch->>'identity_reason')) then
      -- Support for a name does not itself settle an unresolved duplicate question.
      null;
     elsif statev='SUPPORTED' and v<>'null'::jsonb and v<>'false'::jsonb then
      update public.facility set data=data||jsonb_build_object('identity_status','IDENTIFIED','canonical_name',case when jsonb_typeof(v)='string' then v#>>'{}' else coalesce(data->>'canonical_name',data->'aliases'->0->>'value') end),revision=revision+1 where id=fid;
     else update public.facility set data=data||jsonb_build_object('identity_status','PARTIALLY_IDENTIFIED'),revision=revision+1 where id=fid; end if;
     perform lab_private.audit(iid,'FACILITY',fid,'revise','Identity projection after scoped review',c,(select data from public.facility where id=fid));
    end if;
   end if;
   act:=true;
  elsif ch->>'type'='task' then
   task:=ch->'task';gid:=coalesce(nullif(task->>'gap_task_id',''),lab_private.new_id('G'));cid:=nullif(task->>'claim_id','');
   if cid is not null then perform lab_private.assert_claim_scope(cid,iid); end if;
   if exists(select 1 from public.gap_task where id=gid and incident_id<>iid) then raise exception 'Task belongs to another incident.'; end if;
   statev:=task->>'status';disposition:=coalesce(task->>'disposition',case statev when 'deferred' then 'deferred' when 'resolved' then 'resolved' else 'active' end);
   if statev is null or statev not in ('open','in progress','blocked','resolved','deferred') or disposition not in ('active','deferred','unable_to_resolve','resolved','ready_for_review') then raise exception 'Choose a valid task status and disposition.'; end if;
   if not lab_private.nonblank(task->>'factual_question') or not lab_private.nonblank(task->>'reason') or not lab_private.nonblank(task->>'next_action') then raise exception 'Explain what is unclear, why it matters, and what to check.'; end if;
   if disposition in ('deferred','unable_to_resolve','resolved') and not lab_private.nonblank(task->>'resolution') then raise exception 'Record the reason for this task disposition.'; end if;
   if disposition in ('deferred','unable_to_resolve') then statev:='deferred'; end if;
   if disposition='resolved' then statev:='resolved'; end if;
   select data into old from public.gap_task where id=gid;
   newdoc:=coalesce(old,'{}')||jsonb_build_object('gap_task_id',gid,'incident_id',iid,'claim_id',cid,'factual_question',task->>'factual_question','reason',task->>'reason','next_action',task->>'next_action','status',statev,'task_disposition',disposition,'resolution',task->>'resolution','opened_date',coalesce(old->>'opened_date',current_date::text),'resolved_date',case when statev='resolved' then current_date else null end);
   insert into public.gap_task(id,data) values(gid,newdoc) on conflict(id) do update set data=excluded.data,revision=public.gap_task.revision+1;
   perform lab_private.audit(iid,'GAP_TASK',gid,case when statev='deferred' then 'defer' when statev='resolved' then 'resolve' else 'revise' end,'Research task updated',old,newdoc);
   act:=true;created:=created||jsonb_build_array(jsonb_build_object('type','GAP_TASK','id',gid));
  else raise exception 'Unsupported change type.';
  end if;
 end loop;
 return jsonb_build_object('created_ids',created,'material',act,'facility_touches',to_jsonb(touched));
end $$;
create function lab_private.assert_value(f text,t text,v jsonb,p text,u text,b text) returns void language plpgsql immutable set search_path=pg_catalog
as $$ begin
 if f is null or f not in ('IDENTITY','FACILITY_TYPE','KINETIC_EVENT','EVENT_DATE','ACTOR_ATTRIBUTION','ATTACK_RELATIONSHIP','PHYSICAL_DAMAGE','EVACUATION','FULL_CLOSURE','PARTIAL_CLOSURE','DEPARTMENT_OR_SERVICE_SHUTDOWN','REDUCED_CAPACITY','PATIENT_TRANSFER','UTILITY_LOSS','ACCESS_DISRUPTION','RELOCATION','ATTACK_TO_EFFECT_CAUSATION','EFFECT_ONSET','RESTORATION_STATUS','RESTORATION_DATE','HUMAN_IMPACT_MEASURE') then raise exception 'Unknown fact family.'; end if;
 if t is null or t not in ('BOOLEAN','CATEGORICAL','DATE','DATE_RANGE','QUANTITATIVE','TEXT_WHERE_REQUIRED') then raise exception 'Unknown fact value type.'; end if;
 if f in ('EVENT_DATE','EFFECT_ONSET') and t not in ('DATE','DATE_RANGE') then raise exception 'This fact requires a date control.'; end if;
 if f='RESTORATION_DATE' and t not in ('DATE','DATE_RANGE','QUANTITATIVE') then raise exception 'Restoration uses a date or source-reported duration.'; end if;
 if f in ('ATTACK_RELATIONSHIP','FACILITY_TYPE') and t<>'CATEGORICAL' then raise exception 'This fact requires its own controlled category.'; end if;
 if f in ('KINETIC_EVENT','FULL_CLOSURE','PARTIAL_CLOSURE','ATTACK_TO_EFFECT_CAUSATION') and t<>'BOOLEAN' then raise exception 'This fact requires Yes, No, or Unknown.'; end if;
 if f='HUMAN_IMPACT_MEASURE' and t<>'QUANTITATIVE' then raise exception 'Human quantities require number, unit and basis.'; end if;
 if t in ('DATE','DATE_RANGE') and f not in ('EVENT_DATE','EFFECT_ONSET','RESTORATION_DATE') then raise exception 'Date controls are reserved for chronology facts.'; end if;
 if t='QUANTITATIVE' and f not in ('HUMAN_IMPACT_MEASURE','RESTORATION_DATE') then raise exception 'This family has no approved quantitative representation.'; end if;
 if f='ACTOR_ATTRIBUTION' and t not in ('TEXT_WHERE_REQUIRED','CATEGORICAL') then raise exception 'Actor attribution needs an actor-specific text/category control.'; end if;
 if t in ('DATE','DATE_RANGE') then perform lab_private.assert_date(v,p); return; end if;
 if p is not null and p<>'UNKNOWN' then raise exception 'Non-date values cannot acquire date precision.'; end if;
 if t='QUANTITATIVE' then
  if not lab_private.nonblank(u) or (b is not null and b not in ('directly reported','context/capacity','proxy/estimated','unresolved')) or (v is not null and v<>'null'::jsonb and b is null) then raise exception 'A quantity needs its unit and recorded evidence basis; unknown value/basis remain null.'; end if;
  if v is not null and v<>'null'::jsonb and (jsonb_typeof(v)<>'number' or (v#>>'{}')::numeric<0) then raise exception 'Quantity must be a nonnegative number or Unknown.'; end if;
 elsif v is not null and v<>'null'::jsonb then
  if t='BOOLEAN' and jsonb_typeof(v)<>'boolean' then raise exception 'Boolean value must be true, false, or null.'; end if;
  if t in ('CATEGORICAL','TEXT_WHERE_REQUIRED') and (jsonb_typeof(v)<>'string' or not lab_private.nonblank(v#>>'{}')) then raise exception 'Text/category must be a nonblank string or Unknown.'; end if;
  if f='ATTACK_RELATIONSHIP' and v#>>'{}' not in ('EXACT_TARGET','NEARBY_CONTEXT','REJECTED') then raise exception 'Unsupported attack relationship category.'; end if;
  if f='FACILITY_TYPE' and v#>>'{}' not in ('hospital','primary_health_care_center','primary_health_care_center_medical_clinic') then raise exception 'Preserve the source-described type separately; its approved category is unresolved.'; end if;
  if t='CATEGORICAL' and f='RESTORATION_STATUS' and v#>>'{}'<>'not_found' then raise exception 'Use an approved restoration category; unknown remains null.'; end if;
  if t='CATEGORICAL' and f='REDUCED_CAPACITY' and v#>>'{}'<>'building_supervision_not_documented_clinical_services' then raise exception 'This category is not in the preserved reduced-capacity vocabulary.'; end if;
  if t='CATEGORICAL' and f='ACTOR_ATTRIBUTION' and v#>>'{}'<>'Israel — explicitly_reported' then raise exception 'This category is not an approved actor value. Use a distinct source-grounded text proposition where required.'; end if;
  if t='CATEGORICAL' and f='IDENTITY' and v#>>'{}'<>'Islamic Health Authority / جمعية الهيئة الصحية الاسلامية' then raise exception 'This identity category is not in the preserved vocabulary.'; end if;
  if t='CATEGORICAL' and f not in ('ATTACK_RELATIONSHIP','FACILITY_TYPE','RESTORATION_STATUS','REDUCED_CAPACITY','ACTOR_ATTRIBUTION','IDENTITY') then raise exception 'No substantive categorical vocabulary is approved for this fact; preserve Unknown or propose an appropriately typed fact.'; end if;
 end if;
end $$;

create function lab_private.assert_claim_scope(cid text,iid text) returns void language plpgsql stable set search_path=pg_catalog,public
as $$ begin
 if not exists(select 1 from public.claim c where c.id=cid and (c.incident_id=iid or (c.data->>'claim_family' in ('IDENTITY','FACILITY_TYPE') and exists(select 1 from public.incident_facility x where x.incident_id=iid and x.facility_id=c.facility_id)))) then raise exception 'This fact is not part of the selected incident or its facility.'; end if;
end $$;
create function lab_private.eligible(cid text) returns boolean language sql stable set search_path=pg_catalog,public
as $$ select exists(select 1 from public.claim c left join public.lab_claim_workflow w on w.claim_id=c.id where c.id=cid and c.data->>'validation_state'='SUPPORTED' and coalesce((c.data->>'is_current')::boolean,true) and c.data->'current_verified_value' is not null and c.data->'current_verified_value'<>'null'::jsonb and c.data->'current_verified_value'<>'false'::jsonb and not coalesce(w.review_needed,false) and (c.data->>'individual_human_factual_adjudication'='YES' or c.data->>'validation_origin' like 'LEGACY_%')) $$;
create function lab_private.effect_family(f text) returns boolean language sql immutable set search_path=pg_catalog
as $$ select f in ('FULL_CLOSURE','PARTIAL_CLOSURE','DEPARTMENT_OR_SERVICE_SHUTDOWN','REDUCED_CAPACITY','EVACUATION','PATIENT_TRANSFER','UTILITY_LOSS','ACCESS_DISRUPTION','RELOCATION') $$;
create function lab_private.identity_ready(iid text) returns boolean language sql stable set search_path=pg_catalog,public
as $$ select exists(select 1 from public.incident_facility x where x.incident_id=iid)
 and not exists(select 1 from public.incident_facility x join public.facility f on f.id=x.facility_id where x.incident_id=iid and (f.data->>'identity_status' is distinct from 'IDENTIFIED' or not exists(select 1 from public.claim c where c.facility_id=x.facility_id and c.data->>'claim_family'='IDENTITY' and c.data->>'value_type' in ('BOOLEAN','TEXT_WHERE_REQUIRED') and lab_private.eligible(c.id)) or exists(select 1 from public.claim c left join public.lab_claim_workflow w on w.claim_id=c.id where c.facility_id=x.facility_id and c.data->>'claim_family'='IDENTITY' and c.data->>'value_type' in ('BOOLEAN','TEXT_WHERE_REQUIRED') and (c.data->>'validation_state'='CONFLICTING' or coalesce(w.review_needed,false))))) $$;
create function lab_private.causal_pair_eligible(cid text) returns boolean language sql stable set search_path=pg_catalog,public
as $$ select exists(select 1 from public.claim c join public.claim a on a.id=c.attack_claim_id join public.claim e on e.id=c.effect_claim_id where c.id=cid and c.data->>'claim_family'='ATTACK_TO_EFFECT_CAUSATION' and c.data->'current_verified_value'='true'::jsonb and a.incident_id=c.incident_id and e.incident_id=c.incident_id and a.data->>'claim_family'='KINETIC_EVENT' and a.data->'current_verified_value'='true'::jsonb and lab_private.effect_family(e.data->>'claim_family') and lab_private.eligible(c.id) and lab_private.eligible(a.id) and lab_private.eligible(e.id)) $$;

create function lab_private.audit(iid text,etype text,eid text,action text,reason text,before_doc jsonb,after_doc jsonb,extra jsonb default '{}',aid text default null) returns text language plpgsql set search_path=pg_catalog,public
as $$ declare idv text:=coalesce(aid,lab_private.new_id('ACT')); artifact jsonb; fid text; begin
 select facility_id into fid from public.incident_facility where incident_id=iid order by id limit 1;
 artifact:=jsonb_build_object('before',before_doc,'after',after_doc,'operation',extra);
 insert into public.activity_log(id,data) values(idv,jsonb_build_object('activity_id',idv,'incident_id',iid,'facility_id',fid,'entity_type',etype,'entity_id',eid,'action_type',action,'actor',auth.uid()::text,'timestamp',clock_timestamp(),'reason',reason,'before_ref',before_doc,'after_ref',after_doc,'authority_artifact',jsonb_build_object('payload',artifact,'sha256',encode(sha256(convert_to(artifact::text,'UTF8')),'hex')),'legacy_refs','[]'::jsonb));
 return idv;
end $$;

create function lab_private.completion_issues(iid text) returns jsonb language plpgsql stable set search_path=pg_catalog,public
as $$ declare w public.lab_incident_workflow%rowtype; c record; g record; disp jsonb; issues jsonb:='[]'; begin
 select * into w from public.lab_incident_workflow where incident_id=iid;
 if not lab_private.identity_ready(iid) then issues:=issues||jsonb_build_array(jsonb_build_object('kind','identity','message','Physical facility identity must be resolved.')); end if;
 if not coalesce(w.requirements_assessed,false) then issues:=issues||jsonb_build_array(jsonb_build_object('kind','requirements','message','A supervisor must assess which facts are required and which are optional.')); end if;
 for c in select c1.*,coalesce(cw.review_needed,false) as needs_review from public.claim c1 left join public.lab_claim_workflow cw on cw.claim_id=c1.id where coalesce((c1.data->>'is_current')::boolean,true) and (c1.incident_id=iid or (c1.data->>'claim_family' in ('IDENTITY','FACILITY_TYPE') and exists(select 1 from public.incident_facility x where x.incident_id=iid and x.facility_id=c1.facility_id))) loop
  if c.id=any(w.optional_claim_ids) and not c.id=any(w.required_claim_ids) then continue; end if;
  disp:=w.dispositions->c.id;
  if disp->>'disposition' in ('deferred','unable_to_resolve','not_required') and lab_private.nonblank(disp->>'reason') then continue; end if;
  if c.data->>'individual_human_factual_adjudication' is distinct from 'YES' or c.needs_review or c.data->>'validation_state' in ('NOT_REVIEWED','CONFLICTING') then
   issues:=issues||jsonb_build_array(jsonb_build_object('kind','fact','claim_id',c.id,'subject',c.data->>'subject','state',c.data->>'validation_state','message','Required factual work needs a current human review or explicit disposition.'));
  end if;
 end loop;
 for g in select * from public.gap_task where incident_id=iid and data->>'status' in ('open','in progress','blocked') and coalesce(data->>'task_disposition','active') not in ('deferred','unable_to_resolve','resolved') and (claim_id is null or not claim_id=any(w.optional_claim_ids) or claim_id=any(w.required_claim_ids)) loop
  issues:=issues||jsonb_build_array(jsonb_build_object('kind','task','gap_task_id',g.id,'message',g.data->>'factual_question'));
 end loop;
 return issues;
end $$;

create function lab_private.project_incident(iid text) returns void language plpgsql set search_path=pg_catalog,public
as $$ declare w public.lab_incident_workflow%rowtype; itype text:='unresolved cluster'; d jsonb; p text; ev jsonb; begin
 select * into w from public.lab_incident_workflow where incident_id=iid;
 -- Never silently retype preserved research as a side effect of adding evidence.
 if w.entered_by is null then return; end if;
 if w.working_type='Attack-and-effect episode' then
  if exists(select 1 from public.claim where incident_id=iid and lab_private.causal_pair_eligible(id)) then itype:='combined supported causal episode'; end if;
 elsif w.working_type in ('Strike event','Research lead') then
  if exists(select 1 from public.claim where incident_id=iid and data->>'claim_family'='KINETIC_EVENT' and data->'current_verified_value'='true'::jsonb and lab_private.eligible(id)) then itype:='kinetic episode'; end if;
 elsif w.working_type in ('Operational-status episode','Service / follow-up observation') then
  if exists(select 1 from public.claim where incident_id=iid and lab_private.effect_family(data->>'claim_family') and lab_private.eligible(id)) then itype:='operational episode'; end if;
 end if;
 select data into d from public.incident where id=iid;
 d:=d||jsonb_build_object('incident_type',itype);
 -- Only unambiguous eligible dates project into event chronology. Never use publication/restoration.
 if (select count(*) from public.claim where incident_id=iid and data->>'claim_family'='EVENT_DATE' and lab_private.eligible(id))=1 then
  select data->'current_verified_value',data->>'date_precision' into ev,p from public.claim where incident_id=iid and data->>'claim_family'='EVENT_DATE' and lab_private.eligible(id);
  d:=d||jsonb_build_object('event_start',case when p='RANGE' then ev->'start' else ev end,'event_end',case when p='RANGE' then ev->'end' else null end,'date_precision',p);
 else d:=d||jsonb_build_object('event_start',null,'event_end',null,'date_precision','UNKNOWN'); end if;
 update public.incident set data=d where id=iid;
end $$;

create function public.lab_commit(p_request jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$ declare actor uuid; op uuid; iid text; kindv text; payload jsonb; digestv text; prior public.lab_idempotency%rowtype; rev bigint; fid text;
 nf jsonb; inc jsonb; newdoc jsonb; olddoc jsonb; oldw jsonb; effect jsonb; issues jsonb; resultv jsonb; eventid text;
 w public.lab_incident_workflow%rowtype; geom jsonb; v text; other text; required text[]; optional text[]; k text; item jsonb; overridev boolean; materialv boolean:=false;
 begin
 actor:=lab_private.require_actor(false);
 if jsonb_typeof(p_request) is distinct from 'object' or length(p_request::text)>2000000 then raise exception 'Submission is missing or exceeds the pilot limit.'; end if;
 op:=(p_request->>'operation_id')::uuid; iid:=p_request->>'incident_id';kindv:=p_request->>'kind';payload:=p_request->'payload';
 if op is null or not lab_private.nonblank(iid) or length(iid)>200 or jsonb_typeof(payload) is distinct from 'object' then raise exception 'A submission requires an operation ID, incident ID, and payload.'; end if;
 if kindv is null or kindv not in ('create_incident','submit_changes','complete_incident','reopen_incident','update_requirements') then raise exception 'Unsupported lab operation.'; end if;
 if kindv in ('complete_incident','reopen_incident','update_requirements') then perform lab_private.require_actor(true); end if;
 -- Pilot-scale serialized critical section; row revisions still reject stale clients.
 perform pg_advisory_xact_lock(749310091::bigint);
 digestv:=encode(sha256(convert_to(p_request::text,'UTF8')),'hex');
 select * into prior from public.lab_idempotency where operation_id=op;
 if found then
  if prior.owner_id<>actor or prior.request_hash<>digestv then raise exception using errcode='23505',message='This submission ID has already been used for a different request.'; end if;
  return prior.result;
 end if;
 if not (p_request ? 'expected_revision') or jsonb_typeof(p_request->'expected_revision')<>'number' then raise exception 'Expected revision is required.'; end if;
 insert into public.lab_idempotency(operation_id,owner_id,request_hash) values(op,actor,digestv);
 if kindv='create_incident' then
  if (p_request->>'expected_revision')::bigint<>0 or exists(select 1 from public.incident where id=iid) then raise exception using errcode='40001',message='This incident already exists. Reload before creating another.'; end if;
  nf:=payload->'new_facility';fid:=nullif(payload->>'facility_id','');
  if fid is not null and nf is not null and nf<>'null'::jsonb then raise exception 'Choose an existing facility or propose a new one, not both.'; end if;
  if fid is null then
   if jsonb_typeof(nf) is distinct from 'object' or not lab_private.nonblank(nf->>'working_name') or nf->>'duplicate_disposition' is null or nf->>'duplicate_disposition' not in ('different','unsure') or not lab_private.nonblank(nf->>'duplicate_reason') then raise exception 'Compare possible matches and record whether this is different or still uncertain.'; end if;
   fid:=coalesce(nullif(nf->>'facility_id',''),lab_private.new_id('F'));
   geom:=nf->'geo';
   if geom is not null and geom<>'null'::jsonb then
    if jsonb_typeof(geom->'latitude') is distinct from 'number' or jsonb_typeof(geom->'longitude') is distinct from 'number' or (geom->>'latitude')::numeric not between -90 and 90 or (geom->>'longitude')::numeric not between -180 and 180 or not lab_private.nonblank(geom->>'source') or not lab_private.nonblank(geom->>'method') or not lab_private.nonblank(geom->>'precision') or not lab_private.nonblank(geom->>'limitations') then raise exception 'Coordinates need valid paired numbers, source, method, precision and limitations; otherwise leave them unknown.'; end if;
   end if;
   newdoc:=jsonb_build_object('facility_id',fid,'canonical_name',null,'aliases',jsonb_build_array(jsonb_build_object('value',nf->>'working_name','verification_state','NOT_REVIEWED','source','human entry','language','unknown')),'identity_status',case when nf->>'duplicate_disposition'='unsure' then 'POSSIBLE_DUPLICATE_OR_RELATED_RECORD' else 'PARTIALLY_IDENTIFIED' end,'identity_notes',nf->>'duplicate_reason','source_described_types',jsonb_build_array(jsonb_build_object('value',nf->>'source_described_type','verification_state','NOT_REVIEWED')),'locality_governorate',jsonb_build_object('locality',nf->>'locality','location_description',nf->>'location'),'geo',geom,'authoritative_source_records','[]'::jsonb,'legacy_refs','[]'::jsonb,'created_at',clock_timestamp(),'updated_at',clock_timestamp());
   if nf ? 'aliases' and nf->'aliases'<>'null'::jsonb then
    if jsonb_typeof(nf->'aliases')<>'array' then raise exception 'Alternate names must be a list.'; end if;
    for item in select value from jsonb_array_elements(nf->'aliases') loop
     if jsonb_typeof(item)<>'string' or not lab_private.nonblank(item#>>'{}') then raise exception 'Each alternate name must be a nonblank source-described name.'; end if;
     newdoc:=jsonb_set(newdoc,'{aliases}',newdoc->'aliases'||jsonb_build_array(jsonb_build_object('value',item#>>'{}','verification_state','NOT_REVIEWED','source','human entry','language','unknown')));
    end loop;
   end if;
   insert into public.facility(id,data) values(fid,newdoc);
  elsif not exists(select 1 from public.facility where id=fid) then raise exception 'Select an existing physical facility.'; end if;
  inc:=payload->'incident';
  if not lab_private.nonblank(inc->>'incident_label') or inc->>'working_type' is null or inc->>'working_type' not in ('Strike event','Attack-and-effect episode','Operational-status episode','Service / follow-up observation','Research lead') then raise exception 'Name the working incident and choose its record type.'; end if;
  insert into public.incident(id,data) values(iid,jsonb_build_object('incident_id',iid,'incident_label',inc->>'incident_label','incident_type','unresolved cluster','event_start',null,'event_end',null,'date_precision','UNKNOWN','current_workflow_status','validation pending','clustering_status','unresolved cluster','clustering_basis',coalesce(inc->>'duplicate_reason','Manual submission; separate-event explanation remains available in activity'),'temporal_eligibility','unresolved','legacy_case_refs','[]'::jsonb,'created_at',clock_timestamp(),'updated_at',clock_timestamp()));
  v:=lab_private.new_id('IF');
  insert into public.incident_facility(id,data) values(v,jsonb_build_object('incident_facility_id',v,'incident_id',iid,'facility_id',fid,'facility_match_state','unresolved','role','unresolved','identity_basis_claim_ids','[]'::jsonb,'is_current',true,'relationship_notes','Manual submission: identity and attack relationship require evidence.','legacy_refs','[]'::jsonb));
  insert into public.lab_incident_workflow(incident_id,status,working_type,entered_by) values(iid,case when coalesce((inc->>'lead')::boolean,false) or inc->>'working_type'='Research lead' then 'research_lead' else 'in_progress' end,inc->>'working_type',actor);
  if nf is not null and nf<>'null'::jsonb then perform lab_private.audit(iid,'FACILITY',fid,'create','New facility proposed with identity under review',null,(select data from public.facility where id=fid),nf); end if;
  effect:=lab_private.apply_changes(iid,coalesce(payload->'changes','[]'::jsonb));
  if nf is not null and nf<>'null'::jsonb and (not exists(select 1 from public.claim where facility_id=fid and data->>'claim_family'='IDENTITY') or not exists(select 1 from public.claim where facility_id=fid and data->>'claim_family'='FACILITY_TYPE')) then raise exception 'A new facility needs both an identity fact and a facility-type fact, even if both remain unreviewed.'; end if;
  perform lab_private.project_incident(iid);
  perform lab_private.audit(iid,'INCIDENT',iid,'create','New incident submitted to Team Review',null,(select data from public.incident where id=iid),jsonb_build_object('operation_id',op,'working_description',inc));
  rev:=1;
 else
  select revision,data into rev,olddoc from public.incident where id=iid for update;
  if not found then raise exception 'Incident not found.'; end if;
  if rev<>(p_request->>'expected_revision')::bigint then raise exception using errcode='40001',message='Someone else changed this record while you were reviewing it. Reload the latest version before submitting.'; end if;
  insert into public.lab_incident_workflow(incident_id) values(iid) on conflict do nothing;
  select * into w from public.lab_incident_workflow where incident_id=iid for update;
  oldw:=to_jsonb(w);
  if kindv='submit_changes' then
   if jsonb_typeof(payload->'changes') is distinct from 'array' or jsonb_array_length(payload->'changes')=0 then raise exception 'There are no proposed changes to submit.'; end if;
   effect:=lab_private.apply_changes(iid,payload->'changes');materialv:=coalesce((effect->>'material')::boolean,false);
   if materialv and w.status in ('review_complete','supervisor_override') then
    update public.lab_incident_workflow set status='reopened' where incident_id=iid;
    perform lab_private.audit(iid,'INCIDENT',iid,'reopen','Material research change reopened review',oldw,(select to_jsonb(x) from public.lab_incident_workflow x where incident_id=iid));
   elsif w.status='preserved_unassessed' then
    -- Preserved records stay truthfully unassessed until requirements/completion are explicitly considered.
    null;
   end if;
   perform lab_private.project_incident(iid);
  elsif kindv='update_requirements' then
   if not lab_private.nonblank(payload->>'reason') or jsonb_typeof(payload->'required_claim_ids') is distinct from 'array' or jsonb_typeof(payload->'optional_claim_ids') is distinct from 'array' or jsonb_typeof(coalesce(payload->'dispositions','{}')) is distinct from 'object' then raise exception 'Record required/optional work and a reason for the completion configuration.'; end if;
   select coalesce(array_agg(value),'{}'::text[]) into required from jsonb_array_elements_text(payload->'required_claim_ids');
   select coalesce(array_agg(value),'{}'::text[]) into optional from jsonb_array_elements_text(payload->'optional_claim_ids');
   if required&&optional then raise exception 'A fact cannot be both required and optional.'; end if;
   foreach v in array required||optional loop perform lab_private.assert_claim_scope(v,iid); end loop;
   for k,item in select key,value from jsonb_each(coalesce(payload->'dispositions','{}')) loop
    perform lab_private.assert_claim_scope(k,iid);
    if item->>'disposition' is null or item->>'disposition' not in ('deferred','unable_to_resolve','not_required') or not lab_private.nonblank(item->>'reason') then raise exception 'Each explicit disposition needs a reason.'; end if;
   end loop;
   update public.lab_incident_workflow set required_claim_ids=required,optional_claim_ids=optional,dispositions=coalesce(payload->'dispositions','{}'),requirements_assessed=true,status=case when status in ('review_complete','supervisor_override') then 'reopened' when status='preserved_unassessed' then 'in_progress' else status end where incident_id=iid;
   perform lab_private.audit(iid,'INCIDENT',iid,'revise','Completion requirements assessed: '||(payload->>'reason'),oldw,(select to_jsonb(x) from public.lab_incident_workflow x where incident_id=iid));
  elsif kindv='complete_incident' then
   if not lab_private.nonblank(payload->>'reason') then raise exception 'A supervisor completion reason is required.'; end if;
   if not lab_private.identity_ready(iid) then raise exception 'Resolve the physical facility identity before completion; a supervisor cannot override this safeguard.'; end if;
   issues:=lab_private.completion_issues(iid);overridev:=coalesce((payload->>'override')::boolean,false);
   if not overridev and jsonb_array_length(issues)>0 then raise exception using message='Required/material review work is incomplete.',detail=issues::text; end if;
   if overridev and jsonb_array_length(issues)=0 then raise exception 'Normal completion is available; use the ordinary completion path.'; end if;
   update public.lab_incident_workflow set status=case when overridev then 'supervisor_override' else 'review_complete' end,completion=jsonb_build_object('supervisor',actor,'timestamp',clock_timestamp(),'reviewed_revision',rev,'completion_revision',rev+1,'reason',payload->>'reason','override',overridev,'unresolved_items',issues,'previous_completion',w.completion,'previous_status',w.status) where incident_id=iid;
   perform lab_private.audit(iid,'INCIDENT',iid,'validate',case when overridev then 'Supervisor completion override: ' else 'Normal incident completion: ' end||(payload->>'reason'),oldw,(select to_jsonb(x) from public.lab_incident_workflow x where incident_id=iid));
  elsif kindv='reopen_incident' then
   if not lab_private.nonblank(payload->>'reason') then raise exception 'Record why this incident needs review again.'; end if;
   update public.lab_incident_workflow set status='reopened' where incident_id=iid;
   perform lab_private.audit(iid,'INCIDENT',iid,'reopen',payload->>'reason',oldw,(select to_jsonb(x) from public.lab_incident_workflow x where incident_id=iid));
  end if;
  rev:=rev+1;
  update public.incident set revision=rev where id=iid;
  update public.lab_incident_workflow set revision=rev where incident_id=iid;
  if kindv='submit_changes' and not materialv and w.status in ('review_complete','supervisor_override') then
   update public.lab_incident_workflow set completion=completion||jsonb_build_object('completion_revision',rev,'carried_forward_at',clock_timestamp(),'carried_forward_reason','Nonmaterial evidence appended; original completion decision preserved') where incident_id=iid;
   perform lab_private.audit(iid,'INCIDENT',iid,'derive','Completion carried forward after nonmaterial evidence; no new completion approval',oldw,(select to_jsonb(x) from public.lab_incident_workflow x where incident_id=iid));
  end if;
 end if;
 -- Shared facility-scope review/evidence invalidates linked incident snapshots.
 for other in select distinct x.incident_id from public.incident_facility x where x.incident_id<>iid and x.facility_id in (select jsonb_array_elements_text(coalesce(effect->'facility_touches','[]'))) loop
  select to_jsonb(x) into oldw from public.lab_incident_workflow x where incident_id=other;
  update public.incident set revision=revision+1 where id=other;
  update public.lab_incident_workflow set revision=(select revision from public.incident where id=other),status=case when status in ('review_complete','supervisor_override') then 'reopened' else status end where incident_id=other;
  perform lab_private.audit(other,'INCIDENT',other,'reopen','Shared facility identity/type review changed; inspect the latest revision',oldw,(select to_jsonb(x) from public.lab_incident_workflow x where incident_id=other),jsonb_build_object('originating_incident',iid));
 end loop;
 select status into v from public.lab_incident_workflow where incident_id=iid;
 resultv:=jsonb_build_object('operation_id',op,'incident_id',iid,'revision',rev,'status',v,'created_ids',coalesce(effect->'created_ids','[]'::jsonb));
 update public.lab_idempotency set result=resultv where operation_id=op;
 return resultv;
end $$;

create function public.lab_snapshot() returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$ declare actor uuid:=lab_private.require_actor(false); n text; rowsv jsonb; revs jsonb; records jsonb:='{}'; revisions jsonb:='{}'; wi jsonb; wc jsonb; ds jsonb; profile jsonb; begin
 perform pg_advisory_xact_lock(749310091::bigint);
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

create function public.lab_save_draft(p_id text,p_expected_revision bigint,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$ declare actor uuid:=lab_private.require_actor(false); d public.lab_private_drafts%rowtype; begin
 if not lab_private.nonblank(p_id) or length(p_id)>200 or p_payload is null or length(p_payload::text)>2000000 then raise exception 'Draft requires an ID and a bounded payload.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_id,0));
 select * into d from public.lab_private_drafts where owner_id=actor and id=p_id for update;
 if found then
  if p_expected_revision is null or d.revision<>p_expected_revision then raise exception using errcode='40001',message='This private draft changed. Reload it before saving.'; end if;
  update public.lab_private_drafts set payload=p_payload,revision=revision+1,updated_at=clock_timestamp() where owner_id=actor and id=p_id returning * into d;
 else
  if p_expected_revision is distinct from 0::bigint then raise exception using errcode='40001',message='Private draft not found at the expected revision.'; end if;
  insert into public.lab_private_drafts(id,owner_id,payload) values(p_id,actor,p_payload) returning * into d;
 end if;
 return to_jsonb(d);
end $$;
create function public.lab_delete_draft(p_id text,p_expected_revision bigint) returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$ declare actor uuid:=lab_private.require_actor(false); n int; begin
 delete from public.lab_private_drafts where owner_id=actor and id=p_id and revision=p_expected_revision;
 get diagnostics n=row_count;
 if n=0 then raise exception using errcode='40001',message='Private draft not found at this revision.'; end if;
 return jsonb_build_object('deleted',p_id);
end $$;

-- Default function privileges are PUBLIC: close every helper before committing.
revoke all on all functions in schema lab_private from public,anon,authenticated;
grant execute on function lab_private.active_user() to authenticated;
revoke all on function public.lab_snapshot(),public.lab_commit(jsonb),public.lab_save_draft(text,bigint,jsonb),public.lab_delete_draft(text,bigint) from public,anon,authenticated;
grant execute on function public.lab_snapshot(),public.lab_commit(jsonb),public.lab_save_draft(text,bigint,jsonb),public.lab_delete_draft(text,bigint) to authenticated;
commit;


-- Persistent Lab Pilot V2: targeted facility governance, 2026-09-24.
-- Run after unchanged 001 and 002. No baseline payload is updated by migration.
begin;
create table public.lab_facility_workflow(
 facility_id text primary key references public.facility(id),
 location_required boolean not null default true,
 reason text not null, reviewer uuid references public.lab_profiles(user_id),
 reviewed_at timestamptz, revision bigint not null default 1 check(revision>0)
);
create table public.lab_facility_resolution(
 id text primary key, facility_id text not null references public.facility(id),
 target_facility_id text references public.facility(id),
 outcome text not null check(outcome in ('same','different','unsure')),
 identity_claim_id text not null references public.claim(id),
 source_id text not null references public.source(id),
 reviewer uuid not null references public.lab_profiles(user_id),
 reviewed_at timestamptz not null, basis text not null, review_note text not null,
 activity_id text not null references public.activity_log(id),
 incident_ids text[] not null, check(facility_id is distinct from target_facility_id)
);
alter table public.lab_facility_workflow enable row level security;
alter table public.lab_facility_resolution enable row level security;
revoke all on public.lab_facility_workflow,public.lab_facility_resolution from public,anon,authenticated;
grant select on public.lab_facility_workflow,public.lab_facility_resolution to authenticated;
create policy lab_read on public.lab_facility_workflow for select to authenticated using(lab_private.active_user());
create policy lab_read on public.lab_facility_resolution for select to authenticated using(lab_private.active_user());
create trigger resolution_no_rewrite before update or delete on public.lab_facility_resolution for each row execute function lab_private.immutable_history();

-- A retired association remains inspectable but must not govern current facts.
create function lab_private.current_link(iid text,fid text) returns boolean language sql stable set search_path=pg_catalog,public
as $$ select exists(select 1 from public.incident_facility x where x.incident_id=iid and x.facility_id=fid and coalesce((x.data->>'is_current')::boolean,true)) $$;
create function lab_private.fact_in_scope(cid text,iid text) returns boolean language sql stable set search_path=pg_catalog,public
as $$ select exists(select 1 from public.claim c where c.id=cid and case when c.data->>'claim_family' in ('IDENTITY','FACILITY_TYPE') then lab_private.current_link(iid,c.facility_id) else c.incident_id=iid end) $$;
create or replace function lab_private.assert_claim_scope(cid text,iid text) returns void language plpgsql stable set search_path=pg_catalog,public
as $$ begin if not lab_private.fact_in_scope(cid,iid) then raise exception 'This fact is not part of the selected incident or its current physical facility. Historical associations remain available in history.'; end if; end $$;
create function lab_private.facility_identity_ready(fid text) returns boolean language sql stable set search_path=pg_catalog,public
as $$ select exists(select 1 from public.facility f where f.id=fid and f.data->>'identity_status'='IDENTIFIED')
 and exists(select 1 from public.claim c where c.facility_id=fid and c.data->>'claim_family'='IDENTITY' and coalesce(c.data->>'identity_purpose','')<>'facility_comparison' and c.data->>'value_type' in ('BOOLEAN','TEXT_WHERE_REQUIRED') and lab_private.eligible(c.id))
 and not exists(select 1 from public.claim c left join public.lab_claim_workflow w on w.claim_id=c.id where c.facility_id=fid and c.data->>'claim_family'='IDENTITY' and coalesce(c.data->>'identity_purpose','')<>'facility_comparison' and c.data->>'value_type' in ('BOOLEAN','TEXT_WHERE_REQUIRED') and coalesce((c.data->>'is_current')::boolean,true) and (c.data->>'validation_state'='CONFLICTING' or coalesce(w.review_needed,false)))
 and not exists(select 1 from public.lab_facility_resolution r where r.facility_id=fid and r.outcome='same') $$;
create or replace function lab_private.identity_ready(iid text) returns boolean language sql stable set search_path=pg_catalog,public
as $$ select exists(select 1 from public.incident_facility x where x.incident_id=iid and coalesce((x.data->>'is_current')::boolean,true))
 and not exists(select 1 from public.incident_facility x where x.incident_id=iid and coalesce((x.data->>'is_current')::boolean,true) and not lab_private.facility_identity_ready(x.facility_id)) $$;

create function lab_private.facility_readiness(fid text) returns jsonb language plpgsql stable set search_path=pg_catalog,public
as $$ declare f jsonb; typ jsonb; ls text; lr boolean; tr boolean; ir boolean; res jsonb; begin
 select data into f from public.facility where id=fid;
 select coalesce(location_required,false) into lr from public.lab_facility_workflow where facility_id=fid; lr:=coalesce(lr,false);
 ls:=coalesce(f->'location_review'->>'state','NOT_REVIEWED');
 select case when count(distinct data->'current_verified_value')=1 then min((data->'current_verified_value')::text)::jsonb else null end into typ from public.claim where facility_id=fid and data->>'claim_family'='FACILITY_TYPE' and lab_private.eligible(id);
 tr:=typ is not null and typ<>'null'::jsonb and not exists(select 1 from public.claim c left join public.lab_claim_workflow w on w.claim_id=c.id where c.facility_id=fid and c.data->>'claim_family'='FACILITY_TYPE' and coalesce((c.data->>'is_current')::boolean,true) and (c.data->>'validation_state'='CONFLICTING' or coalesce(w.review_needed,false)));
 ir:=lab_private.facility_identity_ready(fid);
 select to_jsonb(r) into res from public.lab_facility_resolution r where facility_id=fid order by reviewed_at desc,id desc limit 1;
 return jsonb_build_object('facility_id',fid,'revision',(select revision from public.facility where id=fid),'identity_ready',ir,'facility_type',case when tr then typ else null end,'type_ready',tr,'location_state',ls,'location_required',lr,'location_ready',ls='SUPPORTED','downstream_ready',ir and tr and (not lr or ls='SUPPORTED'),'resolution',res);
end $$;
create function lab_private.incident_facility_ready(iid text) returns boolean language sql stable set search_path=pg_catalog,public
as $$ select lab_private.identity_ready(iid) and not exists(select 1 from public.incident_facility x where x.incident_id=iid and coalesce((x.data->>'is_current')::boolean,true) and not (lab_private.facility_readiness(x.facility_id)->>'downstream_ready')::boolean) $$;

create or replace function lab_private.completion_issues(iid text) returns jsonb language plpgsql stable set search_path=pg_catalog,public
as $$ declare w public.lab_incident_workflow%rowtype; c record; g record; disp jsonb; issues jsonb:='[]'; begin
 select * into w from public.lab_incident_workflow where incident_id=iid;
 if not lab_private.identity_ready(iid) then issues:=issues||jsonb_build_array(jsonb_build_object('kind','identity','message','Physical facility identity must be resolved.')); end if;
 if not coalesce(w.requirements_assessed,false) then issues:=issues||jsonb_build_array(jsonb_build_object('kind','requirements','message','A supervisor must assess which facts are required and which are optional.')); end if;
 for c in select c1.*,coalesce(cw.review_needed,false) as needs_review from public.claim c1 left join public.lab_claim_workflow cw on cw.claim_id=c1.id where coalesce((c1.data->>'is_current')::boolean,true) and lab_private.fact_in_scope(c1.id,iid) loop
  if c.id=any(w.optional_claim_ids) and not c.id=any(w.required_claim_ids) then continue; end if;
  disp:=w.dispositions->c.id;
  if disp->>'disposition' in ('deferred','unable_to_resolve','not_required') and lab_private.nonblank(disp->>'reason') then continue; end if;
  if c.data->>'individual_human_factual_adjudication' is distinct from 'YES' or c.needs_review or c.data->>'validation_state' in ('NOT_REVIEWED','CONFLICTING') then issues:=issues||jsonb_build_array(jsonb_build_object('kind','fact','claim_id',c.id,'subject',c.data->>'subject','state',c.data->>'validation_state','message','Required factual work needs a current human review or explicit disposition.')); end if;
 end loop;
 for g in select * from public.gap_task where incident_id=iid and data->>'status' in ('open','in progress','blocked') and coalesce(data->>'task_disposition','active') not in ('deferred','unable_to_resolve','resolved') and (claim_id is null or lab_private.fact_in_scope(claim_id,iid)) and (claim_id is null or not claim_id=any(w.optional_claim_ids) or claim_id=any(w.required_claim_ids)) loop
  issues:=issues||jsonb_build_array(jsonb_build_object('kind','task','gap_task_id',g.id,'message',g.data->>'factual_question'));
 end loop;
 for c in select distinct x.facility_id from public.incident_facility x join public.lab_facility_workflow fw on fw.facility_id=x.facility_id where x.incident_id=iid and coalesce((x.data->>'is_current')::boolean,true) and fw.location_required loop
  if lab_private.facility_readiness(c.facility_id)->>'location_state'<>'SUPPORTED' then issues:=issues||jsonb_build_array(jsonb_build_object('kind','location','facility_id',c.facility_id,'message','Material facility location needs supported human review or an explicit supervisor requirement disposition.')); end if;
 end loop;
 return issues;
end $$;

-- Keep the tested V1 engines intact, behind wrappers enforcing current scope.
alter function lab_private.apply_changes(text,jsonb) rename to apply_changes_v1;
create function lab_private.apply_changes(iid text,changes jsonb) returns jsonb language plpgsql set search_path=pg_catalog,public
as $$ declare ch jsonb; f text; fid text; begin
 for ch in select value from jsonb_array_elements(changes) loop
  if ch->>'type'='new_fact' then
   f:=ch->'claim'->>'claim_family';fid:=ch->'claim'->>'facility_id';
   if fid is not null and not lab_private.current_link(iid,fid) then raise exception 'New fact facility must be currently associated with this incident.'; end if;
   if ch->'claim' ? 'identity_purpose' or ch->'claim' ? 'comparison_target_facility_id' then raise exception 'Use the explicit facility comparison workflow for same/different/unsure identity decisions.'; end if;
  elsif ch->>'type' in ('review','evidence') and exists(select 1 from public.claim where id=ch->>'claim_id' and data->>'identity_purpose'='facility_comparison') then
   raise exception 'Facility comparison decisions are preserved in history. Use the facility-resolution workflow for a further decision.';
  elsif ch->>'type'='review' and ch->>'identity_disposition'='different' and exists(select 1 from public.claim c join public.facility f on f.id=c.facility_id where c.id=ch->>'claim_id' and c.data->>'claim_family'='IDENTITY' and f.data->>'identity_status' in ('POSSIBLE_DUPLICATE_OR_RELATED_RECORD','POSSIBLE_SUPPLEMENTAL_MATCH_NEEDS_REVIEW')) then
   raise exception 'A name review cannot settle a possible duplicate. Use the explicit same/different/unsure facility comparison with a selected target and evidence.';
  end if;
 end loop;
 return lab_private.apply_changes_v1(iid,changes);
end $$;

create function lab_private.assert_relation(rel jsonb) returns void language plpgsql immutable set search_path=pg_catalog
as $$ begin
 if rel->>'support_direction' is null or rel->>'support_direction' not in ('SUPPORTS','CONTRADICTS','LIMITS','CONTEXT_ONLY') then raise exception 'Choose the evidence relationship explicitly.'; end if;
 if rel->>'directness' is not null and rel->>'directness' not in ('direct','secondary','inferred','indexed-only','contextual') then raise exception 'Choose valid directness or Unknown.'; end if;
 if rel->>'originality' is null or rel->>'originality' not in ('original','republication','syndication','repost','unknown') then raise exception 'Record originality explicitly.'; end if;
 if jsonb_typeof(rel->'evidence_locator') is distinct from 'array' or not exists(select 1 from jsonb_array_elements(rel->'evidence_locator') x where lab_private.nonblank(x->>'locator') and lab_private.nonblank(coalesce(x->>'excerpt',x->>'description'))) then raise exception 'Evidence needs an exact locator and passage or description.'; end if;
 if not lab_private.nonblank(rel->>'limitations') then raise exception 'Record evidence limitations explicitly.'; end if;
end $$;
create function lab_private.intake_source(p jsonb) returns text language plpgsql set search_path=pg_catalog,public
as $$ declare sid text:=nullif(p->>'source_id',''); s jsonb:=p->'source'; d jsonb; begin
 if sid is not null then
  if s is not null and s<>'null'::jsonb then raise exception 'Reuse a source or supply a new source, not both.'; end if;
  if not exists(select 1 from public.source where id=sid) then raise exception 'Selected evidence source was not found.'; end if;
  return sid;
 end if;
 perform lab_private.assert_source(s);sid:=coalesce(nullif(s->>'source_id',''),lab_private.new_id('S'));
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into d from jsonb_each(s) where key=any(array['source_type','title','publisher_platform','original_url','canonical_url','publication_date','retrieval_body_status','content_preservation_status','evidence_locator','limitations','social_fields']);
 insert into public.source(id,data) values(sid,d||jsonb_build_object('source_id',sid,'retrieval_date',null,'legacy_refs','[]'::jsonb));return sid;
end $$;
create function lab_private.assert_location(p jsonb) returns void language plpgsql immutable set search_path=pg_catalog
as $$ declare geo jsonb:=p->'coordinates'; begin
 if jsonb_typeof(p) is distinct from 'object' or not lab_private.nonblank(p->>'method') or not lab_private.nonblank(p->>'precision') or not lab_private.nonblank(p->>'limitations') then raise exception 'Location evidence needs method, precision and limitations, including Unknown when appropriate.'; end if;
 if geo is not null and geo<>'null'::jsonb and (jsonb_typeof(geo) is distinct from 'object' or jsonb_typeof(geo->'latitude') is distinct from 'number' or jsonb_typeof(geo->'longitude') is distinct from 'number' or (geo->>'latitude')::numeric not between -90 and 90 or (geo->>'longitude')::numeric not between -180 and 180) then raise exception 'Provide valid paired facility coordinates or leave coordinates null.'; end if;
end $$;
create function lab_private.facility_evidence(iid text,fid text,p jsonb) returns jsonb language plpgsql set search_path=pg_catalog,public
as $$ declare sid text; scopev text; cid text; d jsonb; old jsonb; eff jsonb; created jsonb:='[]'; rel jsonb:=p->'relation'; loc jsonb:=p->'location'; begin
 if jsonb_typeof(p->'scopes') is distinct from 'array' or jsonb_array_length(p->'scopes')=0 or jsonb_array_length(p->'scopes')>3 then raise exception 'Select the facility dimensions this source actually supports.'; end if;
 if (select count(distinct value) from jsonb_array_elements_text(p->'scopes'))<>jsonb_array_length(p->'scopes') then raise exception 'Facility evidence scopes must be distinct.'; end if;
 perform lab_private.assert_relation(rel); sid:=lab_private.intake_source(p);
 if not (p ? 'source_id') then created:=jsonb_build_array(jsonb_build_object('type','SOURCE','id',sid)); end if;
 for scopev in select jsonb_array_elements_text(p->'scopes') loop
  if scopev in ('identity','type') then
   cid:=p->>case scopev when 'identity' then 'identity_claim_id' else 'type_claim_id' end;
   if not exists(select 1 from public.claim where id=cid and facility_id=fid and data->>'claim_family'=case scopev when 'identity' then 'IDENTITY' else 'FACILITY_TYPE' end and coalesce(data->>'identity_purpose','')<>'facility_comparison') then raise exception 'Select the matching facility-scoped identity or type fact.'; end if;
   eff:=lab_private.apply_changes(iid,jsonb_build_array(jsonb_build_object('type','evidence','claim_id',cid,'source_id',sid,'relation',rel,'material',p->'material','material_reason',p->>'material_reason')));
   created:=created||(eff->'created_ids');
  elsif scopev='location' then
   perform lab_private.assert_location(loc);select data into old from public.facility where id=fid;
   d:=jsonb_build_object('source_id',sid,'scope','location','relation',rel,'location',loc,'entered_by',auth.uid(),'entered_at',clock_timestamp(),'human_review_state','NOT_REVIEWED');
   update public.facility set data=data||jsonb_build_object('location_evidence',coalesce(data->'location_evidence','[]'::jsonb)||jsonb_build_array(d),'location_review',coalesce(data->'location_review','{}'::jsonb)||jsonb_build_object('state','NOT_REVIEWED','previous_review_preserved',data->'location_review','reason','New location evidence awaits explicit review.')),revision=revision+1 where id=fid;
   perform lab_private.audit(iid,'FACILITY',fid,'revise','Location evidence added without certifying location',old,(select data from public.facility where id=fid),d);
  else raise exception 'Facility evidence scope must be identity, type or location.';
  end if;
 end loop;
 return jsonb_build_object('source_id',sid,'created_ids',created);
end $$;

create function lab_private.touch_facility_incidents(fid text,reasonv text) returns void language plpgsql set search_path=pg_catalog,public
as $$ declare x record; oldw jsonb; begin
 for x in select distinct incident_id from public.incident_facility where facility_id=fid and coalesce((data->>'is_current')::boolean,true) loop
  select to_jsonb(w) into oldw from public.lab_incident_workflow w where incident_id=x.incident_id;
  update public.incident set revision=revision+1 where id=x.incident_id;
  update public.lab_incident_workflow set revision=revision+1,status=case when status in ('review_complete','supervisor_override') then 'reopened' else status end where incident_id=x.incident_id;
  perform lab_private.audit(x.incident_id,'INCIDENT',x.incident_id,'revise',reasonv,oldw,(select to_jsonb(w) from public.lab_incident_workflow w where incident_id=x.incident_id));
 end loop;
end $$;

alter function public.lab_commit(jsonb) set schema lab_private;
alter function lab_private.lab_commit(jsonb) rename to commit_v1;
create function public.lab_commit(p_request jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$ declare actor uuid:=lab_private.require_actor(false); kindv text:=p_request->>'kind'; p jsonb:=p_request->'payload'; iid text:=p_request->>'incident_id'; fid text; target text; op uuid; digestv text; prior public.lab_idempotency%rowtype; rev bigint; frev bigint; trev bigint; resultv jsonb; eff jsonb; item jsonb; old jsonb; newdoc jsonb; rel jsonb; sid text; cid text; aid text; rid text; outcomev text; statev text; val jsonb; artifact jsonb; oldtarget jsonb; aliasv jsonb; x record; n text; affected text[]:='{}'; created jsonb:='[]'; expected bigint; k text; is_replay boolean; begin
 if jsonb_typeof(p_request) is distinct from 'object' or length(p_request::text)>2000000 then raise exception 'Submission is missing or exceeds the pilot limit.'; end if;
 perform pg_advisory_xact_lock(749310091::bigint);
 -- Original transaction engine retains all V1 validation, authority and gates.
 if kindv in ('create_incident','submit_changes','complete_incident','reopen_incident','update_requirements') then
  op:=(p_request->>'operation_id')::uuid;is_replay:=exists(select 1 from public.lab_idempotency where operation_id=op);
  if kindv='create_incident' and not is_replay and exists(select 1 from public.lab_facility_resolution where facility_id=p->>'facility_id' and outcome='same') then raise exception 'This preserved provisional record was resolved as the same physical facility. Select its authoritative current facility instead.'; end if;
  if kindv='create_incident' and p ? 'facility_evidence' and (jsonb_typeof(p->'facility_evidence') is distinct from 'array' or jsonb_array_length(p->'facility_evidence')>20) then raise exception 'Facility evidence must be a bounded list.'; end if;
  resultv:=lab_private.commit_v1(p_request);
  if is_replay then return resultv; end if;
  if kindv='create_incident' then
   select facility_id into fid from public.incident_facility where incident_id=iid and coalesce((data->>'is_current')::boolean,true) limit 1;
   if p->'new_facility' is not null and p->'new_facility'<>'null'::jsonb then
    insert into public.lab_facility_workflow(facility_id,location_required,reason) values(fid,true,'New facility location remains material until explicitly assessed.');
    update public.facility set data=data||jsonb_build_object('location_review',jsonb_build_object('state','NOT_REVIEWED','reviewer',null,'reviewed_at',null),'location_evidence','[]'::jsonb) where id=fid;
   end if;
   for item in select value from jsonb_array_elements(coalesce(p->'facility_evidence','[]'::jsonb)) loop
    eff:=lab_private.facility_evidence(iid,fid,item);created:=created||(eff->'created_ids');
   end loop;
  elsif kindv='update_requirements' and p ? 'facility_requirements' then
   if jsonb_typeof(p->'facility_requirements') is distinct from 'object' then raise exception 'Facility requirements must be keyed by current facility.'; end if;
   for k,item in select key,value from jsonb_each(p->'facility_requirements') loop
    if not lab_private.current_link(iid,k) or jsonb_typeof(item->'location_required') is distinct from 'boolean' or not lab_private.nonblank(item->>'reason') then raise exception 'Explicit current-facility location requirement and reason are required.'; end if;
    insert into public.lab_facility_workflow(facility_id,location_required,reason,reviewer,reviewed_at) values(k,(item->>'location_required')::boolean,item->>'reason',actor,clock_timestamp()) on conflict(facility_id) do update set location_required=excluded.location_required,reason=excluded.reason,reviewer=excluded.reviewer,reviewed_at=excluded.reviewed_at,revision=public.lab_facility_workflow.revision+1;
    perform lab_private.audit(iid,'FACILITY',k,'revise','Material location requirement explicitly assessed',null,item);
    for x in select distinct incident_id from public.incident_facility where facility_id=k and incident_id<>iid and coalesce((data->>'is_current')::boolean,true) loop
     select to_jsonb(w) into old from public.lab_incident_workflow w where incident_id=x.incident_id;
     update public.incident set revision=revision+1 where id=x.incident_id;
     update public.lab_incident_workflow set revision=revision+1,status=case when status in ('review_complete','supervisor_override') then 'reopened' else status end where incident_id=x.incident_id;
     perform lab_private.audit(x.incident_id,'INCIDENT',x.incident_id,'revise','Shared facility location requirement changed',old,(select to_jsonb(w) from public.lab_incident_workflow w where incident_id=x.incident_id),jsonb_build_object('facility_id',k,'originating_incident',iid));
    end loop;
   end loop;
  end if;
  resultv:=jsonb_set(resultv,'{created_ids}',coalesce(resultv->'created_ids','[]'::jsonb)||created);
  update public.lab_idempotency set result=resultv where operation_id=op; return resultv;
 end if;
 if kindv is null or kindv not in ('resolve_facility','review_location','facility_evidence') then raise exception 'Unsupported lab operation.'; end if;
 op:=(p_request->>'operation_id')::uuid;fid:=p->>'facility_id';
 if op is null or not lab_private.nonblank(iid) or jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p_request->'expected_revision') is distinct from 'number' or jsonb_typeof(p->'expected_facility_revision') is distinct from 'number' then raise exception 'Incident and facility revisions are required.'; end if;
 digestv:=encode(sha256(convert_to(p_request::text,'UTF8')),'hex');select * into prior from public.lab_idempotency where operation_id=op;
 if found then
  if prior.owner_id<>actor or prior.request_hash<>digestv then raise exception using errcode='23505',message='This submission ID has already been used for a different request.'; end if;return prior.result;
 end if;
 select revision into rev from public.incident where id=iid for update;
 if not found or rev<>(p_request->>'expected_revision')::bigint then raise exception using errcode='40001',message='The incident changed. Reload before submitting facility review.'; end if;
 select data,revision into old,frev from public.facility where id=fid for update;
 if not found or frev<>(p->>'expected_facility_revision')::bigint then raise exception using errcode='40001',message='The facility changed. Reload before submitting facility review.'; end if;
 if not lab_private.current_link(iid,fid) then raise exception 'Select a current facility association for this incident.'; end if;
 insert into public.lab_idempotency(operation_id,owner_id,request_hash) values(op,actor,digestv);
 if kindv='facility_evidence' then
  eff:=lab_private.facility_evidence(iid,fid,p);created:=eff->'created_ids';
  perform lab_private.touch_facility_incidents(fid,'Facility evidence requires inspection at the latest revision');
 elsif kindv='review_location' then
  perform lab_private.assert_location(p);perform lab_private.assert_relation(p->'relation');
  statev:=p->>'review_state';
  if statev is null or statev not in ('SUPPORTED','CONFLICTING','NEEDS_MORE_EVIDENCE') or (p->>'attestation') is distinct from 'true' or not lab_private.nonblank(p->>'basis') or not lab_private.nonblank(p->>'review_note') then raise exception 'Location review needs an explicit determination, evidence basis, review note and human attestation.'; end if;
  if statev='SUPPORTED' and not lab_private.nonblank(p->>'locality') and (p->'coordinates' is null or p->'coordinates'='null'::jsonb) then raise exception 'Supported location needs an established locality or coordinates.'; end if;
  if statev='SUPPORTED' and p->'relation'->>'support_direction'<>'SUPPORTS' then raise exception 'Supported location needs supporting evidence.'; end if;
  sid:=lab_private.intake_source(p);
  newdoc:=jsonb_build_object('state',statev,'locality',p->>'locality','coordinates',coalesce(p->'coordinates','null'::jsonb),'method',p->>'method','precision',p->>'precision','limitations',p->>'limitations','source_id',sid,'relation',p->'relation','basis',p->>'basis','review_note',p->>'review_note','reviewer',actor,'reviewed_at',clock_timestamp());
  aid:=lab_private.new_id('ACT');newdoc:=newdoc||jsonb_build_object('authority_artifact',aid);
  update public.facility set data=data||jsonb_build_object('location_review',newdoc,'location_evidence',coalesce(data->'location_evidence','[]'::jsonb)||jsonb_build_array(newdoc||jsonb_build_object('scope','location'))),revision=revision+1 where id=fid;
  if statev='SUPPORTED' then
   update public.facility set data=data||jsonb_build_object('locality_governorate',coalesce(data->'locality_governorate','{}'::jsonb)||jsonb_build_object('locality',p->>'locality'),'geo',case when p->'coordinates' is null or p->'coordinates'='null'::jsonb then 'null'::jsonb else p->'coordinates'||jsonb_build_object('source',sid,'method',p->>'method','precision',p->>'precision','limitations',p->>'limitations') end) where id=fid;
  end if;
  perform lab_private.audit(iid,'FACILITY',fid,'validate','Human review of facility location, separate from physical identity',old,(select data from public.facility where id=fid),newdoc,aid);
  perform lab_private.touch_facility_incidents(fid,'Facility location review changed; inspect the latest revision');
  created:=jsonb_build_array(jsonb_build_object('type','SOURCE','id',sid));
 else
  outcomev:=p->>'outcome';target:=nullif(p->>'target_facility_id','');
  if outcomev is null or outcomev not in ('same','different','unsure') or (p->>'attestation') is distinct from 'true' or not lab_private.nonblank(p->>'basis') or not lab_private.nonblank(p->>'review_note') then raise exception 'Facility resolution requires an explicit human decision, evidence basis, review note and attestation.'; end if;
  if outcomev in ('same','different') and target is null then raise exception 'Select the physical facility being compared.'; end if;
  if target=fid then raise exception 'A facility cannot be compared with itself.'; end if;
  if target is not null then
   select data,revision into oldtarget,trev from public.facility where id=target for update;
   if not found or jsonb_typeof(p->'expected_target_revision') is distinct from 'number' or trev<>(p->>'expected_target_revision')::bigint then raise exception using errcode='40001',message='The comparison facility changed. Reload before submitting.'; end if;
  end if;
  if exists(select 1 from public.lab_facility_resolution where facility_id=fid and outcome='same') then raise exception 'This provisional record has already been resolved as the same facility. Use its authoritative current association; reversal needs a separately authorized review.'; end if;
  if outcomev='same' and not lab_private.facility_identity_ready(target) then raise exception 'Select an authoritative existing facility with resolved physical identity.'; end if;
  if outcomev='same' then
   for x in select distinct i.id,i.revision from public.incident_facility z join public.incident i on i.id=z.incident_id where z.facility_id=fid and coalesce((z.data->>'is_current')::boolean,true) loop
    expected:=case when x.id=iid then (p_request->>'expected_revision')::bigint else (p->'incident_revisions'->>x.id)::bigint end;
    if expected is null or expected<>x.revision then raise exception using errcode='40001',message='Every incident currently linked to this provisional facility must be reviewed at its latest revision.'; end if;
    affected:=array_append(affected,x.id);
   end loop;
  else select coalesce(array_agg(distinct incident_id),'{}'::text[]) into affected from public.incident_facility where facility_id=fid and coalesce((data->>'is_current')::boolean,true); end if;
  rel:=p->'relation';perform lab_private.assert_relation(rel);
  if outcomev='same' and rel->>'support_direction'<>'SUPPORTS' then raise exception 'A same-facility decision needs supporting comparison evidence.'; end if;
  if outcomev='different' and rel->>'support_direction' not in ('CONTRADICTS','LIMITS') then raise exception 'A different-facility decision needs evidence contradicting or limiting the same-facility proposition.'; end if;
  sid:=lab_private.intake_source(p);cid:=lab_private.new_id('C');aid:=lab_private.new_id('ACT');rid:=lab_private.new_id('FR');
  val:=case outcomev when 'same' then 'true'::jsonb when 'different' then 'false'::jsonb else 'null'::jsonb end;statev:=case when outcomev='unsure' then 'NEEDS_MORE_EVIDENCE' else 'SUPPORTED' end;
  newdoc:=jsonb_build_object('claim_id',cid,'incident_id',iid,'facility_id',fid,'claim_family','IDENTITY','identity_purpose','facility_comparison','comparison_target_facility_id',target,'subject',case when target is null then 'The physical identity of facility record '||fid||' is established independently of possible existing records.' else 'Facility record '||fid||' represents the same physical facility as '||target||'.' end,'value_type','BOOLEAN','current_verified_value',val,'validation_state',statev,'validation_origin','V3_HUMAN_CLAIM_VALIDATION','individual_human_factual_adjudication','YES','ai_original_value',null,'ai_original_provenance',null,'reviewer',actor,'reviewed_at',clock_timestamp(),'review_notes',p->>'review_note','is_current',true,'date_precision',null,'quantitative_unit',null,'impact_basis',null,'legacy_refs','[]'::jsonb);
  insert into public.claim(id,data) values(cid,newdoc);insert into public.lab_claim_workflow(claim_id) values(cid);
  -- Direct call of preserved intake engine here is scoped by this server-created comparison.
  eff:=lab_private.apply_changes_v1(iid,jsonb_build_array(jsonb_build_object('type','evidence','claim_id',cid,'source_id',sid,'relation',rel,'material',false,'material_reason','Comparison source assessed in this same explicit human review.')));
  update public.lab_claim_workflow set review_needed=false where claim_id=cid;
  -- Contradictory comparison evidence has already been adjudicated atomically;
  -- no outstanding research task is manufactured from the same transaction.
  for x in select id,data from public.gap_task where claim_id=cid loop
   update public.gap_task set data=data||jsonb_build_object('status','resolved','task_disposition','resolved','resolution','Assessed in the facility comparison human review.','resolved_date',current_date),revision=revision+1 where id=x.id;
   perform lab_private.audit(iid,'GAP_TASK',x.id,'resolve','Comparison evidence reviewed in the same transaction',x.data,(select data from public.gap_task where id=x.id));
  end loop;
  artifact:=jsonb_build_object('claim_id',cid,'proposal',p,'source_id',sid,'relation',rel,'reviewer',actor,'reviewed_at',clock_timestamp());
  newdoc:=newdoc||jsonb_build_object('current_value_authority',jsonb_build_object('authority_artifact',aid,'authority_path','ACTIVITY_LOG/'||aid||'/authority_artifact/payload/operation/review_artifact','authority_scope',newdoc->>'subject','authority_type','V3_HUMAN_CLAIM_VALIDATION','authority_date',current_date,'authority_sha256',encode(sha256(convert_to(artifact::text,'UTF8')),'hex'),'recording_basis','CONTEMPORANEOUSLY_RECORDED'));
  update public.claim set data=newdoc where id=cid;
  perform lab_private.audit(iid,'CLAIM',cid,'validate','Explicit physical-facility comparison; names alone never merge records',null,newdoc,jsonb_build_object('review_artifact',artifact),aid);
  insert into public.lab_facility_resolution(id,facility_id,target_facility_id,outcome,identity_claim_id,source_id,reviewer,reviewed_at,basis,review_note,activity_id,incident_ids) values(rid,fid,target,outcomev,cid,sid,actor,clock_timestamp(),p->>'basis',p->>'review_note',aid,affected);
  if outcomev='same' then
   -- Preserve the source record and its aliases; carry alias provenance forward.
   for aliasv in select value from jsonb_array_elements(coalesce(old->'aliases','[]'::jsonb)) loop
    update public.facility set data=jsonb_set(data,'{aliases}',coalesce(data->'aliases','[]'::jsonb)||jsonb_build_array(aliasv||jsonb_build_object('origin_facility_id',fid,'identity_resolution_id',rid,'identity_claim_id',cid))) where id=target;
   end loop;
   update public.facility set revision=revision+1 where id=target;
   perform lab_private.audit(iid,'FACILITY',target,'revise','Preserved source-described aliases from explicitly resolved record',oldtarget,(select data from public.facility where id=target),jsonb_build_object('resolution_id',rid));
   for x in select id,data,incident_id from public.incident_facility where facility_id=fid and coalesce((data->>'is_current')::boolean,true) loop
    update public.incident_facility set data=data||jsonb_build_object('is_current',false,'superseded_by_facility_resolution',rid),revision=revision+1 where id=x.id;
    perform lab_private.audit(x.incident_id,'INCIDENT_FACILITY',x.id,'revise','Previous physical-facility association preserved as historical',x.data,(select data from public.incident_facility where id=x.id),jsonb_build_object('resolution_id',rid));
    if not lab_private.current_link(x.incident_id,target) then
     n:=lab_private.new_id('IF');item:=x.data||jsonb_build_object('incident_facility_id',n,'facility_id',target,'is_current',true,'identity_basis_claim_ids',jsonb_build_array(cid),'facility_resolution_id',rid,'supersedes_incident_facility_id',x.id);
     -- This settles physical association, not attack relationship or causation.
     insert into public.incident_facility(id,data) values(n,item);perform lab_private.audit(x.incident_id,'INCIDENT_FACILITY',n,'create','Physical facility association resolved by explicit human evidence',null,item);
    end if;
   end loop;
  elsif outcomev='different' then
   update public.facility set data=data||jsonb_build_object('identity_status',case when exists(select 1 from public.claim c where c.facility_id=fid and c.data->>'claim_family'='IDENTITY' and coalesce(c.data->>'identity_purpose','')<>'facility_comparison' and c.data->>'value_type' in ('BOOLEAN','TEXT_WHERE_REQUIRED') and lab_private.eligible(c.id)) then 'IDENTIFIED' else 'PARTIALLY_IDENTIFIED' end) where id=fid;
  else update public.facility set data=data||jsonb_build_object('identity_status','POSSIBLE_DUPLICATE_OR_RELATED_RECORD') where id=fid;
  end if;
  update public.facility set revision=revision+1 where id=fid;
  perform lab_private.audit(iid,'FACILITY',fid,'resolve','Physical-facility comparison: '||outcomev,old,(select data from public.facility where id=fid),jsonb_build_object('resolution_id',rid,'target_facility_id',target,'identity_claim_id',cid));
  foreach n in array affected loop
   update public.incident set revision=revision+1 where id=n;
   update public.lab_incident_workflow set revision=revision+1,status=case when status in ('review_complete','supervisor_override') then 'reopened' else status end,requirements_assessed=case when outcomev='same' then false else requirements_assessed end where incident_id=n;
   perform lab_private.audit(n,'INCIDENT',n,'revise','Facility comparison changed current association or identity review',null,(select to_jsonb(w) from public.lab_incident_workflow w where incident_id=n),jsonb_build_object('resolution_id',rid));
  end loop;
  created:=jsonb_build_array(jsonb_build_object('type','CLAIM','id',cid),jsonb_build_object('type','SOURCE','id',sid))||(eff->'created_ids');
 end if;
 resultv:=jsonb_build_object('operation_id',op,'incident_id',iid,'revision',(select revision from public.incident where id=iid),'status',(select status from public.lab_incident_workflow where incident_id=iid),'facility_revision',(select revision from public.facility where id=fid),'created_ids',created);
 update public.lab_idempotency set result=resultv where operation_id=op;return resultv;
end $$;

alter function public.lab_snapshot() set schema lab_private;
alter function lab_private.lab_snapshot() rename to snapshot_v1;
create function public.lab_snapshot() returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$ declare resultv jsonb; fs jsonb; rs jsonb; wi jsonb; begin
 perform lab_private.require_actor(false);resultv:=lab_private.snapshot_v1();
 select coalesce(jsonb_object_agg(id,lab_private.facility_readiness(id)),'{}'::jsonb) into fs from public.facility;
 select coalesce(jsonb_agg(to_jsonb(r) order by reviewed_at,id),'[]'::jsonb) into rs from public.lab_facility_resolution r;
 select coalesce(jsonb_object_agg(key,value||jsonb_build_object('facility_ready',lab_private.incident_facility_ready(key))),'{}'::jsonb) into wi from jsonb_each(resultv->'workflow'->'incidents');
 return jsonb_set(resultv,'{workflow}',resultv->'workflow'||jsonb_build_object('incidents',wi,'facilities',fs,'facility_resolutions',rs));
end $$;

revoke all on all functions in schema lab_private from public,anon,authenticated;
grant execute on function lab_private.active_user() to authenticated;
revoke all on function public.lab_snapshot(),public.lab_commit(jsonb) from public,anon,authenticated;
grant execute on function public.lab_snapshot(),public.lab_commit(jsonb) to authenticated;
commit;


-- Persistent Lab Pilot V2.3: Day-One current-lab state and coordination.
-- Apply once, after unchanged 001/002/003. This migration never changes Core seed data.
begin;
alter table public.lab_claim_workflow
 add column lab_review_state text not null default 'NOT_REVIEWED' check(lab_review_state in ('NOT_REVIEWED','REVIEWED','REOPENED')),
 add column lab_reviewed_by uuid references public.lab_profiles(user_id),
 add column lab_reviewed_at timestamptz,
 add column lab_reviewed_claim_revision bigint;
alter table public.lab_incident_workflow drop constraint lab_incident_workflow_status_check;
alter table public.lab_incident_workflow add constraint lab_incident_workflow_status_check check(status in ('needs_lab_validation','preserved_unassessed','in_progress','research_lead','review_complete','supervisor_override','reopened'));
alter table public.lab_incident_workflow alter column status set default 'needs_lab_validation';
alter table public.lab_facility_workflow
 add column lab_location_review_state text not null default 'NOT_REVIEWED' check(lab_location_review_state in ('NOT_REVIEWED','REVIEWED','REOPENED')),
 add column lab_location_reviewed_by uuid references public.lab_profiles(user_id),
 add column lab_location_reviewed_at timestamptz,
 add column lab_location_reviewed_facility_revision bigint;
create table public.lab_task_workflow(
 gap_task_id text primary key references public.gap_task(id),
 lab_task_state text not null default 'NOT_ASSESSED' check(lab_task_state in ('NOT_ASSESSED','ACTIVE','BLOCKED','DEFERRED','UNABLE_TO_RESOLVE','RESOLVED')),
 lab_task_by uuid references public.lab_profiles(user_id),lab_task_at timestamptz,
 reason text,task jsonb,revision bigint not null default 1 check(revision>0)
);
create table public.lab_case_assignment(
 incident_id text primary key references public.incident(id),assigned_to uuid references public.lab_profiles(user_id),
 assigned_by uuid not null references public.lab_profiles(user_id),assigned_at timestamptz not null,
 assignment_note text not null,revision bigint not null default 1 check(revision>0)
);
alter table public.lab_task_workflow enable row level security;
alter table public.lab_case_assignment enable row level security;
revoke all on public.lab_task_workflow,public.lab_case_assignment from public,anon,authenticated;
grant select on public.lab_task_workflow,public.lab_case_assignment to authenticated;
create policy lab_read on public.lab_task_workflow for select to authenticated using(lab_private.active_user());
create policy lab_read on public.lab_case_assignment for select to authenticated using(lab_private.active_user());

-- Immutable receipt preserves pre-reset operational history. No research event or
-- current reviewer is fabricated. Reinvoking the private initializer is a no-op.
create function lab_private.initialize_day_one() returns boolean language plpgsql set search_path=pg_catalog,public
as $$ begin
 perform pg_advisory_xact_lock(749310091::bigint);
 if exists(select 1 from public.lab_seed_metadata where id='day_one_v23') then return false; end if;
 insert into public.lab_seed_metadata(id,data) values('day_one_v23',jsonb_build_object(
  'purpose','Current lab starts unreviewed; preserved research and historical adjudication remain unchanged',
  'initialized_at',clock_timestamp(),'historical_claim_workflow',(select coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb) from public.lab_claim_workflow w),
  'historical_incident_workflow',(select coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb) from public.lab_incident_workflow w),
  'historical_facility_workflow',(select coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb) from public.lab_facility_workflow w)));
 update public.lab_claim_workflow set lab_review_state='NOT_REVIEWED',lab_reviewed_by=null,lab_reviewed_at=null,lab_reviewed_claim_revision=null,review_needed=false,proposal=null
  where claim_id in (select jsonb_array_elements_text(data->'record_ids'->'CLAIM') from public.lab_seed_metadata where id='approved_manifest');
 update public.lab_incident_workflow set status='needs_lab_validation',required_claim_ids='{}',optional_claim_ids='{}',dispositions='{}',requirements_assessed=false,completion=null,entered_by=null
  where incident_id in (select jsonb_array_elements_text(data->'record_ids'->'INCIDENT') from public.lab_seed_metadata where id='approved_manifest');
 insert into public.lab_task_workflow(gap_task_id) select id from public.gap_task on conflict do nothing;
 insert into public.lab_facility_workflow(facility_id,location_required,reason)
  select id,false,'Preserved location requirement has not yet been assessed by the current lab.' from public.facility on conflict do nothing;
 update public.lab_facility_workflow set lab_location_review_state='NOT_REVIEWED',lab_location_reviewed_by=null,lab_location_reviewed_at=null,lab_location_reviewed_facility_revision=null
  where facility_id in (select jsonb_array_elements_text(data->'record_ids'->'FACILITY') from public.lab_seed_metadata where id='approved_manifest');
 return true;
end $$;
select lab_private.initialize_day_one();

create function lab_private.lab_reviewed(cid text) returns boolean language sql stable set search_path=pg_catalog,public
as $$ select exists(select 1 from public.claim c join public.lab_claim_workflow w on w.claim_id=c.id where c.id=cid and coalesce((c.data->>'is_current')::boolean,true) and w.lab_review_state='REVIEWED' and not w.review_needed and w.lab_reviewed_claim_revision=c.revision and w.lab_reviewed_by is not null and w.lab_reviewed_at is not null) $$;
create function lab_private.lab_eligible(cid text) returns boolean language sql stable set search_path=pg_catalog,public
as $$ select lab_private.eligible(cid) and lab_private.lab_reviewed(cid) $$;

-- Only server-produced factual reviews can set lab validation. Historical seed
-- imports ran before these triggers and are never promoted to current-lab review.
create function lab_private.capture_lab_claim_review() returns trigger language plpgsql set search_path=pg_catalog,public
as $$ declare oldw jsonb; is_review boolean; begin
 is_review:=new.data->>'validation_origin'='V3_HUMAN_CLAIM_VALIDATION' and new.data->>'individual_human_factual_adjudication'='YES' and new.data->>'reviewer'=auth.uid()::text and new.data->>'reviewed_at' is not null;
 if TG_OP='UPDATE' then is_review:=is_review and new.data->>'reviewed_at' is distinct from old.data->>'reviewed_at'; end if;
 select to_jsonb(w) into oldw from public.lab_claim_workflow w where claim_id=new.id;
 if is_review then
  insert into public.lab_claim_workflow(claim_id,lab_review_state,lab_reviewed_by,lab_reviewed_at,lab_reviewed_claim_revision,review_needed)
   values(new.id,'REVIEWED',auth.uid(),(new.data->>'reviewed_at')::timestamptz,new.revision,false)
   on conflict(claim_id) do update set lab_review_state='REVIEWED',lab_reviewed_by=excluded.lab_reviewed_by,lab_reviewed_at=excluded.lab_reviewed_at,lab_reviewed_claim_revision=excluded.lab_reviewed_claim_revision,review_needed=false;
  perform lab_private.audit(new.incident_id,'CLAIM',new.id,'validate','Current lab factual review recorded',oldw,(select to_jsonb(w) from public.lab_claim_workflow w where claim_id=new.id),jsonb_build_object('workflow_only',true));
 elsif TG_OP='INSERT' then
  -- The normal new-fact engine creates its workflow row with the private proposal.
  null;
 elsif new.revision is distinct from old.revision and oldw->>'lab_review_state' in ('REVIEWED','REOPENED') then
  update public.lab_claim_workflow set lab_review_state='REOPENED',review_needed=true,revision=revision+1 where claim_id=new.id;
 end if;
 return new;
end $$;
create trigger claim_current_lab_review after update on public.claim for each row execute function lab_private.capture_lab_claim_review();
create function lab_private.propagate_lab_reopening() returns trigger language plpgsql set search_path=pg_catalog,public
as $$ begin
 if new.review_needed and old.lab_review_state in ('REVIEWED','REOPENED') then new.lab_review_state:='REOPENED'; end if;
 return new;
end $$;
create trigger lab_review_reopening before update on public.lab_claim_workflow for each row execute function lab_private.propagate_lab_reopening();
create function lab_private.record_lab_reopening() returns trigger language plpgsql set search_path=pg_catalog,public
as $$ begin
 if new.lab_review_state='REOPENED' and old.lab_review_state is distinct from new.lab_review_state then
  perform lab_private.audit((select incident_id from public.claim where id=new.claim_id),'CLAIM',new.claim_id,'reopen','New evidence requires current lab review',to_jsonb(old),to_jsonb(new),jsonb_build_object('workflow_only',true));
 end if;return new;
end $$;
create trigger lab_review_reopening_history after update on public.lab_claim_workflow for each row execute function lab_private.record_lab_reopening();
create function lab_private.new_task_workflow() returns trigger language plpgsql set search_path=pg_catalog,public
as $$ begin insert into public.lab_task_workflow(gap_task_id) values(new.id) on conflict do nothing;return new;end $$;
create trigger new_task_current_lab after insert on public.gap_task for each row execute function lab_private.new_task_workflow();

-- Existing task dispositions are preserved in Core GAP_TASK; subsequent lab
-- decisions and task instructions are recorded exclusively in NON-Core workflow.
alter function lab_private.apply_changes(text,jsonb) rename to apply_changes_v2;
create function lab_private.apply_changes(iid text,changes jsonb) returns jsonb language plpgsql set search_path=pg_catalog,public
as $$ declare ch jsonb; t jsonb; gid text; cid text; st text; disp text; why text; oldw jsonb; oldg jsonb; e jsonb;
 created jsonb:='[]'; touches jsonb:='[]'; material boolean:=false; begin
 if jsonb_typeof(changes) is distinct from 'array' or jsonb_array_length(changes)>150 then raise exception 'Submit a bounded list of at most 150 changes.';end if;
 for ch in select value from jsonb_array_elements(changes) loop
  if ch->>'type'='task' then
   t:=ch->'task';gid:=coalesce(nullif(t->>'gap_task_id',''),lab_private.new_id('G'));cid:=nullif(t->>'claim_id','');
   select data into oldg from public.gap_task where id=gid;
   if oldg is not null and oldg->>'incident_id' is distinct from iid then raise exception 'Task belongs to another incident.';end if;
   if cid is null then cid:=oldg->>'claim_id';end if;
   if oldg is not null and oldg->>'claim_id' is distinct from cid then raise exception 'An existing research question cannot be silently moved to another fact. Propose a distinct question.';end if;
   if cid is not null then perform lab_private.assert_claim_scope(cid,iid);end if;
   st:=t->>'lab_task_state';disp:=t->>'disposition';
   if st is null then st:=case when disp='unable_to_resolve' then 'UNABLE_TO_RESOLVE' when disp='deferred' or t->>'status'='deferred' then 'DEFERRED' when disp='resolved' or t->>'status'='resolved' then 'RESOLVED' when t->>'status'='blocked' then 'BLOCKED' when disp in ('active','ready_for_review') or t->>'status' in ('open','in progress') then 'ACTIVE' else null end;end if;
   if st is null or st not in ('ACTIVE','BLOCKED','DEFERRED','UNABLE_TO_RESOLVE','RESOLVED') then raise exception 'Choose an explicit current lab task state; Not yet assessed is the initial state only.';end if;
   if not lab_private.nonblank(t->>'factual_question') or not lab_private.nonblank(t->>'reason') or not lab_private.nonblank(t->>'next_action') then raise exception 'Explain what is unclear, why it matters, and what to check.';end if;
   why:=coalesce(nullif(t->>'lab_task_reason',''),nullif(t->>'resolution',''),case when not (t ? 'lab_task_state') then t->>'reason' else null end);
   if st<>'NOT_ASSESSED' and not lab_private.nonblank(why) then raise exception 'Record the current lab reason for this task decision.';end if;
   if st in ('DEFERRED','UNABLE_TO_RESOLVE','RESOLVED') and not lab_private.nonblank(coalesce(t->>'lab_task_reason',t->>'resolution')) then raise exception 'Record the reason for this current lab task disposition.';end if;
   select to_jsonb(w) into oldw from public.lab_task_workflow w where gap_task_id=gid;
   if t ? 'expected_task_revision' and (t->>'expected_task_revision')::bigint<>coalesce((oldw->>'revision')::bigint,0) then raise exception using errcode='40001',message='This task changed. Reload the latest version.';end if;
   if oldg is null then
    insert into public.gap_task(id,data) values(gid,jsonb_build_object('gap_task_id',gid,'incident_id',iid,'claim_id',cid,'factual_question',t->>'factual_question','reason',t->>'reason','next_action',t->>'next_action','status','open','task_disposition',null,'opened_date',current_date,'resolution',null));
    perform lab_private.audit(iid,'GAP_TASK',gid,'create','New research question recorded',null,(select data from public.gap_task where id=gid));
    created:=created||jsonb_build_array(jsonb_build_object('type','GAP_TASK','id',gid));
   end if;
   insert into public.lab_task_workflow(gap_task_id,lab_task_state,lab_task_by,lab_task_at,reason,task) values(gid,st,auth.uid(),clock_timestamp(),why,t)
    on conflict(gap_task_id) do update set lab_task_state=excluded.lab_task_state,lab_task_by=excluded.lab_task_by,lab_task_at=excluded.lab_task_at,reason=excluded.reason,task=excluded.task,revision=public.lab_task_workflow.revision+1;
   perform lab_private.audit(iid,'GAP_TASK',gid,case st when 'DEFERRED' then 'defer' when 'RESOLVED' then 'resolve' else 'revise' end,'Current lab task '||lower(st),oldw,(select to_jsonb(w) from public.lab_task_workflow w where gap_task_id=gid),jsonb_build_object('workflow_only',true));material:=true;
  else
   if ch->>'type'='review' and ch->>'validation_state'='SUPPORTED' and ch->'value'='true'::jsonb and exists(select 1 from public.claim where id=ch->>'claim_id' and data->>'claim_family'='ATTACK_TO_EFFECT_CAUSATION') then
    if not lab_private.lab_eligible(ch->>'attack_claim_id') or not lab_private.lab_eligible(ch->>'effect_claim_id') then raise exception 'Supported causation requires current lab review of its specific attack and operational effect.';end if;
   end if;
   e:=lab_private.apply_changes_v2(iid,jsonb_build_array(ch));created:=created||coalesce(e->'created_ids','[]'::jsonb);touches:=touches||coalesce(e->'facility_touches','[]'::jsonb);material:=material or coalesce((e->>'material')::boolean,false);
   if ch->>'type'='evidence' and coalesce((e->>'material')::boolean,false) and not exists(select 1 from public.gap_task g left join public.lab_task_workflow w on w.gap_task_id=g.id where g.claim_id=ch->>'claim_id' and coalesce(g.data->>'status','')<>'resolved' and coalesce(w.lab_task_state,'NOT_ASSESSED')<>'RESOLVED') then
    -- A previously current-lab-resolved question must not conceal new material
    -- evidence. Keep that resolution and open only the newly required question.
    gid:=lab_private.new_id('G');
    insert into public.gap_task(id,data) values(gid,jsonb_build_object('gap_task_id',gid,'incident_id',iid,'claim_id',ch->>'claim_id','factual_question','Does the new evidence change this factual finding?','reason','New evidence may contradict or materially limit the prior review.','next_action','Check the preserved evidence before making another factual decision.','status','blocked','task_disposition','active','opened_date',current_date,'resolution',null));
    perform lab_private.audit(iid,'GAP_TASK',gid,'create','New material evidence requires a current lab task assessment',null,(select data from public.gap_task where id=gid));
    created:=created||jsonb_build_array(jsonb_build_object('type','GAP_TASK','id',gid));
   end if;
  end if;
 end loop;
 return jsonb_build_object('created_ids',created,'material',material,'facility_touches',touches);
end $$;

create or replace function lab_private.facility_identity_ready(fid text) returns boolean language sql stable set search_path=pg_catalog,public
as $$ select exists(select 1 from public.facility f where f.id=fid and f.data->>'identity_status'='IDENTIFIED')
 and exists(select 1 from public.claim c where c.facility_id=fid and c.data->>'claim_family'='IDENTITY' and coalesce(c.data->>'identity_purpose','')<>'facility_comparison' and c.data->>'value_type' in ('BOOLEAN','TEXT_WHERE_REQUIRED') and lab_private.lab_eligible(c.id))
 and not exists(select 1 from public.claim c left join public.lab_claim_workflow w on w.claim_id=c.id where c.facility_id=fid and c.data->>'claim_family'='IDENTITY' and coalesce(c.data->>'identity_purpose','')<>'facility_comparison' and c.data->>'value_type' in ('BOOLEAN','TEXT_WHERE_REQUIRED') and coalesce((c.data->>'is_current')::boolean,true) and (c.data->>'validation_state'='CONFLICTING' or coalesce(w.review_needed,false)))
 and not exists(select 1 from public.lab_facility_resolution r where r.facility_id=fid and r.outcome='same') $$;
create or replace function lab_private.facility_readiness(fid text) returns jsonb language plpgsql stable set search_path=pg_catalog,public
as $$ declare f jsonb; typ jsonb; ls text; lr boolean; tr boolean; ir boolean; res jsonb; fw public.lab_facility_workflow%rowtype; location_current boolean; begin
 select data into f from public.facility where id=fid;
 select coalesce(location_required,false) into lr from public.lab_facility_workflow where facility_id=fid; lr:=coalesce(lr,false);
 ls:=coalesce(f->'location_review'->>'state','NOT_REVIEWED');
 select * into fw from public.lab_facility_workflow where facility_id=fid;
 location_current:=coalesce(fw.lab_location_review_state='REVIEWED',false);
 select case when count(distinct data->'current_verified_value')=1 then min((data->'current_verified_value')::text)::jsonb else null end into typ from public.claim where facility_id=fid and data->>'claim_family'='FACILITY_TYPE' and lab_private.lab_eligible(id);
 tr:=typ is not null and typ<>'null'::jsonb and not exists(select 1 from public.claim c left join public.lab_claim_workflow w on w.claim_id=c.id where c.facility_id=fid and c.data->>'claim_family'='FACILITY_TYPE' and coalesce((c.data->>'is_current')::boolean,true) and (c.data->>'validation_state'='CONFLICTING' or coalesce(w.review_needed,false)));
 ir:=lab_private.facility_identity_ready(fid);
 select to_jsonb(r) into res from public.lab_facility_resolution r where facility_id=fid order by reviewed_at desc,id desc limit 1;
 return jsonb_build_object('facility_id',fid,'revision',(select revision from public.facility where id=fid),'identity_ready',ir,'facility_type',case when tr then typ else null end,'type_ready',tr,'location_state',case when location_current then ls else 'NOT_REVIEWED' end,'historical_location_state',ls,'location_required',lr,'location_ready',ls='SUPPORTED' and location_current,'lab_location_review_state',coalesce(fw.lab_location_review_state,'NOT_REVIEWED'),'lab_location_reviewed_by',fw.lab_location_reviewed_by,'lab_location_reviewed_at',fw.lab_location_reviewed_at,'lab_location_reviewed_facility_revision',fw.lab_location_reviewed_facility_revision,'downstream_ready',ir and tr and (not lr or (ls='SUPPORTED' and location_current)),'resolution',res);
end $$;
create or replace function lab_private.completion_issues(iid text) returns jsonb language plpgsql stable set search_path=pg_catalog,public
as $$ declare w public.lab_incident_workflow%rowtype; c record; g record; disp jsonb; issues jsonb:='[]'; begin
 select * into w from public.lab_incident_workflow where incident_id=iid;
 if not lab_private.identity_ready(iid) then issues:=issues||jsonb_build_array(jsonb_build_object('kind','identity','message','Physical facility identity must be resolved.')); end if;
 if not coalesce(w.requirements_assessed,false) then issues:=issues||jsonb_build_array(jsonb_build_object('kind','requirements','message','A supervisor must assess which facts are required and which are optional.')); end if;
 for c in select c1.*,coalesce(cw.review_needed,false) as needs_review from public.claim c1 left join public.lab_claim_workflow cw on cw.claim_id=c1.id where coalesce((c1.data->>'is_current')::boolean,true) and lab_private.fact_in_scope(c1.id,iid) loop
  if c.id=any(w.optional_claim_ids) and not c.id=any(w.required_claim_ids) then continue; end if;
  disp:=w.dispositions->c.id;
  if disp->>'disposition' in ('deferred','unable_to_resolve','not_required') and lab_private.nonblank(disp->>'reason') then continue; end if;
  if not lab_private.lab_reviewed(c.id) or c.needs_review or c.data->>'validation_state' in ('NOT_REVIEWED','CONFLICTING') then issues:=issues||jsonb_build_array(jsonb_build_object('kind','fact','claim_id',c.id,'subject',c.data->>'subject','state',c.data->>'validation_state','message','Required factual work needs a current lab review or explicit disposition.')); end if;
 end loop;
 for g in select g1.*,coalesce(tw.lab_task_state,'NOT_ASSESSED') as lab_task_state from public.gap_task g1 left join public.lab_task_workflow tw on tw.gap_task_id=g1.id where g1.incident_id=iid and (g1.claim_id is null or lab_private.fact_in_scope(g1.claim_id,iid)) and (g1.claim_id is null or not g1.claim_id=any(w.optional_claim_ids) or g1.claim_id=any(w.required_claim_ids)) loop
  if g.lab_task_state in ('ACTIVE','BLOCKED') or (g.lab_task_state='NOT_ASSESSED' and coalesce(g.data->>'status','')<>'resolved' and coalesce(g.data->>'task_disposition','')<>'resolved') then
   issues:=issues||jsonb_build_array(jsonb_build_object('kind','task','gap_task_id',g.id,'lab_task_state',g.lab_task_state,'message',case when g.lab_task_state='NOT_ASSESSED' then 'The current lab has not assessed this research task: ' else '' end||coalesce(g.data->>'factual_question','Research question')));
  end if;
 end loop;
 for c in select distinct x.facility_id from public.incident_facility x join public.lab_facility_workflow fw on fw.facility_id=x.facility_id where x.incident_id=iid and coalesce((x.data->>'is_current')::boolean,true) and fw.location_required loop
  if not coalesce((lab_private.facility_readiness(c.facility_id)->>'location_ready')::boolean,false) then issues:=issues||jsonb_build_array(jsonb_build_object('kind','location','facility_id',c.facility_id,'message','Material facility location needs supported human review or an explicit supervisor requirement disposition.')); end if;
 end loop;
 return issues;
end $$;
create or replace function lab_private.causal_pair_eligible(cid text) returns boolean language sql stable set search_path=pg_catalog,public
as $$ select exists(select 1 from public.claim c join public.claim a on a.id=c.attack_claim_id join public.claim e on e.id=c.effect_claim_id where c.id=cid and c.data->>'claim_family'='ATTACK_TO_EFFECT_CAUSATION' and c.data->'current_verified_value'='true'::jsonb and a.incident_id=c.incident_id and e.incident_id=c.incident_id and a.data->>'claim_family'='KINETIC_EVENT' and a.data->'current_verified_value'='true'::jsonb and lab_private.effect_family(e.data->>'claim_family') and lab_private.lab_eligible(c.id) and lab_private.lab_eligible(a.id) and lab_private.lab_eligible(e.id)) $$;
create or replace function lab_private.project_incident(iid text) returns void language plpgsql set search_path=pg_catalog,public
as $$ declare w public.lab_incident_workflow%rowtype; itype text:='unresolved cluster'; d jsonb; p text; ev jsonb; begin
 select * into w from public.lab_incident_workflow where incident_id=iid;
 -- Never silently retype preserved research as a side effect of adding evidence.
 if w.entered_by is null then return; end if;
 if w.working_type='Attack-and-effect episode' then
  if exists(select 1 from public.claim where incident_id=iid and lab_private.causal_pair_eligible(id)) then itype:='combined supported causal episode'; end if;
 elsif w.working_type in ('Strike event','Research lead') then
  if exists(select 1 from public.claim where incident_id=iid and data->>'claim_family'='KINETIC_EVENT' and data->'current_verified_value'='true'::jsonb and lab_private.lab_eligible(id)) then itype:='kinetic episode'; end if;
 elsif w.working_type in ('Operational-status episode','Service / follow-up observation') then
  if exists(select 1 from public.claim where incident_id=iid and lab_private.effect_family(data->>'claim_family') and lab_private.lab_eligible(id)) then itype:='operational episode'; end if;
 end if;
 select data into d from public.incident where id=iid;
 d:=d||jsonb_build_object('incident_type',itype);
 -- Only unambiguous eligible dates project into event chronology. Never use publication/restoration.
 if (select count(*) from public.claim where incident_id=iid and data->>'claim_family'='EVENT_DATE' and lab_private.lab_eligible(id))=1 then
  select data->'current_verified_value',data->>'date_precision' into ev,p from public.claim where incident_id=iid and data->>'claim_family'='EVENT_DATE' and lab_private.lab_eligible(id);
  d:=d||jsonb_build_object('event_start',case when p='RANGE' then ev->'start' else ev end,'event_end',case when p='RANGE' then ev->'end' else null end,'date_precision',p);
 else d:=d||jsonb_build_object('event_start',null,'event_end',null,'date_precision','UNKNOWN'); end if;
 update public.incident set data=d where id=iid;
end $$;

-- Preserve the existing atomic engine and role design. Assignment is NON-Core
-- coordination and never changes a factual value, research task or review state.
alter function public.lab_commit(jsonb) set schema lab_private;
alter function lab_private.lab_commit(jsonb) rename to commit_v2;
create function public.lab_commit(p_request jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$ declare actor uuid:=lab_private.require_actor(false); kindv text:=p_request->>'kind'; p jsonb:=p_request->'payload'; iid text:=p_request->>'incident_id'; fid text;
 op uuid; digestv text; prior public.lab_idempotency%rowtype; rev bigint; arev bigint; assignee uuid; olda jsonb; oldw jsonb; resultv jsonb; replay boolean; x record; begin
 if jsonb_typeof(p_request) is distinct from 'object' or length(p_request::text)>2000000 then raise exception 'Submission is missing or exceeds the pilot limit.';end if;
 perform pg_advisory_xact_lock(749310091::bigint);
 if kindv is distinct from 'assign_case' then
  op:=(p_request->>'operation_id')::uuid;replay:=exists(select 1 from public.lab_idempotency where operation_id=op);
  fid:=p->>'facility_id';select to_jsonb(w) into oldw from public.lab_facility_workflow w where facility_id=fid;
  resultv:=lab_private.commit_v2(p_request);
  if replay then return resultv;end if;
  if kindv='update_requirements' and (select status from public.lab_incident_workflow where incident_id=iid)='needs_lab_validation' then
   update public.lab_incident_workflow set status='in_progress' where incident_id=iid;
   resultv:=jsonb_set(resultv,'{status}','"in_progress"'::jsonb);update public.lab_idempotency set result=resultv where operation_id=op;
  end if;
  if kindv='review_location' then
   insert into public.lab_facility_workflow(facility_id,location_required,reason,lab_location_review_state,lab_location_reviewed_by,lab_location_reviewed_at,lab_location_reviewed_facility_revision)
    values(fid,false,'Current lab location review recorded.','REVIEWED',actor,clock_timestamp(),(select revision from public.facility where id=fid))
    on conflict(facility_id) do update set lab_location_review_state='REVIEWED',lab_location_reviewed_by=excluded.lab_location_reviewed_by,lab_location_reviewed_at=excluded.lab_location_reviewed_at,lab_location_reviewed_facility_revision=excluded.lab_location_reviewed_facility_revision;
   perform lab_private.audit(iid,'FACILITY',fid,'validate','Current lab location review recorded',oldw,(select to_jsonb(w) from public.lab_facility_workflow w where facility_id=fid),jsonb_build_object('workflow_only',true));
  elsif kindv='facility_evidence' and p->'scopes' ? 'location' then
   update public.lab_facility_workflow set lab_location_review_state=case when lab_location_review_state in ('REVIEWED','REOPENED') then 'REOPENED' else 'NOT_REVIEWED' end where facility_id=fid;
   perform lab_private.audit(iid,'FACILITY',fid,'revise','Location evidence awaits current lab review',oldw,(select to_jsonb(w) from public.lab_facility_workflow w where facility_id=fid),jsonb_build_object('workflow_only',true));
  elsif kindv='resolve_facility' then
   -- The existing comparison engine creates and adjudicates a new proposition
   -- atomically; mark that specific decision as current-lab reviewed afterwards.
   for x in select c.* from public.claim c where c.data->>'identity_purpose'='facility_comparison' and c.id in (select v->>'id' from jsonb_array_elements(resultv->'created_ids') v where v->>'type'='CLAIM') loop
    select to_jsonb(w) into oldw from public.lab_claim_workflow w where claim_id=x.id;
    update public.lab_claim_workflow set lab_review_state='REVIEWED',review_needed=false,lab_reviewed_by=actor,lab_reviewed_at=(x.data->>'reviewed_at')::timestamptz,lab_reviewed_claim_revision=x.revision where claim_id=x.id;
    perform lab_private.audit(iid,'CLAIM',x.id,'validate','Current lab facility comparison recorded',oldw,(select to_jsonb(w) from public.lab_claim_workflow w where claim_id=x.id),jsonb_build_object('workflow_only',true));
    update public.lab_task_workflow set lab_task_state='RESOLVED',lab_task_by=actor,lab_task_at=clock_timestamp(),reason='Comparison evidence assessed in the same current lab human review.',revision=revision+1 where gap_task_id in (select id from public.gap_task where claim_id=x.id and data->>'status'='resolved');
   end loop;
  end if;
  return resultv;
 end if;
 perform lab_private.require_actor(true);
 op:=(p_request->>'operation_id')::uuid;
 if op is null or not lab_private.nonblank(iid) or jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p_request->'expected_revision') is distinct from 'number' or jsonb_typeof(p->'expected_assignment_revision') is distinct from 'number' then raise exception 'Incident and assignment revisions are required.';end if;
 if (p_request->>'expected_revision')::numeric<>(p_request->>'expected_revision')::bigint or (p->>'expected_assignment_revision')::numeric<>(p->>'expected_assignment_revision')::bigint or (p->>'expected_assignment_revision')::bigint<0 then raise exception 'Use exact nonnegative integer revisions.';end if;
 if not p ? 'assigned_to' or jsonb_typeof(p->'assignment_note') is distinct from 'string' or not lab_private.nonblank(p->>'assignment_note') or length(p->>'assignment_note')>4000 then raise exception 'Choose an assignee or explicitly unassign, and record an assignment note.';end if;
 digestv:=encode(sha256(convert_to(p_request::text,'UTF8')),'hex');select * into prior from public.lab_idempotency where operation_id=op;
 if found then
  if prior.owner_id<>actor or prior.request_hash<>digestv then raise exception using errcode='23505',message='This submission ID has already been used for a different request.';end if;return prior.result;
 end if;
 assignee:=nullif(p->>'assigned_to','')::uuid;
 if assignee is not null and not exists(select 1 from public.lab_profiles where user_id=assignee and active) then raise exception 'Choose an active lab member.';end if;
 select revision into rev from public.incident where id=iid for update;
 if not found or rev<>(p_request->>'expected_revision')::bigint then raise exception using errcode='40001',message='This incident changed. Reload the latest version before assigning it.';end if;
 select revision,to_jsonb(a) into arev,olda from public.lab_case_assignment a where incident_id=iid for update;
 if coalesce(arev,0)<>(p->>'expected_assignment_revision')::bigint then raise exception using errcode='40001',message='This assignment changed. Reload the latest version.';end if;
 insert into public.lab_idempotency(operation_id,owner_id,request_hash) values(op,actor,digestv);
 insert into public.lab_case_assignment(incident_id,assigned_to,assigned_by,assigned_at,assignment_note) values(iid,assignee,actor,clock_timestamp(),p->>'assignment_note')
  on conflict(incident_id) do update set assigned_to=excluded.assigned_to,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at,assignment_note=excluded.assignment_note,revision=public.lab_case_assignment.revision+1;
 update public.incident set revision=revision+1 where id=iid;
 update public.lab_incident_workflow set revision=rev+1,completion=case when status in ('review_complete','supervisor_override') and (completion->>'completion_revision')::bigint=rev then completion||jsonb_build_object('completion_revision',rev+1,'carried_forward_at',clock_timestamp(),'carried_forward_reason','Assignment changed; factual review and completion decision unchanged') else completion end where incident_id=iid;
 perform lab_private.audit(iid,'INCIDENT',iid,'assign',case when assignee is null then 'Case unassigned' when olda->>'assigned_to' is null then 'Case assigned' else 'Case reassigned' end,olda,(select to_jsonb(a) from public.lab_case_assignment a where incident_id=iid),jsonb_build_object('workflow_only',true));
 resultv:=jsonb_build_object('operation_id',op,'incident_id',iid,'revision',rev+1,'assignment_revision',(select revision from public.lab_case_assignment where incident_id=iid),'status',(select status from public.lab_incident_workflow where incident_id=iid),'created_ids','[]'::jsonb);
 update public.lab_idempotency set result=resultv where operation_id=op;return resultv;
end $$;

alter function public.lab_snapshot() set schema lab_private;
alter function lab_private.lab_snapshot() rename to snapshot_v2;
create function public.lab_snapshot() returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$ declare resultv jsonb; tasks jsonb; assignments jsonb; team jsonb;wi jsonb; begin
 perform lab_private.require_actor(false);resultv:=lab_private.snapshot_v2();
 select coalesce(jsonb_object_agg(gap_task_id,to_jsonb(w)),'{}'::jsonb) into tasks from public.lab_task_workflow w;
 select coalesce(jsonb_object_agg(incident_id,to_jsonb(a)),'{}'::jsonb) into assignments from public.lab_case_assignment a;
 select coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'display_name',display_name,'role',role,'active',active) order by display_name,user_id),'[]'::jsonb) into team from public.lab_profiles where active;
 select coalesce(jsonb_object_agg(key,value||jsonb_build_object('downstream_ready',value->>'status' in ('review_complete','supervisor_override') and coalesce((value->'completion'->>'completion_revision')::bigint,0)=(resultv->'revisions'->'INCIDENT'->>key)::bigint and lab_private.incident_facility_ready(key) and (select case when data->>'incident_type' in ('kinetic episode','combined supported causal episode') then exists(select 1 from public.claim c where c.incident_id=key and c.data->>'claim_family'='KINETIC_EVENT' and c.data->'current_verified_value'='true'::jsonb and lab_private.lab_eligible(c.id)) else data->>'incident_type'='operational episode' end from public.incident where id=key))),'{}'::jsonb) into wi from jsonb_each(resultv->'workflow'->'incidents');
 return jsonb_set(resultv,'{workflow}',resultv->'workflow'||jsonb_build_object('tasks',tasks,'incidents',wi))||jsonb_build_object('assignments',assignments,'team',team);
end $$;
revoke all on all functions in schema lab_private from public,anon,authenticated;
grant execute on function lab_private.active_user() to authenticated;
revoke all on function public.lab_snapshot(),public.lab_commit(jsonb) from public,anon,authenticated;
grant execute on function public.lab_snapshot(),public.lab_commit(jsonb) to authenticated;
commit;


-- V2.4 additive workflow only. Apply after byte-identical 001--004.
-- No approved Core seed or classification is rewritten.
begin;
create table public.lab_phase2_approval(
 incident_id text primary key references public.incident(id),
 approved_by uuid references public.lab_profiles(user_id),approved_at timestamptz,
 approved_incident_revision bigint,approval_reason text not null,approval_mode text not null check(approval_mode in ('approve','defer_nonessential')),
 outstanding_tasks_at_approval jsonb not null default '[]',unresolved_facts_at_approval jsonb not null default '[]',
 revision bigint not null default 1 check(revision>0),status text not null check(status in ('APPROVED','NEEDS_REAPPROVAL','REVOKED')),
 changed_by uuid not null references public.lab_profiles(user_id),changed_at timestamptz not null,change_reason text not null
);
alter table public.lab_phase2_approval enable row level security;
revoke all on public.lab_phase2_approval from public,anon,authenticated;
grant select on public.lab_phase2_approval to authenticated;
create policy lab_read on public.lab_phase2_approval for select to authenticated using(lab_private.active_user());

-- Direct entry already uses the standard bounded new_fact + zero/many evidence
-- transaction. Only new runtime wording changes; all prior log rows are intact.
create or replace function lab_private.audit(iid text,etype text,eid text,action text,reason text,before_doc jsonb,after_doc jsonb,extra jsonb default '{}',aid text default null) returns text language plpgsql set search_path=pg_catalog,public
as $$ declare idv text:=coalesce(aid,lab_private.new_id('ACT')); artifact jsonb; fid text; begin
 if etype='CLAIM' and action='create' and reason='New unreviewed fact proposed' then
  reason:='Fact added';extra:=(extra-'proposed_fact'-'proposal_status')||jsonb_build_object('initial_entry',extra->'proposed_fact','initial_entry_state','NOT_REVIEWED','claim_family',after_doc->>'claim_family','proposition',after_doc->>'subject','fact_id',eid);
 end if;
 select facility_id into fid from public.incident_facility where incident_id=iid order by id limit 1;
 artifact:=jsonb_build_object('before',before_doc,'after',after_doc,'operation',extra);
 insert into public.activity_log(id,data) values(idv,jsonb_build_object('activity_id',idv,'incident_id',iid,'facility_id',fid,'entity_type',etype,'entity_id',eid,'action_type',action,'actor',auth.uid()::text,'timestamp',clock_timestamp(),'reason',reason,'before_ref',before_doc,'after_ref',after_doc,'authority_artifact',jsonb_build_object('payload',artifact,'sha256',encode(sha256(convert_to(artifact::text,'UTF8')),'hex')),'legacy_refs','[]'::jsonb));return idv;
end $$;

create function lab_private.phase2_hard_issues(iid text) returns jsonb language plpgsql stable set search_path=pg_catalog,public
as $$ declare issues jsonb:='[]';fid text;f text;want jsonb;begin
 if not exists(select 1 from public.incident where id=iid and data->>'incident_type' in ('kinetic episode','combined supported causal episode')) then issues:=issues||jsonb_build_array(jsonb_build_object('kind','record_type','message','Phase 2 requires an attack-containing incident; context records are not attacks.'));end if;
 foreach f in array array['KINETIC_EVENT','ATTACK_RELATIONSHIP'] loop
  want:=case f when 'KINETIC_EVENT' then 'true'::jsonb else '"EXACT_TARGET"'::jsonb end;
  if not exists(select 1 from public.claim c where c.incident_id=iid and c.data->>'claim_family'=f and c.data->'current_verified_value'=want and lab_private.lab_eligible(c.id)) or exists(select 1 from public.claim c left join public.lab_claim_workflow w on w.claim_id=c.id where c.incident_id=iid and c.data->>'claim_family'=f and coalesce((c.data->>'is_current')::boolean,true) and (not lab_private.lab_eligible(c.id) or c.data->'current_verified_value' is distinct from want)) then
   issues:=issues||jsonb_build_array(jsonb_build_object('kind',f,'message',case f when 'KINETIC_EVENT' then 'Attack occurrence requires current-lab reviewed Supported true.' else 'Exact-target relationship requires current-lab reviewed Supported EXACT_TARGET.' end));end if;
 end loop;
 if not exists(select 1 from public.incident_facility x where x.incident_id=iid and coalesce((x.data->>'is_current')::boolean,true)) then issues:=issues||jsonb_build_array(jsonb_build_object('kind','identity','message','A current physical facility association is required.'));end if;
 for fid in select distinct facility_id from public.incident_facility x where x.incident_id=iid and coalesce((x.data->>'is_current')::boolean,true) loop
  if not lab_private.facility_identity_ready(fid) then issues:=issues||jsonb_build_array(jsonb_build_object('kind','identity','facility_id',fid,'message','Physical facility identity needs current lab validation.'));end if;
  if not coalesce((lab_private.facility_readiness(fid)->>'type_ready')::boolean,false) then issues:=issues||jsonb_build_array(jsonb_build_object('kind','facility_type','facility_id',fid,'message','Facility type needs current lab validation.'));end if;
 end loop;
 -- Required work must have current lab review or a recorded explicit disposition.
 -- An old supervisor override alone is not proof of these Phase 2 safeguards.
 issues:=issues||coalesce((select jsonb_agg(v) from jsonb_array_elements(lab_private.completion_issues(iid)) v where v->>'kind' in ('fact','task','requirements','identity','location')),'[]'::jsonb);
 -- Hard-family research questions are never made nonessential by an optional flag.
 issues:=issues||coalesce((select jsonb_agg(jsonb_build_object('kind','task','gap_task_id',g.id,'message','An unresolved hard factual safeguard task requires an explicit lab disposition.')) from public.gap_task g join public.claim c on c.id=g.claim_id join public.lab_incident_workflow iw on iw.incident_id=g.incident_id left join public.lab_task_workflow tw on tw.gap_task_id=g.id where g.incident_id=iid and c.data->>'claim_family' in ('KINETIC_EVENT','ATTACK_RELATIONSHIP','IDENTITY','FACILITY_TYPE') and g.claim_id=any(iw.optional_claim_ids) and not g.claim_id=any(iw.required_claim_ids) and (coalesce(tw.lab_task_state,'NOT_ASSESSED') in ('ACTIVE','BLOCKED') or (coalesce(tw.lab_task_state,'NOT_ASSESSED')='NOT_ASSESSED' and coalesce(g.data->>'status','')<>'resolved' and coalesce(g.data->>'task_disposition','')<>'resolved'))),'[]'::jsonb);
 return issues;
end $$;
create function lab_private.phase2_completion_current(iid text) returns boolean language sql stable set search_path=pg_catalog,public
as $$ select exists(select 1 from public.lab_incident_workflow w join public.incident i on i.id=w.incident_id where i.id=iid and w.status in ('review_complete','supervisor_override') and coalesce((w.completion->>'completion_revision')::bigint,0)=i.revision) $$;
create function lab_private.phase2_approved(iid text) returns boolean language sql stable set search_path=pg_catalog,public
as $$ select exists(select 1 from public.lab_phase2_approval a join public.incident i on i.id=a.incident_id where i.id=iid and a.status='APPROVED' and a.approved_incident_revision=i.revision) and lab_private.phase2_completion_current(iid) and jsonb_array_length(lab_private.phase2_hard_issues(iid))=0 $$;

alter function public.lab_commit(jsonb) set schema lab_private;
alter function lab_private.lab_commit(jsonb) rename to commit_v23;
create function public.lab_commit(p_request jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$ declare actor uuid:=lab_private.require_actor(false);op uuid;kindv text:=p_request->>'kind';p jsonb:=p_request->'payload';iid text:=p_request->>'incident_id';digestv text;prior public.lab_idempotency%rowtype;
 resultv jsonb;rev bigint;oldapprovals jsonb;olda jsonb;oldw jsonb;oldtask jsonb;w public.lab_incident_workflow%rowtype;a public.lab_phase2_approval%rowtype;
 issues jsonb;unresolved jsonb;outstanding jsonb;modev text;reasonv text;nextrev bigint;taskrow record;x record;beforea jsonb;replay boolean;carry boolean;
 begin
 if jsonb_typeof(p_request) is distinct from 'object' or length(p_request::text)>2000000 then raise exception 'Submission is missing or exceeds the pilot limit.';end if;
 perform pg_advisory_xact_lock(749310091::bigint);
 if kindv not in ('approve_phase2','revoke_phase2') or kindv is null then
  op:=(p_request->>'operation_id')::uuid;replay:=exists(select 1 from public.lab_idempotency where operation_id=op);
  select coalesce(jsonb_object_agg(p2.incident_id,to_jsonb(p2)||jsonb_build_object('incident_revision',(select revision from public.incident where id=p2.incident_id),'completion_current',lab_private.phase2_completion_current(p2.incident_id),'hard_gates_current',jsonb_array_length(lab_private.phase2_hard_issues(p2.incident_id))=0)),'{}'::jsonb) into oldapprovals from public.lab_phase2_approval p2 where p2.status='APPROVED';
  resultv:=lab_private.commit_v23(p_request);if replay then return resultv;end if;
  -- Evaluate every affected approved incident, including shared facility changes.
  for x in select p2.*,i.revision as incident_revision from public.lab_phase2_approval p2 join public.incident i on i.id=p2.incident_id where p2.status='APPROVED' loop
   beforea:=oldapprovals->x.incident_id;
   if beforea is null then continue;end if;
   if x.approved_incident_revision=x.incident_revision and lab_private.phase2_completion_current(x.incident_id) and jsonb_array_length(lab_private.phase2_hard_issues(x.incident_id))=0 then continue;end if;
   carry:=coalesce((beforea->>'completion_current')::boolean,false) and coalesce((beforea->>'hard_gates_current')::boolean,false) and x.approved_incident_revision=(beforea->>'incident_revision')::bigint and lab_private.phase2_completion_current(x.incident_id) and jsonb_array_length(lab_private.phase2_hard_issues(x.incident_id))=0;
   -- Only known nonmaterial operations may carry, with the original completion
   -- already carried by the old transaction engine. No completion/approval leap.
   carry:=carry and kindv in ('submit_changes','assign_case') and (select completion->>'carried_forward_at' is not null from public.lab_incident_workflow where incident_id=x.incident_id);
   update public.lab_phase2_approval set status=case when carry then 'APPROVED' else 'NEEDS_REAPPROVAL' end,approved_incident_revision=case when carry then x.incident_revision else approved_incident_revision end,revision=revision+1,changed_by=actor,changed_at=clock_timestamp(),change_reason=case when carry then 'Approval carried forward after a nonmaterial change permitted by current completion and all hard gates.' else 'Material change or stale completion requires supervisor reapproval.' end where incident_id=x.incident_id;
   perform lab_private.audit(x.incident_id,'INCIDENT',x.incident_id,'revise',case when carry then 'Phase 2 approval carried forward after nonmaterial change' else 'Phase 2 approval invalidated after material change' end,beforea,(select to_jsonb(z) from public.lab_phase2_approval z where z.incident_id=x.incident_id),jsonb_build_object('workflow_only',true,'phase2',true,'originating_incident',iid,'incident_revision',x.incident_revision));
  end loop;
  return resultv;
 end if;
 perform lab_private.require_actor(true);op:=(p_request->>'operation_id')::uuid;
 if op is null or not lab_private.nonblank(iid) or jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p_request->'expected_revision') is distinct from 'number' or jsonb_typeof(p->'expected_approval_revision') is distinct from 'number' then raise exception 'Incident and Phase 2 approval revisions are required.';end if;
 if (p_request->>'expected_revision')::numeric<>(p_request->>'expected_revision')::bigint or (p->>'expected_approval_revision')::numeric<>(p->>'expected_approval_revision')::bigint or (p->>'expected_approval_revision')::bigint<0 then raise exception 'Use exact nonnegative integer revisions.';end if;
 reasonv:=p->>'reason';if jsonb_typeof(p->'reason') is distinct from 'string' or not lab_private.nonblank(reasonv) or length(reasonv)>4000 then raise exception 'Record an explicit supervisor reason of at most 4000 characters.';end if;
 digestv:=encode(sha256(convert_to(p_request::text,'UTF8')),'hex');select * into prior from public.lab_idempotency where operation_id=op;
 if found then if prior.owner_id<>actor or prior.request_hash<>digestv then raise exception using errcode='23505',message='This submission ID has already been used for a different request.';end if;return prior.result;end if;
 select revision into rev from public.incident where id=iid for update;
 if not found or rev<>(p_request->>'expected_revision')::bigint then raise exception using errcode='40001',message='This incident changed. Reload the latest version before Phase 2 approval.';end if;
 select * into a from public.lab_phase2_approval where incident_id=iid for update;
 if coalesce(a.revision,0)<>(p->>'expected_approval_revision')::bigint then raise exception using errcode='40001',message='Phase 2 approval changed. Reload the latest version.';end if;
 olda:=case when a.incident_id is not null then to_jsonb(a) else null end;nextrev:=rev+1;
 select * into w from public.lab_incident_workflow where incident_id=iid for update;oldw:=to_jsonb(w);
 if kindv='approve_phase2' then
  modev:=p->>'mode';if modev is null or modev not in ('approve','defer_nonessential') then raise exception 'Choose approval or explicit nonessential-work deferral.';end if;
  issues:=lab_private.phase2_hard_issues(iid);if jsonb_array_length(issues)>0 then raise exception using message='Phase 2 hard factual safeguards are not satisfied.',detail=issues::text;end if;
  if not coalesce(w.requirements_assessed,false) then raise exception 'Assess required and optional work before Phase 2 approval.';end if;
  select coalesce(jsonb_agg(jsonb_build_object('gap_task_id',g.id,'claim_id',g.claim_id,'lab_task_state',coalesce(t.lab_task_state,'NOT_ASSESSED'),'task_revision',t.revision,'question',g.data->>'factual_question')),'[]'::jsonb) into outstanding from public.gap_task g left join public.lab_task_workflow t on t.gap_task_id=g.id where g.incident_id=iid and coalesce(t.lab_task_state,'NOT_ASSESSED') not in ('RESOLVED','UNABLE_TO_RESOLVE') and not (coalesce(t.lab_task_state,'NOT_ASSESSED')='NOT_ASSESSED' and (coalesce(g.data->>'status','')='resolved' or coalesce(g.data->>'task_disposition','')='resolved'));
  select coalesce(jsonb_agg(jsonb_build_object('claim_id',c.id,'validation_state',c.data->>'validation_state','lab_reviewed',lab_private.lab_reviewed(c.id),'subject',c.data->>'subject')),'[]'::jsonb) into unresolved from public.claim c where lab_private.fact_in_scope(c.id,iid) and coalesce((c.data->>'is_current')::boolean,true) and (not lab_private.lab_reviewed(c.id) or c.data->>'validation_state' in ('CONFLICTING','NEEDS_MORE_EVIDENCE','NOT_REVIEWED') or c.data->'current_verified_value'='null'::jsonb);
  if modev='defer_nonessential' then
   for taskrow in select g.id from public.gap_task g join public.claim c on c.id=g.claim_id left join public.lab_task_workflow t on t.gap_task_id=g.id where g.incident_id=iid and g.claim_id=any(w.optional_claim_ids) and not g.claim_id=any(w.required_claim_ids) and c.data->>'claim_family' not in ('KINETIC_EVENT','ATTACK_RELATIONSHIP','IDENTITY','FACILITY_TYPE') and coalesce(t.lab_task_state,'NOT_ASSESSED') in ('NOT_ASSESSED','ACTIVE','BLOCKED') and not (coalesce(t.lab_task_state,'NOT_ASSESSED')='NOT_ASSESSED' and (coalesce(g.data->>'status','')='resolved' or coalesce(g.data->>'task_disposition','')='resolved')) loop
    select to_jsonb(t) into oldtask from public.lab_task_workflow t where gap_task_id=taskrow.id;
    insert into public.lab_task_workflow(gap_task_id,lab_task_state,lab_task_by,lab_task_at,reason,task) values(taskrow.id,'DEFERRED',actor,clock_timestamp(),reasonv,jsonb_build_object('lab_task_state','DEFERRED','lab_task_reason',reasonv,'resolution',reasonv,'disposition','deferred')) on conflict(gap_task_id) do update set lab_task_state='DEFERRED',lab_task_by=actor,lab_task_at=clock_timestamp(),reason=reasonv,task=coalesce(public.lab_task_workflow.task,'{}'::jsonb)||jsonb_build_object('lab_task_state','DEFERRED','lab_task_reason',reasonv,'resolution',reasonv,'disposition','deferred'),revision=public.lab_task_workflow.revision+1;
    perform lab_private.audit(iid,'GAP_TASK',taskrow.id,'defer','Remaining nonessential task deferred for Phase 2 approval',oldtask,(select to_jsonb(t) from public.lab_task_workflow t where gap_task_id=taskrow.id),jsonb_build_object('workflow_only',true,'phase2',true,'reason',reasonv,'incident_revision',nextrev));
   end loop;
   if not lab_private.phase2_completion_current(iid) then
    issues:=lab_private.completion_issues(iid);
    update public.lab_incident_workflow set status=case when jsonb_array_length(issues)=0 then 'review_complete' else 'supervisor_override' end,completion=jsonb_build_object('supervisor',actor,'timestamp',clock_timestamp(),'reviewed_revision',rev,'completion_revision',nextrev,'reason',reasonv,'override',jsonb_array_length(issues)>0,'unresolved_items',issues,'previous_completion',w.completion,'previous_status',w.status,'phase2_transaction',true) where incident_id=iid;
    perform lab_private.audit(iid,'INCIDENT',iid,'validate',case when jsonb_array_length(issues)=0 then 'Normal incident completion for Phase 2 approval' else 'Supervisor completion override for Phase 2 approval' end,oldw,(select to_jsonb(z) from public.lab_incident_workflow z where z.incident_id=iid),jsonb_build_object('workflow_only',true,'reason',reasonv));
   end if;
  elsif not lab_private.phase2_completion_current(iid) then raise exception 'Complete the current incident review before Phase 2 approval, or explicitly defer nonessential work and complete under the existing controlled workflow.';
  end if;
  insert into public.lab_phase2_approval(incident_id,approved_by,approved_at,approved_incident_revision,approval_reason,approval_mode,outstanding_tasks_at_approval,unresolved_facts_at_approval,status,changed_by,changed_at,change_reason) values(iid,actor,clock_timestamp(),nextrev,reasonv,modev,outstanding,unresolved,'APPROVED',actor,clock_timestamp(),reasonv)
   on conflict(incident_id) do update set approved_by=actor,approved_at=clock_timestamp(),approved_incident_revision=nextrev,approval_reason=reasonv,approval_mode=modev,outstanding_tasks_at_approval=outstanding,unresolved_facts_at_approval=unresolved,status='APPROVED',changed_by=actor,changed_at=clock_timestamp(),change_reason=reasonv,revision=public.lab_phase2_approval.revision+1;
 else
  if a.incident_id is null or a.status='REVOKED' then raise exception 'There is no current Phase 2 approval to revoke.';end if;
  update public.lab_phase2_approval set status='REVOKED',changed_by=actor,changed_at=clock_timestamp(),change_reason=reasonv,revision=revision+1 where incident_id=iid;
 end if;
 update public.incident set revision=nextrev where id=iid;
 update public.lab_incident_workflow set revision=nextrev,completion=case when status in ('review_complete','supervisor_override') and (completion->>'completion_revision')::bigint in (rev,nextrev) then completion||jsonb_build_object('completion_revision',nextrev,'carried_forward_at',clock_timestamp(),'carried_forward_reason','Phase 2 workflow decision; factual review unchanged') else completion end where incident_id=iid;
 perform lab_private.audit(iid,'INCIDENT',iid,'revise',case when kindv='revoke_phase2' then 'Phase 2 approval revoked' when olda is null then 'Incident approved for Phase 2' else 'Phase 2 approval renewed' end,olda,(select to_jsonb(z) from public.lab_phase2_approval z where z.incident_id=iid),jsonb_build_object('workflow_only',true,'phase2',true,'incident_revision',nextrev,'reason',reasonv));
 resultv:=jsonb_build_object('operation_id',op,'incident_id',iid,'revision',nextrev,'approval_revision',(select revision from public.lab_phase2_approval where incident_id=iid),'phase2_status',(select status from public.lab_phase2_approval where incident_id=iid),'status',(select status from public.lab_incident_workflow where incident_id=iid),'created_ids','[]'::jsonb);
 insert into public.lab_idempotency(operation_id,owner_id,request_hash,result) values(op,actor,digestv,resultv);return resultv;
end $$;

alter function public.lab_snapshot() set schema lab_private;
alter function lab_private.lab_snapshot() rename to snapshot_v23;
create function public.lab_snapshot() returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$ declare resultv jsonb;approvals jsonb;begin
 perform lab_private.require_actor(false);resultv:=lab_private.snapshot_v23();
 select coalesce(jsonb_object_agg(incident_id,to_jsonb(a)),'{}'::jsonb) into approvals from public.lab_phase2_approval a;
 return resultv||jsonb_build_object('phase2_approvals',approvals);
end $$;
revoke all on all functions in schema lab_private from public,anon,authenticated;
grant execute on function lab_private.active_user() to authenticated;
revoke all on function public.lab_snapshot(),public.lab_commit(jsonb) from public,anon,authenticated;
grant execute on function public.lab_snapshot(),public.lab_commit(jsonb) to authenticated;
commit;


-- V2.4.1 additive correction. Apply after unchanged migrations 001--005.
-- No seed, historical resolution, alias, review artifact or classification is rewritten.
begin;
create table public.lab_facility_resolution_reopening(
 resolution_id text primary key references public.lab_facility_resolution(id),
 id text not null unique, facility_id text not null references public.facility(id),
 target_facility_id text not null references public.facility(id),
 reopened_by uuid not null references public.lab_profiles(user_id),
 reopened_at timestamptz not null, reason text not null check(length(btrim(reason)) between 1 and 4000),
 activity_id text not null references public.activity_log(id), prior_resolution jsonb not null, incident_ids text[] not null,
 restored_link_ids text[] not null, retired_link_ids text[] not null,
 revision bigint not null default 1 check(revision=1)
);
alter table public.lab_facility_resolution_reopening enable row level security;
revoke all on public.lab_facility_resolution_reopening from public,anon,authenticated;
grant select on public.lab_facility_resolution_reopening to authenticated;
create policy lab_read on public.lab_facility_resolution_reopening for select to authenticated using(lab_private.active_user());
create trigger reopening_no_rewrite before update or delete on public.lab_facility_resolution_reopening for each row execute function lab_private.immutable_history();
create function lab_private.facility_resolution_current(rid text) returns boolean language sql stable set search_path=pg_catalog,public
as $$ select exists(select 1 from public.lab_facility_resolution r where r.id=rid) and not exists(select 1 from public.lab_facility_resolution_reopening x where x.resolution_id=rid) $$;

-- Future events snapshot the acting role; old activity rows remain untouched.
create or replace function lab_private.audit(iid text,etype text,eid text,action text,reason text,before_doc jsonb,after_doc jsonb,extra jsonb default '{}',aid text default null) returns text language plpgsql set search_path=pg_catalog,public
as $$ declare idv text:=coalesce(aid,lab_private.new_id('ACT')); artifact jsonb; fid text; begin
 if etype='CLAIM' and action='create' and reason='New unreviewed fact proposed' then
  reason:='Fact added';extra:=(extra-'proposed_fact'-'proposal_status')||jsonb_build_object('initial_entry',extra->'proposed_fact','initial_entry_state','NOT_REVIEWED','claim_family',after_doc->>'claim_family','proposition',after_doc->>'subject','fact_id',eid);
 end if;
 select facility_id into fid from public.incident_facility where incident_id=iid order by id limit 1;
 artifact:=jsonb_build_object('before',before_doc,'after',after_doc,'operation',extra);
 insert into public.activity_log(id,data) values(idv,jsonb_build_object('activity_id',idv,'incident_id',iid,'facility_id',fid,'entity_type',etype,'entity_id',eid,'action_type',action,'actor',auth.uid()::text,'actor_role',(select role from public.lab_profiles where user_id=auth.uid()),'timestamp',clock_timestamp(),'reason',reason,'before_ref',before_doc,'after_ref',after_doc,'authority_artifact',jsonb_build_object('payload',artifact,'sha256',encode(sha256(convert_to(artifact::text,'UTF8')),'hex')),'legacy_refs','[]'::jsonb));return idv;
end $$;
create or replace function lab_private.facility_identity_ready(fid text) returns boolean language sql stable set search_path=pg_catalog,public
as $$ select exists(select 1 from public.facility f where f.id=fid and f.data->>'identity_status'='IDENTIFIED')
 and exists(select 1 from public.claim c where c.facility_id=fid and c.data->>'claim_family'='IDENTITY' and coalesce(c.data->>'identity_purpose','')<>'facility_comparison' and c.data->>'value_type' in ('BOOLEAN','TEXT_WHERE_REQUIRED') and lab_private.lab_eligible(c.id))
 and not exists(select 1 from public.claim c left join public.lab_claim_workflow w on w.claim_id=c.id where c.facility_id=fid and c.data->>'claim_family'='IDENTITY' and coalesce(c.data->>'identity_purpose','')<>'facility_comparison' and c.data->>'value_type' in ('BOOLEAN','TEXT_WHERE_REQUIRED') and coalesce((c.data->>'is_current')::boolean,true) and (c.data->>'validation_state'='CONFLICTING' or coalesce(w.review_needed,false)))
 and not exists(select 1 from public.lab_facility_resolution r where r.facility_id=fid and r.outcome='same' and lab_private.facility_resolution_current(r.id)) $$;
create or replace function lab_private.facility_readiness(fid text) returns jsonb language plpgsql stable set search_path=pg_catalog,public
as $$ declare f jsonb; typ jsonb; ls text; lr boolean; tr boolean; ir boolean; res jsonb; fw public.lab_facility_workflow%rowtype; location_current boolean; begin
 select data into f from public.facility where id=fid;
 select coalesce(location_required,false) into lr from public.lab_facility_workflow where facility_id=fid; lr:=coalesce(lr,false);
 ls:=coalesce(f->'location_review'->>'state','NOT_REVIEWED');
 select * into fw from public.lab_facility_workflow where facility_id=fid;
 location_current:=coalesce(fw.lab_location_review_state='REVIEWED',false);
 select case when count(distinct data->'current_verified_value')=1 then min((data->'current_verified_value')::text)::jsonb else null end into typ from public.claim where facility_id=fid and data->>'claim_family'='FACILITY_TYPE' and lab_private.lab_eligible(id);
 tr:=typ is not null and typ<>'null'::jsonb and not exists(select 1 from public.claim c left join public.lab_claim_workflow w on w.claim_id=c.id where c.facility_id=fid and c.data->>'claim_family'='FACILITY_TYPE' and coalesce((c.data->>'is_current')::boolean,true) and (c.data->>'validation_state'='CONFLICTING' or coalesce(w.review_needed,false)));
 ir:=lab_private.facility_identity_ready(fid);
 select to_jsonb(r) into res from public.lab_facility_resolution r where facility_id=fid and lab_private.facility_resolution_current(r.id) order by reviewed_at desc,id desc limit 1;
 return jsonb_build_object('facility_id',fid,'revision',(select revision from public.facility where id=fid),'identity_ready',ir,'facility_type',case when tr then typ else null end,'type_ready',tr,'location_state',case when location_current then ls else 'NOT_REVIEWED' end,'historical_location_state',ls,'location_required',lr,'location_ready',ls='SUPPORTED' and location_current,'lab_location_review_state',coalesce(fw.lab_location_review_state,'NOT_REVIEWED'),'lab_location_reviewed_by',fw.lab_location_reviewed_by,'lab_location_reviewed_at',fw.lab_location_reviewed_at,'lab_location_reviewed_facility_revision',fw.lab_location_reviewed_facility_revision,'downstream_ready',ir and tr and (not lr or (ls='SUPPORTED' and location_current)),'resolution',res);
end $$;
-- Accepted 003 engine; only immutable-resolution currentness guards differ.
create or replace function lab_private.commit_v2(p_request jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$ declare actor uuid:=lab_private.require_actor(false); kindv text:=p_request->>'kind'; p jsonb:=p_request->'payload'; iid text:=p_request->>'incident_id'; fid text; target text; op uuid; digestv text; prior public.lab_idempotency%rowtype; rev bigint; frev bigint; trev bigint; resultv jsonb; eff jsonb; item jsonb; old jsonb; newdoc jsonb; rel jsonb; sid text; cid text; aid text; rid text; outcomev text; statev text; val jsonb; artifact jsonb; oldtarget jsonb; aliasv jsonb; x record; n text; affected text[]:='{}'; created jsonb:='[]'; expected bigint; k text; is_replay boolean; begin
 if jsonb_typeof(p_request) is distinct from 'object' or length(p_request::text)>2000000 then raise exception 'Submission is missing or exceeds the pilot limit.'; end if;
 perform pg_advisory_xact_lock(749310091::bigint);
 -- Original transaction engine retains all V1 validation, authority and gates.
 if kindv in ('create_incident','submit_changes','complete_incident','reopen_incident','update_requirements') then
  op:=(p_request->>'operation_id')::uuid;is_replay:=exists(select 1 from public.lab_idempotency where operation_id=op);
  if kindv='create_incident' and not is_replay and exists(select 1 from public.lab_facility_resolution where facility_id=p->>'facility_id' and outcome='same' and lab_private.facility_resolution_current(id)) then raise exception 'This preserved provisional record was resolved as the same physical facility. Select its authoritative current facility instead.'; end if;
  if kindv='create_incident' and p ? 'facility_evidence' and (jsonb_typeof(p->'facility_evidence') is distinct from 'array' or jsonb_array_length(p->'facility_evidence')>20) then raise exception 'Facility evidence must be a bounded list.'; end if;
  resultv:=lab_private.commit_v1(p_request);
  if is_replay then return resultv; end if;
  if kindv='create_incident' then
   select facility_id into fid from public.incident_facility where incident_id=iid and coalesce((data->>'is_current')::boolean,true) limit 1;
   if p->'new_facility' is not null and p->'new_facility'<>'null'::jsonb then
    insert into public.lab_facility_workflow(facility_id,location_required,reason) values(fid,true,'New facility location remains material until explicitly assessed.');
    update public.facility set data=data||jsonb_build_object('location_review',jsonb_build_object('state','NOT_REVIEWED','reviewer',null,'reviewed_at',null),'location_evidence','[]'::jsonb) where id=fid;
   end if;
   for item in select value from jsonb_array_elements(coalesce(p->'facility_evidence','[]'::jsonb)) loop
    eff:=lab_private.facility_evidence(iid,fid,item);created:=created||(eff->'created_ids');
   end loop;
  elsif kindv='update_requirements' and p ? 'facility_requirements' then
   if jsonb_typeof(p->'facility_requirements') is distinct from 'object' then raise exception 'Facility requirements must be keyed by current facility.'; end if;
   for k,item in select key,value from jsonb_each(p->'facility_requirements') loop
    if not lab_private.current_link(iid,k) or jsonb_typeof(item->'location_required') is distinct from 'boolean' or not lab_private.nonblank(item->>'reason') then raise exception 'Explicit current-facility location requirement and reason are required.'; end if;
    insert into public.lab_facility_workflow(facility_id,location_required,reason,reviewer,reviewed_at) values(k,(item->>'location_required')::boolean,item->>'reason',actor,clock_timestamp()) on conflict(facility_id) do update set location_required=excluded.location_required,reason=excluded.reason,reviewer=excluded.reviewer,reviewed_at=excluded.reviewed_at,revision=public.lab_facility_workflow.revision+1;
    perform lab_private.audit(iid,'FACILITY',k,'revise','Material location requirement explicitly assessed',null,item);
    for x in select distinct incident_id from public.incident_facility where facility_id=k and incident_id<>iid and coalesce((data->>'is_current')::boolean,true) loop
     select to_jsonb(w) into old from public.lab_incident_workflow w where incident_id=x.incident_id;
     update public.incident set revision=revision+1 where id=x.incident_id;
     update public.lab_incident_workflow set revision=revision+1,status=case when status in ('review_complete','supervisor_override') then 'reopened' else status end where incident_id=x.incident_id;
     perform lab_private.audit(x.incident_id,'INCIDENT',x.incident_id,'revise','Shared facility location requirement changed',old,(select to_jsonb(w) from public.lab_incident_workflow w where incident_id=x.incident_id),jsonb_build_object('facility_id',k,'originating_incident',iid));
    end loop;
   end loop;
  end if;
  resultv:=jsonb_set(resultv,'{created_ids}',coalesce(resultv->'created_ids','[]'::jsonb)||created);
  update public.lab_idempotency set result=resultv where operation_id=op; return resultv;
 end if;
 if kindv is null or kindv not in ('resolve_facility','review_location','facility_evidence') then raise exception 'Unsupported lab operation.'; end if;
 op:=(p_request->>'operation_id')::uuid;fid:=p->>'facility_id';
 if op is null or not lab_private.nonblank(iid) or jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p_request->'expected_revision') is distinct from 'number' or jsonb_typeof(p->'expected_facility_revision') is distinct from 'number' then raise exception 'Incident and facility revisions are required.'; end if;
 digestv:=encode(sha256(convert_to(p_request::text,'UTF8')),'hex');select * into prior from public.lab_idempotency where operation_id=op;
 if found then
  if prior.owner_id<>actor or prior.request_hash<>digestv then raise exception using errcode='23505',message='This submission ID has already been used for a different request.'; end if;return prior.result;
 end if;
 select revision into rev from public.incident where id=iid for update;
 if not found or rev<>(p_request->>'expected_revision')::bigint then raise exception using errcode='40001',message='The incident changed. Reload before submitting facility review.'; end if;
 select data,revision into old,frev from public.facility where id=fid for update;
 if not found or frev<>(p->>'expected_facility_revision')::bigint then raise exception using errcode='40001',message='The facility changed. Reload before submitting facility review.'; end if;
 if not lab_private.current_link(iid,fid) then raise exception 'Select a current facility association for this incident.'; end if;
 insert into public.lab_idempotency(operation_id,owner_id,request_hash) values(op,actor,digestv);
 if kindv='facility_evidence' then
  eff:=lab_private.facility_evidence(iid,fid,p);created:=eff->'created_ids';
  perform lab_private.touch_facility_incidents(fid,'Facility evidence requires inspection at the latest revision');
 elsif kindv='review_location' then
  perform lab_private.assert_location(p);perform lab_private.assert_relation(p->'relation');
  statev:=p->>'review_state';
  if statev is null or statev not in ('SUPPORTED','CONFLICTING','NEEDS_MORE_EVIDENCE') or (p->>'attestation') is distinct from 'true' or not lab_private.nonblank(p->>'basis') or not lab_private.nonblank(p->>'review_note') then raise exception 'Location review needs an explicit determination, evidence basis, review note and human attestation.'; end if;
  if statev='SUPPORTED' and not lab_private.nonblank(p->>'locality') and (p->'coordinates' is null or p->'coordinates'='null'::jsonb) then raise exception 'Supported location needs an established locality or coordinates.'; end if;
  if statev='SUPPORTED' and p->'relation'->>'support_direction'<>'SUPPORTS' then raise exception 'Supported location needs supporting evidence.'; end if;
  sid:=lab_private.intake_source(p);
  newdoc:=jsonb_build_object('state',statev,'locality',p->>'locality','coordinates',coalesce(p->'coordinates','null'::jsonb),'method',p->>'method','precision',p->>'precision','limitations',p->>'limitations','source_id',sid,'relation',p->'relation','basis',p->>'basis','review_note',p->>'review_note','reviewer',actor,'reviewed_at',clock_timestamp());
  aid:=lab_private.new_id('ACT');newdoc:=newdoc||jsonb_build_object('authority_artifact',aid);
  update public.facility set data=data||jsonb_build_object('location_review',newdoc,'location_evidence',coalesce(data->'location_evidence','[]'::jsonb)||jsonb_build_array(newdoc||jsonb_build_object('scope','location'))),revision=revision+1 where id=fid;
  if statev='SUPPORTED' then
   update public.facility set data=data||jsonb_build_object('locality_governorate',coalesce(data->'locality_governorate','{}'::jsonb)||jsonb_build_object('locality',p->>'locality'),'geo',case when p->'coordinates' is null or p->'coordinates'='null'::jsonb then 'null'::jsonb else p->'coordinates'||jsonb_build_object('source',sid,'method',p->>'method','precision',p->>'precision','limitations',p->>'limitations') end) where id=fid;
  end if;
  perform lab_private.audit(iid,'FACILITY',fid,'validate','Human review of facility location, separate from physical identity',old,(select data from public.facility where id=fid),newdoc,aid);
  perform lab_private.touch_facility_incidents(fid,'Facility location review changed; inspect the latest revision');
  created:=jsonb_build_array(jsonb_build_object('type','SOURCE','id',sid));
 else
  outcomev:=p->>'outcome';target:=nullif(p->>'target_facility_id','');
  if outcomev is null or outcomev not in ('same','different','unsure') or (p->>'attestation') is distinct from 'true' or not lab_private.nonblank(p->>'basis') or not lab_private.nonblank(p->>'review_note') then raise exception 'Facility resolution requires an explicit human decision, evidence basis, review note and attestation.'; end if;
  if outcomev in ('same','different') and target is null then raise exception 'Select the physical facility being compared.'; end if;
  if target=fid then raise exception 'A facility cannot be compared with itself.'; end if;
  if target is not null then
   select data,revision into oldtarget,trev from public.facility where id=target for update;
   if not found or jsonb_typeof(p->'expected_target_revision') is distinct from 'number' or trev<>(p->>'expected_target_revision')::bigint then raise exception using errcode='40001',message='The comparison facility changed. Reload before submitting.'; end if;
  end if;
  if exists(select 1 from public.lab_facility_resolution where facility_id=fid and outcome='same' and lab_private.facility_resolution_current(id)) then raise exception 'This provisional record has already been resolved as the same facility. Use its authoritative current association; reversal needs a separately authorized review.'; end if;
  if outcomev='same' and not lab_private.facility_identity_ready(target) then raise exception 'Select an authoritative existing facility with resolved physical identity.'; end if;
  if outcomev='same' then
   for x in select distinct i.id,i.revision from public.incident_facility z join public.incident i on i.id=z.incident_id where z.facility_id=fid and coalesce((z.data->>'is_current')::boolean,true) loop
    expected:=case when x.id=iid then (p_request->>'expected_revision')::bigint else (p->'incident_revisions'->>x.id)::bigint end;
    if expected is null or expected<>x.revision then raise exception using errcode='40001',message='Every incident currently linked to this provisional facility must be reviewed at its latest revision.'; end if;
    affected:=array_append(affected,x.id);
   end loop;
  else select coalesce(array_agg(distinct incident_id),'{}'::text[]) into affected from public.incident_facility where facility_id=fid and coalesce((data->>'is_current')::boolean,true); end if;
  rel:=p->'relation';perform lab_private.assert_relation(rel);
  if outcomev='same' and rel->>'support_direction'<>'SUPPORTS' then raise exception 'A same-facility decision needs supporting comparison evidence.'; end if;
  if outcomev='different' and rel->>'support_direction' not in ('CONTRADICTS','LIMITS') then raise exception 'A different-facility decision needs evidence contradicting or limiting the same-facility proposition.'; end if;
  sid:=lab_private.intake_source(p);cid:=lab_private.new_id('C');aid:=lab_private.new_id('ACT');rid:=lab_private.new_id('FR');
  val:=case outcomev when 'same' then 'true'::jsonb when 'different' then 'false'::jsonb else 'null'::jsonb end;statev:=case when outcomev='unsure' then 'NEEDS_MORE_EVIDENCE' else 'SUPPORTED' end;
  newdoc:=jsonb_build_object('claim_id',cid,'incident_id',iid,'facility_id',fid,'claim_family','IDENTITY','identity_purpose','facility_comparison','comparison_target_facility_id',target,'subject',case when target is null then 'The physical identity of facility record '||fid||' is established independently of possible existing records.' else 'Facility record '||fid||' represents the same physical facility as '||target||'.' end,'value_type','BOOLEAN','current_verified_value',val,'validation_state',statev,'validation_origin','V3_HUMAN_CLAIM_VALIDATION','individual_human_factual_adjudication','YES','ai_original_value',null,'ai_original_provenance',null,'reviewer',actor,'reviewed_at',clock_timestamp(),'review_notes',p->>'review_note','is_current',true,'date_precision',null,'quantitative_unit',null,'impact_basis',null,'legacy_refs','[]'::jsonb);
  insert into public.claim(id,data) values(cid,newdoc);insert into public.lab_claim_workflow(claim_id) values(cid);
  -- Direct call of preserved intake engine here is scoped by this server-created comparison.
  eff:=lab_private.apply_changes_v1(iid,jsonb_build_array(jsonb_build_object('type','evidence','claim_id',cid,'source_id',sid,'relation',rel,'material',false,'material_reason','Comparison source assessed in this same explicit human review.')));
  update public.lab_claim_workflow set review_needed=false where claim_id=cid;
  -- Contradictory comparison evidence has already been adjudicated atomically;
  -- no outstanding research task is manufactured from the same transaction.
  for x in select id,data from public.gap_task where claim_id=cid loop
   update public.gap_task set data=data||jsonb_build_object('status','resolved','task_disposition','resolved','resolution','Assessed in the facility comparison human review.','resolved_date',current_date),revision=revision+1 where id=x.id;
   perform lab_private.audit(iid,'GAP_TASK',x.id,'resolve','Comparison evidence reviewed in the same transaction',x.data,(select data from public.gap_task where id=x.id));
  end loop;
  artifact:=jsonb_build_object('claim_id',cid,'proposal',p,'source_id',sid,'relation',rel,'reviewer',actor,'reviewed_at',clock_timestamp());
  newdoc:=newdoc||jsonb_build_object('current_value_authority',jsonb_build_object('authority_artifact',aid,'authority_path','ACTIVITY_LOG/'||aid||'/authority_artifact/payload/operation/review_artifact','authority_scope',newdoc->>'subject','authority_type','V3_HUMAN_CLAIM_VALIDATION','authority_date',current_date,'authority_sha256',encode(sha256(convert_to(artifact::text,'UTF8')),'hex'),'recording_basis','CONTEMPORANEOUSLY_RECORDED'));
  update public.claim set data=newdoc where id=cid;
  perform lab_private.audit(iid,'CLAIM',cid,'validate','Explicit physical-facility comparison; names alone never merge records',null,newdoc,jsonb_build_object('review_artifact',artifact),aid);
  insert into public.lab_facility_resolution(id,facility_id,target_facility_id,outcome,identity_claim_id,source_id,reviewer,reviewed_at,basis,review_note,activity_id,incident_ids) values(rid,fid,target,outcomev,cid,sid,actor,clock_timestamp(),p->>'basis',p->>'review_note',aid,affected);
  if outcomev='same' then
   -- Preserve the source record and its aliases; carry alias provenance forward.
   for aliasv in select value from jsonb_array_elements(coalesce(old->'aliases','[]'::jsonb)) loop
    update public.facility set data=jsonb_set(data,'{aliases}',coalesce(data->'aliases','[]'::jsonb)||jsonb_build_array(aliasv||jsonb_build_object('origin_facility_id',fid,'identity_resolution_id',rid,'identity_claim_id',cid))) where id=target;
   end loop;
   update public.facility set revision=revision+1 where id=target;
   perform lab_private.audit(iid,'FACILITY',target,'revise','Preserved source-described aliases from explicitly resolved record',oldtarget,(select data from public.facility where id=target),jsonb_build_object('resolution_id',rid));
   for x in select id,data,incident_id from public.incident_facility where facility_id=fid and coalesce((data->>'is_current')::boolean,true) loop
    update public.incident_facility set data=data||jsonb_build_object('is_current',false,'superseded_by_facility_resolution',rid),revision=revision+1 where id=x.id;
    perform lab_private.audit(x.incident_id,'INCIDENT_FACILITY',x.id,'revise','Previous physical-facility association preserved as historical',x.data,(select data from public.incident_facility where id=x.id),jsonb_build_object('resolution_id',rid));
    if not lab_private.current_link(x.incident_id,target) then
     n:=lab_private.new_id('IF');item:=x.data||jsonb_build_object('incident_facility_id',n,'facility_id',target,'is_current',true,'identity_basis_claim_ids',jsonb_build_array(cid),'facility_resolution_id',rid,'supersedes_incident_facility_id',x.id);
     -- This settles physical association, not attack relationship or causation.
     insert into public.incident_facility(id,data) values(n,item);perform lab_private.audit(x.incident_id,'INCIDENT_FACILITY',n,'create','Physical facility association resolved by explicit human evidence',null,item);
    end if;
   end loop;
  elsif outcomev='different' then
   update public.facility set data=data||jsonb_build_object('identity_status',case when exists(select 1 from public.claim c where c.facility_id=fid and c.data->>'claim_family'='IDENTITY' and coalesce(c.data->>'identity_purpose','')<>'facility_comparison' and c.data->>'value_type' in ('BOOLEAN','TEXT_WHERE_REQUIRED') and lab_private.eligible(c.id)) then 'IDENTIFIED' else 'PARTIALLY_IDENTIFIED' end) where id=fid;
  else update public.facility set data=data||jsonb_build_object('identity_status','POSSIBLE_DUPLICATE_OR_RELATED_RECORD') where id=fid;
  end if;
  update public.facility set revision=revision+1 where id=fid;
  perform lab_private.audit(iid,'FACILITY',fid,'resolve','Physical-facility comparison: '||outcomev,old,(select data from public.facility where id=fid),jsonb_build_object('resolution_id',rid,'target_facility_id',target,'identity_claim_id',cid));
  foreach n in array affected loop
   update public.incident set revision=revision+1 where id=n;
   update public.lab_incident_workflow set revision=revision+1,status=case when status in ('review_complete','supervisor_override') then 'reopened' else status end,requirements_assessed=case when outcomev='same' then false else requirements_assessed end where incident_id=n;
   perform lab_private.audit(n,'INCIDENT',n,'revise','Facility comparison changed current association or identity review',null,(select to_jsonb(w) from public.lab_incident_workflow w where incident_id=n),jsonb_build_object('resolution_id',rid));
  end loop;
  created:=jsonb_build_array(jsonb_build_object('type','CLAIM','id',cid),jsonb_build_object('type','SOURCE','id',sid))||(eff->'created_ids');
 end if;
 resultv:=jsonb_build_object('operation_id',op,'incident_id',iid,'revision',(select revision from public.incident where id=iid),'status',(select status from public.lab_incident_workflow where incident_id=iid),'facility_revision',(select revision from public.facility where id=fid),'created_ids',created);
 update public.lab_idempotency set result=resultv where operation_id=op;return resultv;
end $$;

alter function public.lab_commit(jsonb) set schema lab_private;
alter function lab_private.lab_commit(jsonb) rename to commit_v24;
create function public.lab_commit(p_request jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$ declare actor uuid:=lab_private.require_actor(false); p jsonb:=p_request->'payload'; iid text:=p_request->>'incident_id';
 op uuid;digestv text;prior public.lab_idempotency%rowtype;r public.lab_facility_resolution%rowtype;
 fid text;target text;rid text;reasonv text;rev bigint;frev bigint;trev bigint;oldf jsonb;
 affected text[];linkids text[];restored text[]:='{}';retired text[]:='{}';n text;newid text;aid text;eventid text;
 x record;oldw jsonb;oldc jsonb;oldapproval jsonb;item jsonb;resultv jsonb;expected jsonb;
 begin
 if jsonb_typeof(p_request) is distinct from 'object' or length(p_request::text)>2000000 then raise exception 'Submission is missing or exceeds the pilot limit.';end if;
 if p_request->>'kind' is distinct from 'reopen_facility_identity' then return lab_private.commit_v24(p_request);end if;
 perform lab_private.require_actor(true);perform pg_advisory_xact_lock(749310091::bigint);
 op:=(p_request->>'operation_id')::uuid;fid:=p->>'facility_id';target:=p->>'target_facility_id';rid:=p->>'resolution_id';reasonv:=p->>'reason';
 if op is null or not lab_private.nonblank(iid) or jsonb_typeof(p) is distinct from 'object' or not lab_private.nonblank(fid) or not lab_private.nonblank(target) or not lab_private.nonblank(rid) then raise exception 'Select the existing same-facility decision and its affected facilities.';end if;
 if jsonb_typeof(p->'reason') is distinct from 'string' or not lab_private.nonblank(reasonv) or length(reasonv)>4000 then raise exception 'Record a supervisor reason of at most 4000 characters.';end if;
 for expected in select value from jsonb_array_elements(jsonb_build_array(p_request->'expected_revision',p->'expected_facility_revision',p->'expected_target_revision')) loop
  if jsonb_typeof(expected) is distinct from 'number' or expected::text::numeric<1 or expected::text::numeric<>expected::text::bigint then raise exception 'Current exact integer incident and facility revisions are required.';end if;
 end loop;
 if jsonb_typeof(p->'incident_revisions') is distinct from 'object' or jsonb_typeof(p->'link_revisions') is distinct from 'object' then raise exception 'All affected incident and association revisions are required.';end if;
 digestv:=encode(sha256(convert_to(p_request::text,'UTF8')),'hex');select * into prior from public.lab_idempotency where operation_id=op;
 if found then if prior.owner_id<>actor or prior.request_hash<>digestv then raise exception using errcode='23505',message='This submission ID has already been used for a different request.';end if;return prior.result;end if;
 select * into r from public.lab_facility_resolution where id=rid;
 if not found or r.facility_id<>fid or r.target_facility_id is distinct from target or r.outcome<>'same' or not lab_private.facility_resolution_current(rid) then raise exception 'Choose a current same-facility decision. This decision may already have been reopened.';end if;
 if not iid=any(r.incident_ids) then raise exception 'Open an incident originally affected by this facility decision.';end if;
 if exists(select 1 from public.lab_facility_resolution z where z.facility_id=target and z.outcome='same' and lab_private.facility_resolution_current(z.id)) then raise exception 'The comparison facility has a later current same-facility decision. Reopen that dependent decision first.';end if;
 select revision into rev from public.incident where id=iid for update;
 if not found or rev<>(p_request->>'expected_revision')::bigint then raise exception using errcode='40001',message='This incident changed. Reload before reopening facility identity.';end if;
 select data,revision into oldf,frev from public.facility where id=fid for update;
 if not found or frev<>(p->>'expected_facility_revision')::bigint then raise exception using errcode='40001',message='The source facility changed. Reload before reopening identity.';end if;
 select revision into trev from public.facility where id=target for update;
 if not found or trev<>(p->>'expected_target_revision')::bigint then raise exception using errcode='40001',message='The comparison facility changed. Reload before reopening identity.';end if;
 -- Check every current source/target association plus originals retired by this
 -- decision. Independent target associations stay current; later target cases
 -- are never relinked to the source merely because they share a facility.
 select coalesce(array_agg(id order by id),'{}'::text[]) into linkids from public.incident_facility z where
  (z.facility_id in (fid,target) and coalesce((z.data->>'is_current')::boolean,true)) or
  (z.facility_id=fid and z.data->>'superseded_by_facility_resolution'=rid);
 if not exists(select 1 from public.incident_facility z where z.facility_id=fid and z.data->>'superseded_by_facility_resolution'=rid) then raise exception 'The original facility associations are unavailable; no automatic correction was applied.';end if;
 select array_agg(distinct v order by v) into affected from (select unnest(r.incident_ids) v union select incident_id from public.incident_facility where id=any(linkids)) z;
 for x in select id,revision from public.incident_facility where id=any(linkids) order by id for update loop
  expected:=p->'link_revisions'->x.id;
  if jsonb_typeof(expected) is distinct from 'number' or expected::text::numeric<>x.revision then raise exception using errcode='40001',message='An affected facility association changed or its revision is missing. Reload every affected record.';end if;
 end loop;
 for x in select id,revision from public.incident where id=any(affected) order by id for update loop
  expected:=p->'incident_revisions'->x.id;
  if jsonb_typeof(expected) is distinct from 'number' or expected::text::numeric<>x.revision then raise exception using errcode='40001',message='An affected incident changed or its revision is missing. Reload every affected record.';end if;
 end loop;
 -- Original incidents must still contain the target association; an intervening
 -- unrelated association correction cannot be silently undone.
 for x in select distinct incident_id from public.incident_facility z where z.facility_id=fid and z.data->>'superseded_by_facility_resolution'=rid loop
  if not lab_private.current_link(x.incident_id,target) then raise exception 'A later association change must be reviewed before this earlier facility decision can be reopened.';end if;
 end loop;
 aid:=lab_private.new_id('ACT');eventid:=lab_private.new_id('FRR');
 for x in select id,data,incident_id from public.incident_facility z where z.facility_id=target and z.data->>'facility_resolution_id'=rid and coalesce((z.data->>'is_current')::boolean,true) order by id loop
  update public.incident_facility set data=data||jsonb_build_object('is_current',false,'retired_by_facility_resolution_reopening',eventid),revision=revision+1 where id=x.id;
  retired:=array_append(retired,x.id);
  perform lab_private.audit(x.incident_id,'INCIDENT_FACILITY',x.id,'revise','Facility association retired after identity decision was reopened',x.data,(select data from public.incident_facility where id=x.id),jsonb_build_object('resolution_id',rid,'reopening_id',eventid,'reason',reasonv));
 end loop;
 for x in select id,data,incident_id from public.incident_facility z where z.facility_id=fid and z.data->>'superseded_by_facility_resolution'=rid order by id loop
  if not lab_private.current_link(x.incident_id,fid) then
   newid:=lab_private.new_id('IF');item:=(x.data-'superseded_by_facility_resolution'-'retired_by_facility_resolution_reopening')||jsonb_build_object('incident_facility_id',newid,'is_current',true,'facility_match_state','unresolved','identity_basis_claim_ids','[]'::jsonb,'restored_from_incident_facility_id',x.id,'facility_resolution_reopening_id',eventid,'relationship_notes',concat_ws(' ',nullif(x.data->>'relationship_notes',''),'Facility identity decision reopened: '||reasonv));
   insert into public.incident_facility(id,data) values(newid,item);restored:=array_append(restored,newid);
   perform lab_private.audit(x.incident_id,'INCIDENT_FACILITY',newid,'create','Original facility association restored pending identity review',null,item,jsonb_build_object('resolution_id',rid,'reopening_id',eventid,'reason',reasonv));
  end if;
 end loop;
 update public.facility set data=data||jsonb_build_object('identity_status','POSSIBLE_DUPLICATE_OR_RELATED_RECORD'),revision=revision+1 where id=fid;
 update public.facility set revision=revision+1 where id=target; -- aliases remain byte-identical
 for x in select c.id from public.claim c where c.facility_id=fid and c.data->>'claim_family'='IDENTITY' and coalesce((c.data->>'is_current')::boolean,true) loop
  select to_jsonb(w) into oldc from public.lab_claim_workflow w where claim_id=x.id;
  insert into public.lab_claim_workflow(claim_id,review_needed,lab_review_state) values(x.id,true,'NOT_REVIEWED') on conflict(claim_id) do update set review_needed=true,lab_review_state=case when public.lab_claim_workflow.lab_review_state in ('REVIEWED','REOPENED') then 'REOPENED' else 'NOT_REVIEWED' end,revision=public.lab_claim_workflow.revision+1;
  perform lab_private.audit(iid,'CLAIM',x.id,'reopen','Facility identity needs renewed lab review',oldc,(select to_jsonb(w) from public.lab_claim_workflow w where claim_id=x.id),jsonb_build_object('workflow_only',true,'resolution_id',rid,'reopening_id',eventid,'reason',reasonv));
 end loop;
 select data into oldc from public.claim where id=r.identity_claim_id;
 update public.claim set data=data||jsonb_build_object('is_current',false,'superseded_by_facility_resolution_reopening',eventid),revision=revision+1 where id=r.identity_claim_id;
 perform lab_private.audit(iid,'CLAIM',r.identity_claim_id,'revise','Earlier same-facility finding preserved as historical after reopening',oldc,(select data from public.claim where id=r.identity_claim_id),jsonb_build_object('resolution_id',rid,'reopening_id',eventid,'reason',reasonv,'factual_value_unchanged',true));
 foreach n in array affected loop
  select to_jsonb(w) into oldw from public.lab_incident_workflow w where incident_id=n;
  update public.incident set revision=revision+1 where id=n;
  update public.lab_incident_workflow set revision=(select revision from public.incident where id=n),status='reopened',requirements_assessed=false where incident_id=n;
  perform lab_private.audit(n,'INCIDENT',n,'reopen','Facility identity decision reopened; completion readiness needs renewed review',oldw,(select to_jsonb(w) from public.lab_incident_workflow w where incident_id=n),jsonb_build_object('workflow_only',true,'resolution_id',rid,'reopening_id',eventid,'reason',reasonv));
  select to_jsonb(a) into oldapproval from public.lab_phase2_approval a where incident_id=n and status='APPROVED';
  if oldapproval is not null then
   update public.lab_phase2_approval set status='NEEDS_REAPPROVAL',revision=revision+1,changed_by=actor,changed_at=clock_timestamp(),change_reason=reasonv where incident_id=n;
   perform lab_private.audit(n,'INCIDENT',n,'revise','Phase 2 approval invalidated after facility identity decision reopened',oldapproval,(select to_jsonb(a) from public.lab_phase2_approval a where incident_id=n),jsonb_build_object('workflow_only',true,'phase2',true,'resolution_id',rid,'reopening_id',eventid,'reason',reasonv));
  end if;
 end loop;
 perform lab_private.audit(iid,'FACILITY',fid,'reopen','Facility identity decision reopened',oldf,(select data from public.facility where id=fid),jsonb_build_object('workflow_only',true,'resolution_id',rid,'reopening_id',eventid,'reason',reasonv,'target_facility_id',target,'prior_decision',to_jsonb(r),'incident_ids',to_jsonb(affected),'restored_link_ids',to_jsonb(restored),'retired_link_ids',to_jsonb(retired)),aid);
 insert into public.lab_facility_resolution_reopening(resolution_id,id,facility_id,target_facility_id,reopened_by,reopened_at,reason,activity_id,prior_resolution,incident_ids,restored_link_ids,retired_link_ids) values(rid,eventid,fid,target,actor,clock_timestamp(),reasonv,aid,to_jsonb(r),affected,restored,retired);
 resultv:=jsonb_build_object('operation_id',op,'incident_id',iid,'revision',(select revision from public.incident where id=iid),'status','reopened','facility_id',fid,'facility_revision',frev+1,'target_facility_revision',trev+1,'resolution_id',rid,'reopening_id',eventid,'affected_incident_ids',to_jsonb(affected),'created_ids',(select coalesce(jsonb_agg(jsonb_build_object('type','INCIDENT_FACILITY','id',z)),'[]'::jsonb) from unnest(restored) z));
 insert into public.lab_idempotency(operation_id,owner_id,request_hash,result) values(op,actor,digestv,resultv);return resultv;
end $$;

alter function public.lab_snapshot() set schema lab_private;
alter function lab_private.lab_snapshot() rename to snapshot_v24;
create function public.lab_snapshot() returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$ declare resultv jsonb;resolutions jsonb;events jsonb;begin
 perform lab_private.require_actor(false);resultv:=lab_private.snapshot_v24();
 select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('is_current',lab_private.facility_resolution_current(r.id),'reopening',(select to_jsonb(x) from public.lab_facility_resolution_reopening x where x.resolution_id=r.id)) order by r.reviewed_at,r.id),'[]'::jsonb) into resolutions from public.lab_facility_resolution r;
 select coalesce(jsonb_agg(to_jsonb(x) order by reopened_at,id),'[]'::jsonb) into events from public.lab_facility_resolution_reopening x;
 return jsonb_set(resultv,'{workflow}',resultv->'workflow'||jsonb_build_object('facility_resolutions',resolutions,'facility_resolution_reopenings',events));
end $$;
revoke all on all functions in schema lab_private from public,anon,authenticated;
grant execute on function lab_private.active_user() to authenticated;
revoke all on function public.lab_snapshot(),public.lab_commit(jsonb) from public,anon,authenticated;
grant execute on function public.lab_snapshot(),public.lab_commit(jsonb) to authenticated;
commit;
