-- Phase 2 foundation only. No historical rewrite, approval change or production apply authority.
begin;
create table lab_private.analytics_binding (
 effective_at timestamptz primary key,
 application_commit text not null check(application_commit='UNKNOWN' or application_commit ~ '^[0-9a-f]{40}$'),
 corpus_sha256 text not null check(corpus_sha256='UNKNOWN' or corpus_sha256 ~ '^[0-9a-f]{64}$'),
 methodology_sha256 text not null check(methodology_sha256='UNKNOWN' or methodology_sha256 ~ '^[0-9a-f]{64}$'),
 scope_sha256 text not null check(scope_sha256='UNKNOWN' or scope_sha256 ~ '^[0-9a-f]{64}$'),
 authority_sha256 text not null check(authority_sha256 ~ '^[0-9a-f]{64}$')
);
create table lab_private.analytics_exclusion (
 source_key text primary key check(source_key ~ '^[0-9a-f]{64}$'),
 row_sha256 text not null check(row_sha256 ~ '^[0-9a-f]{64}$'),
 origin text not null check(origin in ('SMOKE_OR_REHEARSAL','IMPORT','HISTORICAL_PRESERVATION','SYSTEM_PROPAGATION','RESEARCH')),
 authority_sha256 text not null check(authority_sha256 ~ '^[0-9a-f]{64}$')
);
create table lab_private.analytics_snapshot (
 week_start date not null check(extract(isodow from week_start)=5),
 report_revision integer not null check(report_revision>0),
 supersedes_sha256 text references lab_private.analytics_snapshot(content_sha256),
 content_sha256 text not null unique check(content_sha256 ~ '^[0-9a-f]{64}$'),
 canonical_text text not null check(length(canonical_text)<=10000000),
 primary key(week_start,report_revision),
 check(content_sha256=encode(sha256(convert_to(canonical_text,'UTF8')),'hex')),
 check(jsonb_typeof(canonical_text::jsonb->'manifest')='object' and jsonb_typeof(canonical_text::jsonb->'aggregate')='object'),
 check((canonical_text::jsonb->'manifest'->>'week_start_local')::date=week_start),
 check((canonical_text::jsonb->'manifest'->>'report_revision')::integer=report_revision),
 check((canonical_text::jsonb->'manifest'->>'supersedes_sha256') is not distinct from supersedes_sha256),
 check((report_revision=1 and supersedes_sha256 is null) or (report_revision>1 and supersedes_sha256 is not null))
);
do $$ declare t text; begin
 foreach t in array array['analytics_binding','analytics_exclusion','analytics_snapshot'] loop
  execute format('alter table lab_private.%I enable row level security',t);
  execute format('revoke all on lab_private.%I from public,anon,authenticated,service_role',t);
  execute format('create trigger analytics_no_rewrite before update or delete on lab_private.%I for each row execute function lab_private.immutable_history()',t);
 end loop;
end $$;
create function lab_private.analytics_snapshot_append() returns trigger language plpgsql set search_path=pg_catalog as $$
declare prior record;begin
 perform pg_advisory_xact_lock(hashtextextended('analytics-week:'||new.week_start::text,0));
 select report_revision,content_sha256 into prior from lab_private.analytics_snapshot where week_start=new.week_start order by report_revision desc limit 1;
 if found then
  if new.report_revision<>prior.report_revision+1 or new.supersedes_sha256 is distinct from prior.content_sha256 then raise exception 'Snapshot successor must extend the latest same-week revision';end if;
 elsif new.report_revision<>1 or new.supersedes_sha256 is not null then raise exception 'First weekly capture requires revision one';end if;
 return new;
end $$;
create trigger analytics_append_chain before insert on lab_private.analytics_snapshot for each row execute function lab_private.analytics_snapshot_append();
create function lab_private.analytics_metadata(et text,act text,extra jsonb) returns jsonb
language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('schema_version',1,'operation_id',nullif(current_setting('rvw.analytics_operation',true),''),
 'event_type',case when et='SOURCE' and act='create' then 'source_created' else 'workflow_recorded' end,
 'actor_role_at_event',coalesce((select role from public.lab_profiles where user_id=auth.uid()),'UNKNOWN'),
 'origin',case when extra->>'phase2'='true' then 'SYSTEM_PROPAGATION' else 'UNKNOWN' end,'assistance_basis','UNKNOWN',
 'versions',coalesce((select jsonb_build_object('application_commit',application_commit,'corpus_sha256',corpus_sha256,'methodology_sha256',methodology_sha256,'scope_sha256',scope_sha256)
 from lab_private.analytics_binding where effective_at<=statement_timestamp() order by effective_at desc limit 1),
 '{"application_commit":"UNKNOWN","corpus_sha256":"UNKNOWN","methodology_sha256":"UNKNOWN","scope_sha256":"UNKNOWN"}'::jsonb))
