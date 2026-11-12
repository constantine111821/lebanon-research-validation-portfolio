import { factCitations } from './citations.js';
export const CSV_SCHEMA_VERSION = '2.0.0';
import { acceptanceReadiness, factWaived } from '../../../../packages/domain/src/acceptance-policy.js';
// V2.4: read-only output projection. No repository factual values are stored.
import {claims,facilityFor,facilityName,facilityReadiness,facilityCoordinates,recordType,reviewed,labReviewState,reviewStatus,evidenceFor,EFFECTS,factLabel,label} from './shared.js';
import {timingProjection} from './timing.js';
import * as D from './view-data.js';
import {phase2Approval,phase2Status,phase2Eligible,modelingReadiness} from './phase2-state.js';

const records=(s,k)=>s.records?.[k]||[];
const noValue=v=>v===null||v===undefined||v==='';
const direct=c=>/^(directly reported|directly_reported)$/i.test(c.impact_basis||'');
const knownFinding=(s,c)=>!factWaived(s,c.claim_id,c.incident_id)&&reviewed(c,s)&&['SUPPORTED','NOT_SUPPORTED'].includes(c.validation_state)&&!noValue(c.current_verified_value);
export function projectFact(s,c){
 const links=evidenceFor(s,c.claim_id),lab=s.workflow?.claims?.[c.claim_id]||{};
 return {fact_label:factLabel(c),citations:factCitations(s,c.claim_id),disposition:s.dispositions?.facts?.[c.claim_id]?.state||'ACTIVE',disposition_reason:s.dispositions?.facts?.[c.claim_id]?.reason??null,proposed_value:c.proposed_value??null,waived:factWaived(s,c.claim_id,c.incident_id),claim_id:c.claim_id,incident_id:c.incident_id??null,facility_id:c.facility_id??null,claim_family:c.claim_family,subject:c.subject||'',scope:c.scope??c.effect_scope??c.subject??null,value:c.current_verified_value??null,export_value:knownFinding(s,c)?c.current_verified_value:null,value_text:D.valueText(c),value_type:c.value_type,validation_state:c.validation_state||'NOT_REVIEWED',lab_review_state:labReviewState(c,s),review_needed:Boolean(lab.review_needed),date_precision:c.date_precision??null,quantitative_unit:c.quantitative_unit??null,impact_basis:c.impact_basis??null,review_notes:c.review_notes||'',revision:s.revisions?.CLAIM?.[c.claim_id]??null,lab_reviewed_by:lab.lab_reviewed_by??null,lab_reviewed_at:lab.lab_reviewed_at??null,source_ids:[...new Set(links.map(x=>x.source.source_id))],claim_source_ids:links.map(x=>x.relation.claim_source_id)};
}
export function facilityLocation(s,f){
 const geo=f?.geo||{},review=f?.location_review||{},ready=facilityReadiness(s,f?.facility_id),place=f?.locality_governorate;
 const projected=facilityCoordinates(s,f?.facility_id),coordinates=Number.isFinite(projected?.latitude)&&Number.isFinite(projected?.longitude)?projected:{latitude:null,longitude:null},coordinateRecord=review.coordinates!=null?review:geo;
 return {...coordinates,precision:coordinateRecord.precision??null,basis:coordinateRecord.source_id??coordinateRecord.source??coordinateRecord.basis??coordinateRecord.coordinate_method??coordinateRecord.method??null,method:coordinateRecord.method??coordinateRecord.coordinate_method??null,limitations:coordinateRecord.limitations??null,review_state:ready.location_state,lab_review_state:ready.lab_location_review_state,reviewed_by:ready.lab_location_reviewed_by,reviewed_at:ready.lab_location_reviewed_at,locality:typeof place==='string'?place:(place?.locality??place?.adm3_name??f?.locality??null),governorate_or_admin_area:typeof place==='object'?(place?.governorate??place?.adm1_name??place?.region??null):null,review_basis:review.basis??null,review_source_id:review.source_id??null};
}
// No date arithmetic. Multiple scoped facts remain separate; no date wins by recency.
function chronologyProjection(s,id,facts){
 const i=records(s,'INCIDENT').find(i=>i.incident_id===id),dates=facts.filter(c=>c.claim_family==='EVENT_DATE');
 const one=dates.length===1?dates[0]:null,v=one?.export_value;
 const display=dates.length?dates.map(c=>`${dates.length>1?c.subject+': ':''}${c.lab_review_state!=='REVIEWED'?'Not established by current lab':c.validation_state==='CONFLICTING'?'Conflicting':noValue(c.export_value)?'Not established':c.value_text} · precision ${label(c.date_precision||'UNKNOWN')} · ${label(c.validation_state)} · ${c.lab_review_state==='REVIEWED'?'Current-lab reviewed':c.lab_review_state==='REOPENED'?'Lab review reopened':'Needs lab validation'}`).join(' | '):'Not established from current date facts';
 const recordedDisplay=`${i?.event_start||'Start not established'}${i?.event_end?' – '+i.event_end:''} · ${i?.date_precision||'UNKNOWN'}`;
 return {facts:dates,event_start:typeof v==='string'?v:v&&typeof v==='object'?(v.start??null):null,event_end:v&&typeof v==='object'?(v.end??null):null,date_precision:one?.date_precision??(dates.length?'MULTIPLE_SCOPES':null),display,recorded_episode_display:recordedDisplay,recorded_episode_start:i?.event_start??null,recorded_episode_end:i?.event_end??null,recorded_episode_precision:i?.date_precision??null};
}
export function repositoryRecord(s,id){
 const incident=records(s,'INCIDENT').find(i=>i.incident_id===id);if(!incident)return null;
 const facility=facilityFor(s,id),facilityReady=facilityReadiness(s,facility?.facility_id),facts=claims(s,id).map(c=>projectFact(s,c)),effects=Object.fromEntries(EFFECTS.map(k=>[k,facts.filter(c=>c.claim_family===k)])),timing=timingProjection(s,id),approval=phase2Approval(s,id),status=phase2Status(s,id);
 const facilityIds=new Set(records(s,'INCIDENT_FACILITY').filter(l=>l.incident_id===id&&l.is_current!==false).map(l=>l.facility_id));
 const facilityFacts=records(s,'CLAIM').filter(c=>facilityIds.has(c.facility_id)&&c.is_current!==false&&['IDENTITY','FACILITY_TYPE'].includes(c.claim_family)&&c.identity_purpose!=='facility_comparison').map(c=>projectFact(s,c));
 const human=facts.filter(c=>c.claim_family==='HUMAN_IMPACT_MEASURE'),directHuman=human.filter(direct),capacity=human.filter(c=>!direct(c));
 const limitations=facts.filter(c=>c.waived||c.lab_review_state!=='REVIEWED'||!['SUPPORTED','NOT_SUPPORTED'].includes(c.validation_state)||c.review_needed).map(c=>`${c.subject}: ${c.waived?'WAIVED; ':''}${c.validation_state}; ${c.lab_review_state}${c.review_notes?' — '+c.review_notes:''}`);
 if(facility?.geo?.limitations)limitations.push('Facility coordinates: '+facility.geo.limitations);
 return {incident_facility_links:records(s,'INCIDENT_FACILITY').filter(l=>l.incident_id===id&&l.is_current!==false).sort((a,b)=>a.incident_facility_id.localeCompare(b.incident_facility_id)),incident_id:id,incident,record_type:recordType(s,id),facility_id:facility?.facility_id??null,facility_name:facilityName(facility),facility_type:facilityReady.facility_type??null,facility,location:facilityLocation(s,facility),chronology:chronologyProjection(s,id,facts),facts,facility_facts:facilityFacts,effects,timing,physical_damage:facts.filter(c=>c.claim_family==='PHYSICAL_DAMAGE'),attack_relationship:facts.filter(c=>c.claim_family==='ATTACK_RELATIONSHIP'),attack_occurrence:facts.filter(c=>c.claim_family==='KINETIC_EVENT'),causation:facts.filter(c=>c.claim_family==='ATTACK_TO_EFFECT_CAUSATION'),direct_human_effects:directHuman,capacity_context:capacity,limitations,approval,status,approved:phase2Eligible(s,id),completion_state:reviewStatus(s,id),completion:s.workflow?.incidents?.[id]?.completion??null,modeling_readiness:modelingReadiness(s,id),acceptance:acceptanceReadiness(s,id),incident_revision:s.revisions?.INCIDENT?.[id]??0};
}
export function repositoryRecords(s,{status='APPROVED',search='',checkBudget=()=>{},checkRecord=()=>{}}={}){
 const results=[];
 for(const incident of records(s,'INCIDENT')){
   checkBudget();
   if(status==='APPROVED'&&!phase2Eligible(s,incident.incident_id)) continue;
   const record=repositoryRecord(s,incident.incident_id);
   if(status!=='APPROVED'&&record.status!==status) continue;
   if(search.trim()&&![record.facility_name,record.facility_type,record.incident.incident_label,record.location.locality,record.location.governorate_or_admin_area,record.chronology.display].join(' ').toLowerCase().includes(search.trim().toLowerCase())) continue;
   checkRecord(record);
   results.push(record);
 }
 return results;
}
export const factState=c=>({fact_label:c.fact_label,value_type:c.value_type,review_notes:c.review_notes,lab_reviewed_by:c.lab_reviewed_by,lab_reviewed_at:c.lab_reviewed_at,revision:c.revision,citations:c.citations,disposition:c.disposition,disposition_reason:c.disposition_reason,waived:c.waived,claim_id:c.claim_id,incident_id:c.incident_id,facility_id:c.facility_id,claim_family:c.claim_family,scope:c.scope,subject:c.subject,value:c.export_value??null,recorded_value:c.value??null,proposed_value:c.proposed_value??null,evidence_state:c.validation_state,lab_review_state:c.lab_review_state,review_needed:c.review_needed,date_precision:c.date_precision,unit:c.quantitative_unit,impact_basis:c.impact_basis,source_ids:c.source_ids,claim_source_ids:c.claim_source_ids});
// Single finding: scalar. Multiple scopes: explicit JSON array in that cell.
export function fieldValue(facts){if(!facts?.length)return null;if(facts.length===1)return facts[0].export_value??null;return JSON.stringify(facts.map(factState));}
const fieldStates=facts=>facts?.length===1?facts[0].validation_state:facts?.length?JSON.stringify(facts.map(c=>({claim_id:c.claim_id,scope:c.scope,evidence_state:c.validation_state}))):'NOT_ESTABLISHED';
const textSummary=facts=>facts.map(c=>`${c.subject}: ${noValue(c.export_value)?'Not established':typeof c.export_value==='object'?JSON.stringify(c.export_value):String(c.export_value)}${c.quantitative_unit?' '+c.quantitative_unit:''} [${c.validation_state}; ${c.lab_review_state}${c.impact_basis?'; '+c.impact_basis:''}]`).join(' | ');
const timingFacts=(r,key)=>{const ids=new Set(r.timing.groups.find(g=>g.key===key)?.rows.map(c=>c.claim_id)||[]);return r.facts.filter(c=>ids.has(c.claim_id));};
export const CSV_COLUMNS=['incident_id','facility_id','facility_name','facility_type','locality','governorate_or_admin_area','facility_latitude','facility_longitude','facility_coordinate_precision','facility_location_review_state','event_start','event_end','date_precision','attack_relationship','physical_damage','full_closure','partial_closure','department_or_service_shutdown','reduced_capacity','evacuation','patient_transfer','utility_loss','access_disruption','relocation','effect_onset','restoration_status','restoration_date','source_reported_duration_value','source_reported_duration_unit','direct_human_effect_summary','capacity_context_summary','current_lab_completion_state','phase2_approved_by','phase2_approved_at','phase2_approved_revision','modeling_readiness','limitations_summary',
 'record_type','facility_coordinate_basis','facility_coordinate_limitations','facility_location_lab_review_state','incident_coordinates_json','event_date_facts_json','recorded_episode_start','recorded_episode_end','recorded_episode_precision','attack_relationship_evidence_state','physical_damage_evidence_state','full_closure_evidence_state','partial_closure_evidence_state','department_or_service_shutdown_evidence_state','reduced_capacity_evidence_state','evacuation_evidence_state','patient_transfer_evidence_state','utility_loss_evidence_state','access_disruption_evidence_state','relocation_evidence_state','effect_onset_evidence_state','restoration_status_evidence_state','restoration_date_evidence_state','source_reported_duration_evidence_state','facts_and_provenance_json','phase2_approval_reason','phase2_approval_mode','phase2_approval_record_revision','incident_current_revision','phase2_latest_change_by','phase2_latest_change_at','phase2_latest_change_reason','facility_facts_and_provenance_json','csv_schema_version','incident_facility_links_json','citations_json'];
