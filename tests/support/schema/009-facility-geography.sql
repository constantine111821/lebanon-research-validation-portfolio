-- Additive local successor only. No table, historical row, account or data import.
begin;
select pg_advisory_xact_lock(749310091::bigint);
create function lab_private.review_facility_association(p_request jsonb) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare actor uuid:=lab_private.require_actor(true); p jsonb:=p_request->'payload'; iid text:=p_request->>'incident_id'; fid text:=p->>'facility_id'; lid text:=p->>'incident_facility_id'; op uuid; digestv text; prior public.lab_idempotency%rowtype; oldlink jsonb; newlink jsonb; lr bigint; ir bigint; fr bigint; sid text; aid text; statev text:=p->>'facility_match_state'; cid text:=p->>'identity_claim_id'; resultv jsonb;
begin
 if jsonb_typeof(p_request) is distinct from 'object' or length(p_request::text)>2000000 or jsonb_typeof(p) is distinct from 'object' then raise exception 'Submit a bounded association review.'; end if;
 perform pg_advisory_xact_lock(749310091::bigint);
 op:=(p_request->>'operation_id')::uuid;if op is null then raise exception 'An operation ID is required.'; end if;
 digestv:=encode(sha256(convert_to(p_request::text,'UTF8')),'hex');select * into prior from public.lab_idempotency where operation_id=op;
 if found then if prior.owner_id<>actor or prior.request_hash<>digestv then raise exception using errcode='23505',message='This submission ID has already been used for a different request.';end if;return prior.result;end if;
 perform lab_private.assert_unlocked(lab_private.incident_lock(iid));
 select revision into ir from public.incident where id=iid for update;
 select revision into fr from public.facility where id=fid for update;
 select data,revision into oldlink,lr from public.incident_facility where id=lid and incident_id=iid and facility_id=fid and coalesce((data->>'is_current')::boolean,true) for update;
 if oldlink is null or jsonb_typeof(p_request->'expected_revision') is distinct from 'number' or jsonb_typeof(p->'expected_facility_revision') is distinct from 'number' or jsonb_typeof(p->'expected_link_revision') is distinct from 'number' or ir is distinct from (p_request->>'expected_revision')::numeric or fr is distinct from (p->>'expected_facility_revision')::numeric or lr is distinct from (p->>'expected_link_revision')::numeric then raise exception using errcode='40001',message='The selected incident, facility or association changed. Reload before reviewing this exact association.';end if;
 if statev is null or statev not in ('supported','unresolved') or (p->>'attestation') is distinct from 'true' or not lab_private.nonblank(p->>'basis') or not lab_private.nonblank(p->>'review_note') then raise exception 'Association review needs an explicit determination, explanation, review note and physical-facility attestation.';end if;
 perform lab_private.assert_relation(p->'relation');
 if statev='supported' and (p->'relation'->>'support_direction'<>'SUPPORTS' or not lab_private.facility_identity_ready(fid) or not exists(select 1 from public.claim where id=cid and facility_id=fid and data->>'claim_family'='IDENTITY' and coalesce(data->>'identity_purpose','')<>'facility_comparison' and lab_private.lab_eligible(id))) then raise exception 'Supported association requires current canonical physical-identity evidence and a source supporting this exact incident-facility link.';end if;
 sid:=lab_private.intake_source(p);aid:=lab_private.new_id('ACT');
 newlink:=oldlink||jsonb_build_object('facility_match_state',statev,'association_review',jsonb_build_object('source_id',sid,'relation',p->'relation','basis',p->>'basis','review_note',p->>'review_note','reviewer',actor,'reviewed_at',clock_timestamp(),'authority_artifact',aid,'identity_claim_id',cid,'supersedes_authority_artifact',oldlink->'association_review'->>'authority_artifact'));
 if statev='supported' then newlink:=newlink||jsonb_build_object('identity_basis_claim_ids',jsonb_build_array(cid));end if;
 update public.incident_facility set data=newlink,revision=revision+1 where id=lid;
 update public.incident set revision=revision+1 where id=iid;
 update public.lab_incident_workflow set revision=revision+1,status=case when status in ('review_complete','supervisor_override') then 'reopened' else status end where incident_id=iid;
 update public.lab_phase2_approval set status='NEEDS_REAPPROVAL',revision=revision+1,changed_by=actor,changed_at=clock_timestamp(),change_reason='Physical facility association reviewed; output requires current incident acceptance.' where incident_id=iid and status='APPROVED';
 perform lab_private.audit(iid,'INCIDENT_FACILITY',lid,'validate','Explicit physical facility association review; no attack relationship, geography or factual approval implied',oldlink,newlink,jsonb_build_object('association_review',true,'facility_id',fid,'link_revision',lr+1),aid);
 resultv:=jsonb_build_object('operation_id',op,'incident_id',iid,'revision',ir+1,'facility_revision',fr,'link_revision',lr+1,'status',(select status from public.lab_incident_workflow where incident_id=iid),'created_ids',jsonb_build_array(jsonb_build_object('type','SOURCE','id',sid)));
 insert into public.lab_idempotency(operation_id,owner_id,request_hash,result) values(op,actor,digestv,resultv);return resultv;
