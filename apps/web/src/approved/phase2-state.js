import { acceptanceReadiness, outputAuthorized } from '../../../../packages/domain/src/acceptance-policy.js';
import {claims, completionIsCurrent, facilityFor, facilityReadiness, facilityCoordinates, reviewed, eligible, tasks, preflight, EFFECTS} from './shared.js';
import {timingProjection} from './timing.js';

// Read-only workflow eligibility. Factual values remain exclusively in CLAIM.
export const PHASE2_HARD_FAMILIES = ['KINETIC_EVENT','ATTACK_RELATIONSHIP','IDENTITY','FACILITY_TYPE'];
export const phase2Approval = (s,id) => s.phase2_approvals?.[id] || null;

export function phase2Readiness(s,id){
 const summary=acceptanceReadiness(s,id),all=summary.facts,cs=claims(s,id),facility=facilityReadiness(s,facilityFor(s,id)?.facility_id),approval=phase2Approval(s,id),revision=s.revisions?.INCIDENT?.[id],completionCurrent=completionIsCurrent(s,id),deferred=s.dispositions?.incidents?.[id]?.state==='DEFERRED',eligible=outputAuthorized(s,id);
 const timingRows=timingProjection(s,id).groups.flatMap(g=>g.rows),service=cs.filter(c=>EFFECTS.includes(c.claim_family));
 return {summary,hardReady:true,canApprove:!deferred,canDeferAndApprove:false,blockers:deferred?[{key:'disposition',label:'Reopen this deferred incident before acceptance.'}]:[],gates:{},facility,facilities:summary.facility_limitations||[],locationReady:facility.location_ready,locationRequired:facility.location_required,completionCurrent,revision,requiredReviewed:summary.reviewed,requiredRemaining:all.filter(f=>f.status==='outstanding'),requiredTaskBlockers:[],reviewRequirementsReady:true,serviceReview:{reviewed:service.filter(c=>reviewed(c,s)).length,remaining:service.filter(c=>!reviewed(c,s)).length},timingReview:{reviewed:timingRows.filter(r=>r.lab_review_state==='REVIEWED').length,remaining:timingRows.filter(r=>r.lab_review_state!=='REVIEWED').length,unknown:timingRows.filter(r=>r.value==null).length},activeTasks:summary.tasks.filter(t=>['ACTIVE','BLOCKED','NOT_ASSESSED'].includes(t.state)).length,conflicts:summary.conflicting,deferrableTasks:[],outstandingTasks:summary.tasks.filter(t=>!['RESOLVED','UNABLE_TO_RESOLVE'].includes(t.state)),unassessedRequirements:!summary.requirements_assessed,approval,status:approval?(approval.status==='APPROVED'?(eligible?'APPROVED':'NEEDS_REAPPROVAL'):approval.status):null,completionProblems:preflight(s,id)};
}
export const phase2Status=(s,id)=>phase2Readiness(s,id).status;
export const phase2Eligible=(s,id)=>outputAuthorized(s,id);
export const phase2Approved=phase2Eligible;

// These labels describe missing reviewed inputs only. They do not run a model,
// infer a duration, or estimate population, catchment or service accessibility.
export function modelingReadiness(s,id) {
  if(!phase2Eligible(s,id))return 'OTHER_REQUIRED_INPUT_MISSING';
  const f=facilityFor(s,id),r=facilityReadiness(s,f?.facility_id),geo=facilityCoordinates(s,f?.facility_id);
  if(!r.location_ready||!Number.isFinite(geo?.latitude)||!Number.isFinite(geo?.longitude))return 'NEEDS_LOCATION';
  const effects=claims(s,id).filter(c=>EFFECTS.includes(c.claim_family)&&reviewed(c,s)&&eligible(c,s));
  if(!effects.length)return 'NEEDS_OPERATIONAL_IMPACT';
  const current=claims(s,id),groups=timingProjection(s,id).groups;
  const known=key=>groups.find(g=>g.key===key)?.rows.filter(c=>c.lab_review_state==='REVIEWED'&&c.eligible&&c.value!==null&&c.date_precision!=='UNKNOWN')||[];
  const starts=known('effect_onset'),ends=known('restoration_date'),durations=groups.find(g=>g.key==='source_reported_duration')?.rows.filter(c=>c.lab_review_state==='REVIEWED'&&c.eligible&&Number.isFinite(c.value))||[];
  if(!durations.length&&(!starts.length||!ends.length))return 'NEEDS_TIMING';
  // A known endpoint in one scope cannot complete an endpoint in another scope.
  // Scope is taken from explicit factual metadata, never guessed from prose.
  const scope=row=>{const c=current.find(x=>x.claim_id===row.claim_id);return c?.scope??c?.effect_scope??c?.effect_claim_id??null};
  const scopeKey=x=>x==null?null:JSON.stringify(x);
  if(durations.length===1&&!starts.length&&!ends.length&&effects.length===1)return 'READY';
  if(durations.length){const scopes=durations.map(row=>scopeKey(scope(row)));return scopes.every(Boolean)&&new Set(scopes).size===1?'READY':'OTHER_REQUIRED_INPUT_MISSING';}
  const onsetScopes=starts.map(row=>scopeKey(scope(row))),endScopes=ends.map(row=>scopeKey(scope(row)));
  return onsetScopes.every(Boolean)&&endScopes.every(Boolean)&&new Set(onsetScopes).size===1&&new Set(endScopes).size===1&&onsetScopes[0]===endScopes[0]?'READY':'OTHER_REQUIRED_INPUT_MISSING';
}
export const phase2ModelingReadiness=modelingReadiness;