export function csvRecord(r){
 const onset=timingFacts(r,'effect_onset'),restoration=timingFacts(r,'restoration_status'),end=timingFacts(r,'restoration_date'),duration=timingFacts(r,'source_reported_duration'),out={csv_schema_version:CSV_SCHEMA_VERSION,incident_facility_links_json:JSON.stringify(r.incident_facility_links),citations_json:JSON.stringify([...r.facts,...r.facility_facts].map(c=>({claim_id:c.claim_id,citations:c.citations}))),incident_id:r.incident_id,facility_id:r.facility_id,facility_name:r.facility_name,facility_type:r.facility_type,locality:r.location.locality,governorate_or_admin_area:r.location.governorate_or_admin_area,facility_latitude:r.location.latitude,facility_longitude:r.location.longitude,facility_coordinate_precision:r.location.precision,facility_location_review_state:r.location.review_state,event_start:r.chronology.event_start,event_end:r.chronology.event_end,date_precision:r.chronology.date_precision,attack_relationship:fieldValue(r.attack_relationship),physical_damage:fieldValue(r.physical_damage),effect_onset:fieldValue(onset),restoration_status:fieldValue(restoration),restoration_date:fieldValue(end),source_reported_duration_value:fieldValue(duration),source_reported_duration_unit:duration.length===1?duration[0].quantitative_unit:duration.length?JSON.stringify(duration.map(c=>({claim_id:c.claim_id,scope:c.scope,unit:c.quantitative_unit}))):null,direct_human_effect_summary:textSummary(r.direct_human_effects),capacity_context_summary:textSummary(r.capacity_context),current_lab_completion_state:r.completion_state,phase2_approved_by:r.approval?.approved_by,phase2_approved_at:r.approval?.approved_at,phase2_approved_revision:r.approval?.approved_incident_revision,modeling_readiness:r.modeling_readiness,limitations_summary:r.limitations.concat(r.acceptance.tasks.map(t=>'Nonblocking research task '+t.gap_task_id+': '+t.state)).join(' | '),record_type:r.record_type.canonical,facility_coordinate_basis:r.location.basis,facility_coordinate_limitations:r.location.limitations,facility_location_lab_review_state:r.location.lab_review_state,incident_coordinates_json:r.incident.incident_coordinates??r.incident.strike_coordinates??null,event_date_facts_json:JSON.stringify(r.chronology.facts.map(factState)),recorded_episode_start:r.chronology.recorded_episode_start,recorded_episode_end:r.chronology.recorded_episode_end,recorded_episode_precision:r.chronology.recorded_episode_precision,attack_relationship_evidence_state:fieldStates(r.attack_relationship),physical_damage_evidence_state:fieldStates(r.physical_damage),effect_onset_evidence_state:fieldStates(onset),restoration_status_evidence_state:fieldStates(restoration),restoration_date_evidence_state:fieldStates(end),source_reported_duration_evidence_state:fieldStates(duration),facts_and_provenance_json:JSON.stringify(r.facts.map(factState)),facility_facts_and_provenance_json:JSON.stringify(r.facility_facts.map(factState)),phase2_approval_reason:r.approval?.approval_reason,phase2_approval_mode:r.approval?.approval_mode,phase2_approval_record_revision:r.approval?.revision,incident_current_revision:r.incident_revision,phase2_latest_change_by:r.approval?.changed_by,phase2_latest_change_at:r.approval?.changed_at,phase2_latest_change_reason:r.approval?.change_reason};
 for(const family of EFFECTS){out[family.toLowerCase()]=fieldValue(r.effects[family]);out[family.toLowerCase()+'_evidence_state']=fieldStates(r.effects[family]);}return out;
}
export function csvCell(value){
 let text=noValue(value)?'':typeof value==='object'?JSON.stringify(value):String(value);
 // RFC 4180 quoting does not stop spreadsheet formula evaluation. Preserve numbers
 // (including real negative values); neutralize formula-like textual input only.
 if(typeof value==='string'&&/^[\s\uFEFF]*[=+@\-\t\r\n]/.test(text))text="'"+text;
 return '"'+text.replaceAll('"','""')+'"';
}
export function csvTable(headers,list,checkRow=()=>{}){
 const lines=[headers.map(csvCell).join(',')];
 for(const record of list){
   const line=headers.map(k=>csvCell(record[k])).join(',');
   checkRow(line);
   lines.push(line);
 }
 return '\uFEFF'+lines.join('\r\n')+'\r\n';
}
export function validatedIncidentsCSV(s){return csvTable(CSV_COLUMNS,repositoryRecords(s).map(csvRecord));}
export function csvFilename(date=new Date()){return 'validated_healthcare_facility_incidents_'+date.toISOString().slice(0,10)+'.csv';}
export const CONTEXT_COLUMNS=['facility_id','incident_id','claim_id','measure','value','unit','impact_basis','evidence_state','lab_review_state','reviewed_by','reviewed_at','reviewed_claim_revision','source_ids','claim_source_ids'];
export function contextMeasuresCSV(s){
 const approved=repositoryRecords(s),ids=new Set(approved.map(r=>r.incident_id)),facilities=new Set(approved.map(r=>r.facility_id));
 const list=records(s,'CLAIM').filter(c=>c.claim_family==='HUMAN_IMPACT_MEASURE'&&reviewed(c,s)&&(ids.has(c.incident_id)||!c.incident_id&&facilities.has(c.facility_id))).map(c=>{const p=projectFact(s,c),lab=s.workflow?.claims?.[c.claim_id];return {facility_id:c.facility_id,incident_id:c.incident_id,claim_id:c.claim_id,measure:c.subject,value:p.export_value,unit:c.quantitative_unit,impact_basis:c.impact_basis,evidence_state:c.validation_state,lab_review_state:p.lab_review_state,reviewed_by:lab.lab_reviewed_by,reviewed_at:lab.lab_reviewed_at,reviewed_claim_revision:lab.lab_reviewed_claim_revision,source_ids:JSON.stringify(p.source_ids),claim_source_ids:JSON.stringify(p.claim_source_ids)};});
 return csvTable(CONTEXT_COLUMNS,list);
}
