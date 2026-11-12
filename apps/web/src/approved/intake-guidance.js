import {h} from './shared.js';

export function intakeGuidance() {
 return `<div class="callout"><b>Same facility and same episode?</b> Open that incident and use Add Evidence. Add Incident is for a distinct episode; it does not validate the research.</div><details class="secondary-details"><summary>Before sharing a new incident</summary><ol><li>Identify the physical healthcare facility; a similar name alone is not a match.</li><li>Check the approved geographic and study population boundaries. Pending PHC eligibility decisions remain pending.</li><li>Find evidence of an episode affecting this facility. A nearby strike alone does not establish damage or disruption.</li><li>Check the study period. Keep uncertain dates unknown; do not infer an exact day.</li><li>Preserve traceable sources, passages, locators and limitations. Reuse recorded sources through Add Evidence.</li><li>Compare existing cases and explain why this is a distinct episode.</li></ol><p>These are research questions, not a score. There is no fixed number of facts or sources. Save privately when identity, eligibility or facility effects remain unresolved. Intake is separate from factual review and supervisor approval.</p></details>`;
}

// Compare the recorded header, current date finding, or explicit unreviewed proposal.
// Never infer an exact date from labels, source publication dates or approximate prose.
export function incidentComparisons(s) {
 return s.records.INCIDENT.map(i=>{
  const dates=s.records.CLAIM.filter(c=>c.incident_id===i.incident_id&&c.is_current!==false&&c.claim_family==='EVENT_DATE').map(c=>{
   const proposal=s.workflow?.claims?.[c.claim_id]?.proposal;
   const value=c.current_verified_value??proposal?.value;
   const precision=c.current_verified_value!=null?c.date_precision:proposal?.date_precision??c.date_precision;
   const start=typeof value==='string'?value:value?.start,end=typeof value==='string'?value:value?.end;
   return {start,end,precision,claim_id:c.claim_id,reviewed:s.workflow?.claims?.[c.claim_id]?.lab_review_state==='REVIEWED'&&!s.workflow?.claims?.[c.claim_id]?.review_needed};
  }).filter(d=>d.start&&['DAY','MONTH','RANGE'].includes(d.precision));
  if(i.event_start)dates.unshift({start:i.event_start,end:i.event_end||i.event_start,precision:'DAY',reviewed:false});
  return {...i,comparison_dates:dates,comparison_label:dates.map(d=>`${d.start}${d.end!==d.start?' – '+d.end:''} (${d.reviewed?'reviewed date finding':'recorded date; check evidence'})`).join('; ')||'Date not established'};
 });
}
export function comparisonOverlaps(i,date) {
 const start=date.precision==='RANGE'?date.value?.start:date.value,end=date.precision==='RANGE'?date.value?.end:date.value;
 if(!start||!end||!['DAY','MONTH','RANGE'].includes(date.precision))return false;
 const low=v=>v.length===7?v+'-01':v,high=v=>v.length===7?v+'-31':v;
 return (i.comparison_dates||[]).some(d=>low(d.start)<=high(end)&&high(d.end||d.start)>=low(start));
}
export function intakeDestination(id) {
 return `<aside class="callout" data-intake-destination><b>Incident saved for team review</b><p>Record this destination in the workbook: <a href="/cases/${encodeURIComponent(id)}">${h(id)}</a></p><p>Use Add Evidence on the relevant fact, or add a source-supported fact. New facts still need factual review; supervisor approval is separate.</p></aside>`;
}