end $$;
alter function public.lab_commit(jsonb) set schema lab_private;
alter function lab_private.lab_commit(jsonb) rename to commit_pre_geography_successor;
create function public.lab_commit(p_request jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=lab_private.require_actor(false); p jsonb:=p_request->'payload'; fid text:=p->>'facility_id';
 resultv jsonb; before_doc jsonb; after_doc jsonb; review_doc jsonb; proof jsonb; source_doc jsonb; ready jsonb;
 aid text; revisionv bigint; ids jsonb; replay boolean; ref_type text:=p->>'coordinate_reference_type';
begin
 if p_request->>'kind'='review_facility_association' then return lab_private.review_facility_association(p_request); end if;
 if p_request->>'kind' is distinct from 'review_location' then return lab_private.commit_pre_geography_successor(p_request); end if;
 -- UI and direct RPC callers share this permission boundary. No client role claim.
 perform lab_private.require_actor(true);
 perform pg_advisory_xact_lock(749310091::bigint);
 replay:=exists(select 1 from public.lab_idempotency where operation_id=(p_request->>'operation_id')::uuid);
 if replay then return lab_private.commit_pre_geography_successor(p_request); end if;
 select data into before_doc from public.facility where id=fid;
 if ref_type is null or ref_type not in ('HDX_DERIVED','RESEARCHED_CORRECTION','MANUAL_NON_HDX') then raise exception 'Identify the coordinate as original HDX-derived, researched correction or manual non-HDX evidence.'; end if;
 if not lab_private.nonblank(p->>'researcher_explanation') then raise exception 'Explain how the geographic source identifies the actual physical healthcare facility.'; end if;
 if p ? 'coordinate_rejected' and jsonb_typeof(p->'coordinate_rejected') is distinct from 'boolean' then raise exception 'Invalid geographic rejection decision.'; end if;
 if (p->>'coordinate_rejected')='true' and p->>'review_state'<>'NEEDS_MORE_EVIDENCE' then raise exception 'A rejected coordinate remains in Needs More Evidence.'; end if;
 if p->>'review_state'='SUPPORTED' then
  if p->'coordinates'->>'crs' is distinct from 'EPSG:4326' or p->'coordinates' is null or p->'coordinates'='null'::jsonb then raise exception 'Accepted GIS coordinates require WGS84 decimal degrees (EPSG:4326).'; end if;
  if (p->'coordinates'->>'latitude')::numeric=0 and (p->'coordinates'->>'longitude')::numeric=0 then raise exception 'An unknown point cannot be accepted as 0,0.'; end if;
  if p->>'method' not in ('EXACT_POINT','ENTRANCE','MAPPED_FACILITY_POINT','POLYGON_CENTROID','POLYGON_FIRST_VERTEX') then raise exception 'Accept only an evidenced physical facility point, never a village centroid or automatic guess.'; end if;
  ready:=lab_private.facility_readiness(fid);
  if ready->>'identity_ready' is distinct from 'true' or ready->>'type_ready' is distinct from 'true' then raise exception 'Review the canonical physical facility identity and type before accepting its geographic point.'; end if;
 end if;
 resultv:=lab_private.commit_pre_geography_successor(p_request);
 select data,revision into after_doc,revisionv from public.facility where id=fid;
 review_doc:=after_doc->'location_review';
 select data into source_doc from public.source where id=review_doc->>'source_id';
 if p->>'review_state'='SUPPORTED' and (not lab_private.nonblank(source_doc->>'title') or not lab_private.nonblank(source_doc->>'publisher_platform') or not (lab_private.nonblank(source_doc->>'original_url') or lab_private.nonblank(source_doc->>'canonical_url'))) then raise exception 'Accepted geography requires a source title, organization and URL or archival identifier.'; end if;
 select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into ids from (select distinct x->>'source_record_id' id from jsonb_array_elements(coalesce(before_doc->'authoritative_source_records','[]'::jsonb)) x where x->>'relationship'='PRIMARY_RECORD_FOR_PHYSICAL_FACILITY') a;
 if ref_type='HDX_DERIVED' and jsonb_array_length(ids)=0 then raise exception 'No original dataset identity is recorded. Use manual non-HDX evidence without fabricating a crosswalk.'; end if;
 aid:=lab_private.new_id('ACT');
 proof:=jsonb_build_object('policy','SUPERVISOR_GEOGRAPHY_REVIEW_20261020','facility_id',fid,'facility_revision',revisionv,'source_record_ids',ids,'source_id',review_doc->>'source_id','coordinates',review_doc->'coordinates','reference_type',ref_type,'reviewed_by',actor,'reviewed_at',review_doc->'reviewed_at','workflow_reviewed_at',(select lab_location_reviewed_at from public.lab_facility_workflow where facility_id=fid));
 review_doc:=review_doc||jsonb_build_object('authority_artifact',aid,'geographic_review',proof,'coordinate_reference_type',ref_type,'coordinate_rejected',coalesce((p->>'coordinate_rejected')::boolean,false),'source_evidence_version',p->>'source_evidence_version','researcher_explanation',p->>'researcher_explanation','supersedes_authority_artifact',before_doc->'location_review'->>'authority_artifact');
 -- The reviewed point is the current projection. Preserve original geometry and
 -- crosswalk byte-for-byte; append provenance rather than rewriting history.
 after_doc:=after_doc||jsonb_build_object('geo',before_doc->'geo','location_review',review_doc,'location_evidence',coalesce(after_doc->'location_evidence','[]'::jsonb)||jsonb_build_array(review_doc||jsonb_build_object('scope','location','decision_record',true)));
 update public.facility set data=after_doc where id=fid;
 perform lab_private.audit(p_request->>'incident_id','FACILITY',fid,'validate','Supervisor geographic decision; original geometry and earlier decisions preserved',before_doc,after_doc,proof,aid);
 return resultv;
end $$;
revoke all on function lab_private.commit_pre_geography_successor(jsonb) from public,anon,authenticated,service_role;
revoke all on function lab_private.review_facility_association(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.lab_commit(jsonb) from public,anon,authenticated;
grant execute on function public.lab_commit(jsonb) to authenticated;
commit;
