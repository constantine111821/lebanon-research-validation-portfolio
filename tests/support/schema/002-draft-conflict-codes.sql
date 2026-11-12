-- Local schema only. Verify each replacement count before patching.
do $v121_replace$
declare r record; definition text; patched_definition text; n int;
begin
 for r in select * from (values ('lab_private.apply_changes(text, jsonb)',1),
 ('lab_private.apply_changes_v1(text, jsonb)',1),
 ('lab_private.commit_v1(jsonb)',2),
 ('lab_private.commit_v2(jsonb)',4),
 ('lab_private.commit_v23(jsonb)',2),
 ('lab_private.commit_v24(jsonb)',2),
 ('public.lab_commit(jsonb)',5),
 ('public.lab_delete_draft(text, bigint)',1),
 ('public.lab_save_draft(text, bigint, jsonb)',2)) x(signature,expected_count) loop
  definition:=pg_get_functiondef(to_regprocedure(r.signature));
  n:=(length(definition)-length(replace(definition,'errcode=''40001''','')))/length('errcode=''40001''');
  if n<>r.expected_count then raise exception 'V1.2.1 STOP: replacement count drift %',r.signature; end if;
  patched_definition:=replace(definition,'errcode=''40001''','errcode=''PT409''');
  execute patched_definition;
 end loop;
end $v121_replace$;
