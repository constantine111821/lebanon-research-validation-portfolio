-- Add team coordination to the existing assign_case transaction only.
-- Legacy clients retain the primary assignment through application rollback.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
select pg_advisory_xact_lock(749310091::bigint);

alter table public.lab_case_assignment
  add column assigned_researchers uuid[],
  add constraint lab_case_assignment_researchers_consistent check (
    assigned_researchers is null or (
      cardinality(assigned_researchers) <= 100
      and array_position(assigned_researchers, null::uuid) is null
      and assigned_to is not distinct from assigned_researchers[1]
    )
  );

-- The existing wrapper stack continues handling authorization, replay, revision
-- checks, audit and current completion/Phase 2 carry. Only replace a verified
-- function body. CREATE OR REPLACE preserves the private function's OID and ACL.
do $migration$
declare
  proc oid := 'lab_private.commit_v23(jsonb)'::regprocedure;
  definition text;
  before_clause text;
  after_clause text;
  patch record;
begin
  select replace(pg_get_functiondef(p.oid), chr(13)||chr(10), chr(10)) into definition
  from pg_proc p
  where p.oid=proc
    and md5(replace(p.prosrc, chr(13)||chr(10), chr(10)))='6e7e0a359a4566c0738a812828089536'
    and p.prosecdef and p.proconfig=array['search_path=pg_catalog, public']
    and pg_get_userbyid(p.proowner)='postgres'
    and p.proacl::text='{postgres=X/postgres}';
  if not found then
    raise exception 'Assignment migration stopped: unexpected private assignment transaction.';
  end if;

  before_clause := $before$ if coalesce(arev,0)<>(p->>'expected_assignment_revision')::bigint then raise exception using errcode='PT409',message='This assignment changed. Reload the latest version.';end if;$before$;
  after_clause := before_clause || $members$
 if p ? 'assigned_researchers' then
  if p ? 'assigned_to' or jsonb_typeof(p->'assigned_researchers') is distinct from 'array' then
   raise exception 'Select the assignment team once.';
  end if;
  if jsonb_array_length(p->'assigned_researchers')>100 or exists (
   select 1 from jsonb_array_elements(p->'assigned_researchers') as member(value)
   where jsonb_typeof(value)<>'string'
      or value#>>'{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
   raise exception 'Choose at most 100 active researchers.';
  end if;
  select coalesce(array_agg(value::uuid order by position),'{}'::uuid[]) into assignees
  from jsonb_array_elements_text(p->'assigned_researchers') with ordinality as member(value,position);
  if cardinality(assignees)<>(select count(distinct member) from unnest(assignees) as selected(member)) then
   raise exception 'Choose each researcher only once.';
  end if;
  perform 1 from public.lab_profiles
  where user_id=any(assignees) and active and role='researcher' order by user_id for share;
  get diagnostics active_researchers=row_count;
  if active_researchers<>cardinality(assignees) then
   raise exception 'Choose active researcher accounts only.';
  end if;
  assignee:=assignees[1];
 elsif coalesce(jsonb_array_length(nullif(olda->'assigned_researchers','null'::jsonb)),0)>1 then
  if assignee is distinct from (olda->>'assigned_to')::uuid then
   raise exception using errcode='PT409',message='This incident has multiple assignees. Reload the current assignment editor to change the team.';
  end if;
  assignees:=array(select jsonb_array_elements_text(olda->'assigned_researchers')::uuid);
 end if;$members$;

  for patch in select * from (values
    ($old$assignee uuid; olda jsonb;$old$, $new$assignee uuid; assignees uuid[]; active_researchers bigint; olda jsonb;$new$),
    ($old$if not p ? 'assigned_to' or jsonb_typeof(p->'assignment_note')$old$, $new$if not (p ? 'assigned_to' or p ? 'assigned_researchers') or jsonb_typeof(p->'assignment_note')$new$),
    (before_clause,after_clause),
    ($old$insert into public.lab_case_assignment(incident_id,assigned_to,assigned_by,assigned_at,assignment_note) values(iid,assignee,actor,clock_timestamp(),p->>'assignment_note')$old$,
     $new$insert into public.lab_case_assignment(incident_id,assigned_to,assigned_by,assigned_at,assignment_note,assigned_researchers) values(iid,assignee,actor,clock_timestamp(),p->>'assignment_note',assignees)$new$),
    ($old$do update set assigned_to=excluded.assigned_to,assigned_by=excluded.assigned_by$old$,
     $new$do update set assigned_to=excluded.assigned_to,assigned_researchers=excluded.assigned_researchers,assigned_by=excluded.assigned_by$new$)
  ) as changes(old_text,new_text) loop
    if length(definition)-length(replace(definition,patch.old_text,''))<>length(patch.old_text) then
      raise exception 'Assignment migration stopped: expected one exact replacement per clause.';
    end if;
    definition:=replace(definition,patch.old_text,patch.new_text);
  end loop;
  execute definition;
end
$migration$;
commit;
