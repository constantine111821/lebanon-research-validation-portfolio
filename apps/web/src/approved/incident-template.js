import {h, claims, tasks, evidenceFor, reviewed, eligible, labReviewState, facilityName, locationReviewState, factLabel, valueText, FAMILIES} from './shared.js';

// Organization and prompts only: every action enters an existing workflow.
// These descriptors neither create facts/tasks nor add completeness requirements.
export const INCIDENT_RESEARCH_TEMPLATE = [
  {key:'fundamentals', title:'Incident and facility fundamentals', question:'Which physical facility and which distinct event does the evidence identify?', cards:[
    {key:'identity', title:'Facility identity and type', families:['IDENTITY','FACILITY_TYPE'], facility:true, question:'Confirm the physical facility, its type and known names. Similar names or operators do not establish the same site.'},
    {key:'location', title:'Physical location and coordinate review', families:[], location:true, question:'Inspect the geographic source and review status for each linked physical facility. A point entered by a researcher still needs geographic review.'},
    {key:'event', title:'Event occurrence and description', families:['KINETIC_EVENT','ATTACK_RELATIONSHIP'], question:'What specific event is reported, and how does it relate to the physical healthcare facility? Keep a vicinity event separate from a direct facility effect.'},
    {key:'date', title:'Event date or supported range', families:['EVENT_DATE'], question:'Which event date or range does the source support? Publication dates are not event dates; retain the supported precision.'},
    {key:'actor', title:'Reported actor or attribution', families:['ACTOR_ATTRIBUTION'], question:'What attribution does the source actually make, with what limitations or contrary evidence? Do not infer responsibility.'}
  ]},
  {key:'physical', title:'Physical impact', question:'Was the facility itself damaged, or was the reported effect nearby?', cards:[
    {key:'damage', title:'Facility damage or destruction', families:['PHYSICAL_DAMAGE'], question:'Not established by an empty record. Investigate the building or grounds, affected structures, severity and any reported destruction. Keep nearby infrastructure damage separate.'},
    {key:'relationship', title:'Vicinity effects, entry or occupation', families:['ATTACK_RELATIONSHIP'], question:'Does the evidence describe a direct hit, vicinity event, forceful entry or occupation? Use the supported relationship and preserve the exact proposition.'}
  ]},
  {key:'human', title:'Human effects and capacity context', question:'Which human effects are directly reported, and which quantities describe capacity?', cards:[
    {key:'human-effects', title:'Personnel, patients and civilians', families:['HUMAN_IMPACT_MEASURE'], question:'Record each source-supported human effect separately, including who, where and when. Unknown casualty counts remain unknown; baseline population and capacity are separate context.'},
    {key:'capacity', title:'Capacity and operating limitations', families:['REDUCED_CAPACITY','HUMAN_IMPACT_MEASURE'], question:'What capacity, service baseline or operating limitation is documented? Retain the quantitative unit and direct, contextual or proxy basis; capacity is not a casualty count.'}
  ]},
  {key:'services', title:'Effects on services', question:'Which healthcare services were interrupted, reduced, moved or continued?', cards:[
    {key:'service-effects', title:'Service delivery and operational restrictions', families:['DEPARTMENT_OR_SERVICE_SHUTDOWN','REDUCED_CAPACITY','EVACUATION'], question:'Identify the affected service, extent and time of interruption or reduction. Physical damage alone does not establish closure or reduced service.'},
    {key:'access', title:'Access, supplies and utilities', families:['ACCESS_DISRUPTION','UTILITY_LOSS'], question:'What access, supply or utility interruption is reported for this facility, and what service consequence is established? A damaged road alone does not establish closure.'},
    {key:'alternatives', title:'Relocation and alternative provision', families:['RELOCATION','PATIENT_TRANSFER'], question:'Was care relocated, or were patients transferred? Identify the original and alternative site and exact service; later care elsewhere does not establish original-site restoration.'},
    {key:'causation', title:'Event linked to a specific service effect', families:['ATTACK_TO_EFFECT_CAUSATION'], question:'Does evidence link the identified event to this particular effect? One established causal relationship does not establish every other effect.'}
  ]},
  {key:'recovery', title:'Recovery and timing', question:'When did each disruption begin, and what restoration is actually supported?', cards:[
    {key:'closure', title:'Closure and partial operation', families:['FULL_CLOSURE','PARTIAL_CLOSURE'], question:'Did the facility close fully, close partially or continue operating? No evidence of closure is different from evidence that services continued.'},
    {key:'onset', title:'Start of disruption', families:['EFFECT_ONSET'], question:'When did this specific disruption begin? Keep unknown or disputed dates unresolved.'},
    {key:'restoration', title:'Partial reopening and service restoration', families:['RESTORATION_STATUS','RESTORATION_DATE'], question:'Which services reopened, partially or fully, and when? Silence in later reporting is not evidence of restoration.'},
    {key:'duration', title:'Supported duration and open questions', families:['RESTORATION_DATE'], value_type:'QUANTITATIVE', question:'Is a duration directly reported, or can matching reviewed dates establish elapsed time? Record units and scope. Do not manufacture an endpoint.'}
  ]},
  {key:'evidence', title:'Evidence and attribution', question:'Which sources support, challenge or limit each individual proposition?', cards:[
    {key:'provenance', title:'Exact source relationships and limitations', families:[], evidence:true, question:'Attach the relevant passage and locator to the exact proposition. Preserve supporting, contradicting, limiting and context-only relationships, source dependency, contradictions and outstanding questions.'}
  ]}
];