$$;
create or replace function lab_private.audit(iid text,etype text,eid text,action text,reason text,before_doc jsonb,after_doc jsonb,extra jsonb default '{}',aid text default null) returns text language plpgsql set search_path=pg_catalog,public
as $$ declare idv text:=coalesce(aid,lab_private.new_id('ACT')); artifact jsonb; fid text; begin
 if etype='CLAIM' and action='create' and reason='New unreviewed fact proposed' then
  reason:='Fact added';extra:=(extra-'proposed_fact'-'proposal_status')||jsonb_build_object('initial_entry',extra->'proposed_fact','initial_entry_state','NOT_REVIEWED','claim_family',after_doc->>'claim_family','proposition',after_doc->>'subject','fact_id',eid);
 end if;
 select facility_id into fid from public.incident_facility where incident_id=iid order by id limit 1;
 artifact:=jsonb_build_object('before',before_doc,'after',after_doc,'operation',extra);
 insert into public.activity_log(id,data) values(idv,jsonb_build_object('activity_id',idv,'incident_id',iid,'facility_id',fid,'entity_type',etype,'entity_id',eid,'action_type',action,'actor',auth.uid()::text,'actor_role',(select role from public.lab_profiles where user_id=auth.uid()),'timestamp',clock_timestamp(),'reason',reason,'before_ref',before_doc,'after_ref',after_doc,'authority_artifact',jsonb_build_object('payload',artifact,'sha256',encode(sha256(convert_to(artifact::text,'UTF8')),'hex')),'legacy_refs','[]'::jsonb,'analytics',lab_private.analytics_metadata(etype,action,extra)));return idv;
end $$;
alter function public.lab_commit(jsonb) set schema lab_private;
alter function lab_private.lab_commit(jsonb) rename to commit_pre011;
create function public.lab_commit(p_request jsonb) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$ declare resultv jsonb; oldop text; oldincident text; begin
 perform lab_private.require_actor(false);
 oldop:=current_setting('rvw.analytics_operation',true);oldincident:=current_setting('rvw.analytics_incident',true);
 perform set_config('rvw.analytics_operation',((p_request->>'operation_id')::uuid)::text,true);
 perform set_config('rvw.analytics_incident',coalesce(p_request->>'incident_id',''),true);
 resultv:=lab_private.commit_pre011(p_request);
 perform set_config('rvw.analytics_operation',coalesce(oldop,''),true);
 perform set_config('rvw.analytics_incident',coalesce(oldincident,''),true);
 return resultv;
end $$;
create function lab_private.analytics_source_insert() returns trigger language plpgsql
set search_path=pg_catalog,public as $$ begin
 perform lab_private.audit(nullif(current_setting('rvw.analytics_incident',true),''),'SOURCE',new.id,'create',
 'Source inserted',null,jsonb_build_object('source_id',new.id),'{"actual_insert":true}'::jsonb);
 return new;
end $$;
create trigger analytics_source_created after insert on public.source for each row execute function lab_private.analytics_source_insert();
create function lab_private.analytics_instant(v text) returns timestamptz language plpgsql immutable
set search_path=pg_catalog as $$ begin
 if v !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then return null;end if;
 return v::timestamptz;
exception when others then return null;end $$;
create function public.lab_analytics_read(p_week date default null) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$ declare v record; begin
 perform lab_private.require_actor(true);
 select content_sha256,canonical_text::jsonb as doc into v from lab_private.analytics_snapshot
 where p_week is null or week_start=p_week order by week_start desc,report_revision desc limit 1;
 if not found then return jsonb_build_object('status','NOT_CAPTURED');end if;
 return jsonb_build_object('status','AVAILABLE','content_sha256',v.content_sha256,'manifest',v.doc->'manifest','aggregate',v.doc->'aggregate');
end $$;
revoke all on function lab_private.analytics_metadata(text,text,jsonb),lab_private.analytics_source_insert(),lab_private.analytics_instant(text),lab_private.analytics_snapshot_append(),lab_private.commit_pre011(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.lab_commit(jsonb),public.lab_analytics_read(date) from public,anon,authenticated;
grant execute on function public.lab_commit(jsonb),public.lab_analytics_read(date) to authenticated;
commit;
