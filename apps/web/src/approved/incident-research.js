import {h, claims, tasks, taskBucket, evidenceFor, FAMILIES, facilityName, locationReviewState} from './shared.js';
import {linkedFacilities} from './incident-template.js';
import {incidentHelp} from './guidance.js';

// Presentation catalogue only. One home per canonical family; no completeness,
// eligibility, task, evidence or review state is written by this projection.
export const FACT_CATEGORIES = [
  {key:'recovery',title:'Recovery and Restoration Timing',families:['EFFECT_ONSET','RESTORATION_STATUS','RESTORATION_DATE']},
  {key:'facility',title:'Facility identity, type and location',families:['IDENTITY','FACILITY_TYPE']},
  {key:'chronology',title:'Event occurrence and chronology',families:['KINETIC_EVENT','EVENT_DATE']},
  {key:'description',title:'Incident description and classification',families:[]},
  {key:'relationship',title:'Attack relationship and attribution',families:['ATTACK_RELATIONSHIP','ACTOR_ATTRIBUTION']},
  {key:'physical',title:'Physical impact',families:['PHYSICAL_DAMAGE']},
  {key:'human',title:'Human effects and capacity context',families:['HUMAN_IMPACT_MEASURE']},
  {key:'services',title:'Effects on healthcare services',families:['FULL_CLOSURE','PARTIAL_CLOSURE','DEPARTMENT_OR_SERVICE_SHUTDOWN','REDUCED_CAPACITY','EVACUATION','PATIENT_TRANSFER','UTILITY_LOSS','ACCESS_DISRUPTION','RELOCATION','ATTACK_TO_EFFECT_CAUSATION']},
  {key:'evidence',title:'Evidence limitations and corroboration',families:[]},
];
const questions={
 IDENTITY:'Which physical healthcare facility is identified? Check known names and the exact site; similar names alone do not establish a match.',
 FACILITY_TYPE:'What type of healthcare facility does the evidence describe? Keep the operator separate from the facility identity.',
 KINETIC_EVENT:'What specific event is reported at or near this facility? Establish its relationship to the site before calling it an attack on the facility.',
 EVENT_DATE:'When did this event occur? Record the supported date or range; a publication date is not an event date.',
 ATTACK_RELATIONSHIP:'Was the facility directly affected, or does the report concern a nearby strike, entry or occupation?',
 ACTOR_ATTRIBUTION:'What attribution does the source actually make? Preserve any uncertainty or contrary evidence.',
 PHYSICAL_DAMAGE:'Was the building or grounds damaged or destroyed? Distinguish facility damage from nearby infrastructure damage.',
 HUMAN_IMPACT_MEASURE:'What effects on personnel, patients or civilians are reported? Keep casualty measures separate from population and capacity context.',
 FULL_CLOSURE:'Did all healthcare services stop? Damage or a reported attack alone does not establish full closure.',
 PARTIAL_CLOSURE:'Did part of the facility close while other services continued?',
 DEPARTMENT_OR_SERVICE_SHUTDOWN:'Which particular department or service stopped operating, and when?',
 REDUCED_CAPACITY:'What reduction or operating baseline is documented? Preserve the unit, time and service scope.',
 EVACUATION:'Who was evacuated, when, and from which physical site?',
 PATIENT_TRANSFER:'Were patients transferred? Identify the original and receiving sites where supported.',
 UTILITY_LOSS:'Did power or another utility fail at the facility? What healthcare consequence is actually reported?',
 ACCESS_DISRUPTION:'Was access to the facility or its supplies interrupted? A damaged road alone does not establish service closure.',
 RELOCATION:'Was care moved to another site? Continued care elsewhere does not establish restoration at the original facility.',
 ATTACK_TO_EFFECT_CAUSATION:'Does the evidence connect this event to a particular healthcare effect? Do not infer a causal link from timing alone.',
 EFFECT_ONSET:'When did this specific service disruption begin? Retain unknown or disputed dates.',
 RESTORATION_STATUS:'Did particular services resume, partially or fully? Silence in later reporting is not evidence of restoration.',
 RESTORATION_DATE:'When did the documented service resume? Record its supported date precision and scope.',
};
// These terms rank display relevance only. They never establish a relationship
// or become a scientific conclusion. Canonical task text remains unchanged.
const terms={IDENTITY:/identity|physical site|which facility/i,FACILITY_TYPE:/facility type|clinic|hospital type/i,KINETIC_EVENT:/occurrence|attack occurred|event occurred/i,EVENT_DATE:/chronolog|event date|attack date/i,ATTACK_RELATIONSHIP:/direct hit|vicinity|facility relationship|nearby strike/i,PHYSICAL_DAMAGE:/damage|destruction/i,FULL_CLOSURE:/full closure|fully closed/i,PARTIAL_CLOSURE:/partial closure/i,DEPARTMENT_OR_SERVICE_SHUTDOWN:/department|service shutdown/i,REDUCED_CAPACITY:/capacity|reduction/i,EVACUATION:/evacuat/i,PATIENT_TRANSFER:/patient transfer/i,UTILITY_LOSS:/power|electric|utility/i,ACCESS_DISRUPTION:/access|suppl/i,RELOCATION:/relocat/i,ATTACK_TO_EFFECT_CAUSATION:/causal|causation/i,EFFECT_ONSET:/onset|disruption began/i,RESTORATION_STATUS:/reopen|restor|resum/i,RESTORATION_DATE:/restoration date|reopening date/i,HUMAN_IMPACT_MEASURE:/casualt|patient|personnel|injur/i,ACTOR_ATTRIBUTION:/perpetrator|attribution/i};
export function incidentResearch(s,id){
 const facilities=linkedFacilities(s,id),fids=new Set(facilities.map(f=>f.facility_id));
 const shared=s.records.CLAIM.filter(c=>fids.has(c.facility_id)&&['IDENTITY','FACILITY_TYPE'].includes(c.claim_family)&&c.is_current!==false&&c.identity_purpose!=='facility_comparison');
 const all=[...new Map([...claims(s,id),...shared].map(c=>[c.claim_id,c])).values()];
 const gs=tasks(s,id),open=gs.filter(t=>['active','not_assessed','blocked'].includes(taskBucket(t)));
 const groups=FACT_CATEGORIES.map(group=>{
  const findings=all.filter(c=>group.families.includes(c.claim_family));
  const missing=group.families.filter(f=>!findings.some(c=>c.claim_family===f&&(f!=='RESTORATION_DATE'||c.value_type==='DATE'))).map((family,index)=>{
   const related=open.filter(t=>!t.claim_id&&terms[family]?.test(t.factual_question||''));
   return {key:family,family,title:FAMILIES[family],question:questions[family],related_tasks:related,priority:related.length?0:['IDENTITY','FACILITY_TYPE','KINETIC_EVENT','EVENT_DATE','ATTACK_RELATIONSHIP','PHYSICAL_DAMAGE','FULL_CLOSURE','DEPARTMENT_OR_SERVICE_SHUTDOWN','EFFECT_ONSET','RESTORATION_STATUS'].includes(family)?1:2,index};
  }).sort((a,b)=>a.priority-b.priority||a.index-b.index);
  if(group.key==='recovery'&&!findings.some(c=>c.claim_family==='RESTORATION_DATE'&&c.value_type==='QUANTITATIVE'))missing.push({key:'SOURCE_REPORTED_DURATION',family:'RESTORATION_DATE',value_type:'QUANTITATIVE',title:'Directly reported service duration',question:'Does a source directly report how long a specific service was disrupted? Preserve its units, scope and limitations; do not invent an endpoint.',related_tasks:[],priority:2,index:group.families.length});
  return {...group,findings,missing,facilities};
 });
 // Surface the case wording's open factual questions here without duplicating
 // the prompts or moving any recorded finding from its canonical category.
 const description=groups.find(g=>g.key==='description');
 const incident=s.records.INCIDENT.find(i=>i.incident_id===id);
 const workingType=s.workflow?.incidents?.[id]?.working_type||incident?.incident_type;
 const attackContext=['kinetic episode','combined supported causal episode'].includes(workingType);
 for(const group of groups.filter(g=>g.key==='chronology'||g.key==='relationship')){
  const relevant=group.missing.filter(p=>['KINETIC_EVENT','ATTACK_RELATIONSHIP'].includes(p.family)&&
   (attackContext||p.related_tasks.length>0));
  description.missing.push(...relevant);
  group.missing=group.missing.filter(p=>!relevant.includes(p));
 }
 // Forward-compatible display safety: a later supported family must never vanish.
 const mapped=new Set(FACT_CATEGORIES.flatMap(g=>g.families));
 const other=all.filter(c=>!mapped.has(c.claim_family));
 if(other.length)description.findings.push(...other);
 return {groups,all,tasks:gs};
}
const button=(action,text,attrs='')=>`<button type="button" data-action="${action}" ${attrs}>${h(text)}</button>`;
function prompt(s,id,p,facilities){
 const facility=['IDENTITY','FACILITY_TYPE'].includes(p.family);
 const action=facility?facilities.map(f=>button('facility','Review '+facilityName(f),`data-id="${h(f.facility_id)}"`)).join(''):button('new-fact','Record a finding',`data-family="${h(p.family)}" data-incident="${h(id)}" ${p.family==='RESTORATION_DATE'?`data-value-type="${h(p.value_type||'DATE')}"`:''}`);
 return `<article class="unfilled-research-card" data-research-prompt="${h(p.key)}" data-canonical-fact="false"><p class="unfilled-label">Research opportunity · no finding recorded</p><h4>${h(p.title)}</h4><p>${h(p.question)}</p>${p.related_tasks.length?`<p class="subtle">A saved research question mentions this topic. Check its relevance; no evidence relationship is implied.</p><div class="inline">${p.related_tasks.map(t=>`<a href="#task-${h(t.gap_task_id)}">See related research task</a>`).join('')}</div>`:''}<div class="inline">${action||'<p>Confirm the physical facility through Add Incident first.</p>'}</div></article>`;
}
export function renderResearchFacts(s,id,renderFact){
 const {groups,all}=incidentResearch(s,id),i=s.records.INCIDENT.find(i=>i.incident_id===id),pairs=all.flatMap(c=>evidenceFor(s,c.claim_id));
 return `<section class="section consolidated-facts" id="facts-section" aria-labelledby="facts-heading" data-research-layout="consolidated"><div class="section-title"><div><div class="inline incident-help-heading"><h2 id="facts-heading">Facts and evidence</h2>${incidentHelp('facts','Facts and evidence','<p>Compare the recorded finding with its saved source and passage. Check whether the evidence supports, challenges, qualifies, or gives background for that exact finding. Use Add fact to record a new finding when you have relevant evidence.</p>')}</div><p>Open a fact category, read the evidence, then select <b>Review fact</b>.</p></div>${button('new-fact','+ Add fact')}</div>${groups.map(group=>{
  let context='';
  if(group.key==='facility')context=`<p class="subtle">Shared facility findings do not establish an attack or service effect in this episode.</p>${group.facilities.map(f=>`<p>${h(facilityName(f))} · Geographic review: ${h(locationReviewState(s,f.facility_id).replaceAll('_',' ').toLowerCase())}. <a href="#coordinates-${h(f.facility_id)}">Inspect coordinates and evidence</a></p>`).join('')}`;
  if(group.key==='description')context=`<p><b>Current Case Description:</b> ${h(i?.incident_label||'Not recorded')}</p><p><b>Working Incident Classification:</b> ${h(s.workflow?.incidents?.[id]?.working_type||i?.incident_type||'Unresolved')}</p><p class="subtle">The saved description and working classification are case metadata. Use Add fact to propose a specific finding, choose its type and attach relevant evidence. Leave an uncertain value Unknown. A factual review does not update the case wording. If evidence challenges that wording, request a wording review.</p><div class="inline">${button('new-fact','+ Add fact',`class="primary" data-incident="${h(id)}"`)}${button('note','Add context or a limitation')}${button('task','Request case wording review','data-metadata-review="true"')}</div>`;
  if(group.key==='evidence')context=`<p>${new Set(pairs.map(p=>p.source.source_id)).size} linked sources · ${pairs.length} fact-source relationships. Linked sources are not necessarily independent.</p><p>${pairs.filter(p=>p.relation.support_direction==='CONTRADICTS').length} challenging and ${pairs.filter(p=>p.relation.support_direction==='LIMITS').length} qualifying relationships. Read the passages and limitations on each fact card.</p><p class="subtle">Keep Supports this finding, Challenges this finding, Qualifies this finding and Provides background tied to the exact proposition. A source for a research question is not automatically proof of a fact.</p><div class="inline">${button('add-evidence','Add evidence for existing facts')}${button('task','Record a research question')}</div>`;
  const visible=group.missing.slice(0,2),more=group.missing.slice(2);
  return `<details class="research-category" data-research-category="${group.key}" data-disclosure-key="category-${group.key}"><summary><h3 id="category-${group.key}">${h(group.title)}</h3><span class="disclosure-count">${group.findings.length} recorded ${group.findings.length===1?'finding':'findings'}${group.missing.length?` · ${group.missing.length} research ${group.missing.length===1?'opportunity':'opportunities'}`:''}</span></summary><div class="category-content">${context}<div class="fact-list">${group.findings.map(c=>renderFact(s,c).replace('<article ',`<article id="fact-${h(c.claim_id)}" `)).join('')}</div>${visible.length?`<div class="unfilled-fields">${visible.map(p=>prompt(s,id,p,group.facilities)).join('')}</div>`:''}${more.length?`<details class="more-research-fields" data-more-fields="${group.key}" data-disclosure-key="more-${group.key}"><summary>Show more research fields <span>(${more.length})</span></summary><div class="unfilled-fields">${more.map(p=>prompt(s,id,p,group.facilities)).join('')}</div></details>`:''}</div></details>`;
 }).join('')}</section>`;
}