export function linkedFacilities(s,id){
  const ids=new Set((s.records.INCIDENT_FACILITY||[]).filter(l=>l.incident_id===id&&l.is_current!==false).map(l=>l.facility_id));
  return (s.records.FACILITY||[]).filter(f=>ids.has(f.facility_id));
}
export function templateClaims(s,id,card){
  if(card.evidence)return claims(s,id);
  const ids=new Set(linkedFacilities(s,id).map(f=>f.facility_id));
  const list=card.facility?(s.records.CLAIM||[]).filter(c=>ids.has(c.facility_id)&&c.is_current!==false&&c.identity_purpose!=='facility_comparison'):claims(s,id);
  return list.filter(c=>card.families.includes(c.claim_family)&&(!card.value_type||c.value_type===card.value_type));
}
export function templateFindingState(s,c){
  const pairs=evidenceFor(s,c.claim_id),w=s.workflow?.claims?.[c.claim_id]||{};
  if(c.validation_state==='CONFLICTING')return 'Conflicting evidence';
  if(labReviewState(c,s)==='REOPENED')return 'Review reopened — unresolved';
  if(c.validation_state==='NOT_APPLICABLE')return reviewed(c,s)?'Not applicable — human reviewed':'Proposed not applicable — needs review';
  if(reviewed(c,s)&&eligible(c,s))return 'Human-validated finding';
  if(reviewed(c,s))return c.validation_state==='NOT_SUPPORTED'?'Human reviewed — proposition not supported':'Researched but unresolved';
  if(pairs.some(p=>p.relation.support_direction==='CONTRADICTS'))return 'Challenging evidence — needs review';
  if((c.validation_state==='SUPPORTED'||w.proposal)&&pairs.some(p=>p.relation.support_direction==='SUPPORTS'))return 'Supported proposed finding — needs human review';
  if(pairs.length||c.validation_state==='NEEDS_MORE_EVIDENCE')return 'Researched but unresolved';
  return 'Not yet researched — no linked evidence';
}
const action=(name,text,attrs='')=>`<button type="button" data-action="${name}" ${attrs}>${h(text)}</button>`;
function finding(s,c){
  const pairs=evidenceFor(s,c.claim_id),sources=new Set(pairs.map(p=>p.source.source_id)),facility=(s.records.FACILITY||[]).find(f=>f.facility_id===c.facility_id);
  return `<li class="template-finding" data-template-claim="${h(c.claim_id)}"><p><b>${h(factLabel(c))}</b> · <span data-template-state>${h(templateFindingState(s,c))}</span></p>${facility?`<p class="subtle">Physical facility: ${h(facilityName(facility))}</p>`:''}<p>${h(c.subject)}</p><p class="subtle">Recorded value: ${h(valueText(c))} · ${sources.size} linked sources. Review status is separate from the recorded value.</p><div class="inline">${action('evidence','Add Evidence',`data-claim="${h(c.claim_id)}"`)}${action('review','Review finding',`data-claim="${h(c.claim_id)}"`)}</div>${pairs.length?`<details><summary>Sources for this proposition (${pairs.length} relationships)</summary><ul>${pairs.map(p=>`<li>${h(({SUPPORTS:'Supports',CONTRADICTS:'Contradicts',LIMITS:'Limits',CONTEXT_ONLY:'Context only'})[p.relation.support_direction]||'Relationship not assessed')} · ${action('source',p.source.title||'Inspect source',`data-id="${h(p.source.source_id)}" data-claim="${h(c.claim_id)}" data-relation="${h(p.relation.claim_source_id)}"`)}</li>`).join('')}</ul></details>`:''}</li>`;
}
function renderCard(s,id,card){
  const cs=templateClaims(s,id,card),linkedTasks=tasks(s,id).filter(t=>cs.some(c=>c.claim_id===t.claim_id));
  let content='';
  if(card.location)content=linkedFacilities(s,id).map(f=>`<p><b>${h(facilityName(f))}</b> · Geographic review: ${h(locationReviewState(s,f.facility_id).replaceAll('_',' ').toLowerCase())}</p>${action('facility','Review facility and coordinates',`data-id="${h(f.facility_id)}"`)}`).join('')||'<p>Not yet established. Confirm the physical facility through Add Incident.</p>';
  else if(card.evidence)content=`<p>${cs.length} incident propositions · ${cs.reduce((n,c)=>n+evidenceFor(s,c.claim_id).length,0)} exact source relationships. Source count does not establish independence.</p><div class="inline">${action('add-evidence','Add Evidence for existing facts')}${action('task','Record an outstanding research question')}</div><a href="#case-evidence">Read saved evidence</a> · <a href="#facts-section">Inspect every fact and source relationship</a>`;
  else content=cs.length?`<ul class="template-findings">${cs.map(c=>finding(s,c)).join('')}</ul>`:`<p class="template-missing" data-template-state>Not yet researched in this section. No finding is recorded; this is not a factual No or a not-applicable decision.</p>`;
  const recordActions=card.facility?`<div class="inline">${linkedFacilities(s,id).map(f=>action('facility','Review identity and type: '+facilityName(f),`data-id="${h(f.facility_id)}"`)).join('')}</div>`:card.location||card.evidence?'':`<details class="template-record-actions"><summary>${cs.length?'Record a different source-supported finding':'Record a source-supported finding'}</summary><p class="subtle">Use an existing proposition when the source addresses it. A new finding starts as a proposal and needs factual review. A justified not-applicable decision uses that same review workflow.</p><div class="inline">${card.families.map(f=>action('new-fact',`Record finding: ${FAMILIES[f]}`,`data-family="${h(f)}" ${card.value_type?`data-value-type="${h(card.value_type)}"`:''} data-incident="${h(id)}"`)).join('')}</div></details>`;
  return `<article class="template-prompt" data-template-prompt="${card.key}"><h4>${h(card.title)}</h4><p>${h(card.question)}</p>${content}${recordActions}${linkedTasks.length?`<div class="inline template-task-links">${linkedTasks.map(t=>action('task','Research task: '+t.factual_question,`data-id="${h(t.gap_task_id)}"`)).join('')}</div>`:''}</article>`;
}
export function renderIncidentTemplate(s,id){
  return `<section class="panel section incident-template" id="incident-research-template"><h2>Incident research framework</h2><p>Open a section to inspect recorded findings or a useful next question. These prompts create no facts or tasks and are not a completion checklist.</p><p class="subtle">A context-only or unresolved record does not establish a qualifying attack. The six minimum incident-eligibility checks remain separate from the eight documentation domains; not every domain must be completed.</p>${INCIDENT_RESEARCH_TEMPLATE.map(group=>`<details class="template-section" data-template-section="${group.key}"><summary><strong>${h(group.title)}</strong><span>${h(group.question)}</span></summary><div class="template-prompts">${group.cards.map(card=>renderCard(s,id,card)).join('')}</div></details>`).join('')}<p class="subtle">Existing case-specific tasks, deferrals, waivers and review histories remain below. Record a research question only when relevant.</p></section>`;
}
