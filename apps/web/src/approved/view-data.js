import {
  h, fmt, label, claims, facilityFor, facilityName, facilityType, identityState,
  tasks, taskBucket, reviewStatus, origin, reviewed, eligible, recordType, labReviewState, priorHumanReviewed,
  preflight, downstream, evidenceFor, factLabel, valueText as sharedValueText, requiredIds, isCurrentFacilityResolution, facilityResolutionReopening
} from './shared.js';
import {timingProjection, timingReviewState, timingValueText} from './timing.js';
import {timingIntervals} from './timing-interval.js';
import {renderEvidenceCard, renderEvidenceDetails, renderFactEvidence, renderApprovalHistory} from './evidence-presentation.js';

// Read-only HTML presentation. Every finding comes from the supplied snapshot.
// Mutating actions are handled by the application's review/submit controller.
const rows = (s, entity) => s.records?.[entity] || [];
const findIncident = (s, id) => rows(s, 'INCIDENT').find(i => i.incident_id === id);
const findClaim = (s, id) => rows(s, 'CLAIM').find(c => c.claim_id === id);
const str = value => {
  if (value == null || value === '') return 'Not established';
  if (typeof value !== 'object') return fmt(value);
  if (Array.isArray(value)) return value.length ? value.map(str).join(' · ') : 'None recorded';
  if ('start' in value || 'end' in value || 'value' in value) return fmt(value);
  return Object.entries(value).map(([key, v]) => `${label(key)}: ${str(v)}`).join(' · ') || 'Not established';
};
const rawValueText = c => typeof c.current_verified_value === 'object' && c.current_verified_value !== null && !('start' in c.current_verified_value) && !('value' in c.current_verified_value)
  ? `${str(c.current_verified_value)}${c.date_precision ? ' · ' + label(c.date_precision) : ''}${c.quantitative_unit ? ' ' + c.quantitative_unit : ''}${c.impact_basis ? ' · ' + c.impact_basis : ''}` : sharedValueText(c);
const valueText=c=>{if(c?.claim_family==='RESTORATION_STATUS'&&c.current_verified_value==='not_found')return timingValueText(c);if(c?.value_type==='CATEGORICAL'&&typeof c.current_verified_value==='string'){const text=({EXACT_TARGET:'Exact target',NEARBY_CONTEXT:'Nearby / context',UNRESOLVED:'Unresolved',REJECTED:'Relationship rejected by evidence',hospital:'Hospital',primary_health_care_center:'Primary health care center',primary_health_care_center_medical_clinic:'Primary health care center / medical clinic',not_found:'Not found in preserved evidence',building_supervision_not_documented_clinical_services:'Building supervision; clinical services not documented'})[c.current_verified_value]||c.current_verified_value.replaceAll('_',' ');return text;}return rawValueText(c);};
const statusText = value => typeof value === 'object' && value !== null ? value.label || value.status || value.code || 'Not yet assessed' : value;
const revision = (s, id) => s.revisions?.INCIDENT?.[id] ?? 0;
const workflow = (s, id) => s.workflow?.incidents?.[id] || {};
const groupOf = type => type?.group || (['kinetic episode', 'combined supported causal episode'].includes(type?.canonical || type) ? 'attack' : (type?.canonical || type) === 'operational episode' ? 'context' : 'unresolved');
const typeText = type => type?.label || ({'kinetic episode': 'Strike event', 'combined supported causal episode': 'Attack / effect record', 'operational episode': 'Operational-status episode', 'unresolved cluster': 'Unresolved while research continues'}[type?.canonical || type]) || 'Record type under review';
const stateClass = state => /conflict|reopen|review needed/i.test(state || '') ? 'conflicting' : /not supported|unknown|more evidence|not reviewed|needs lab validation|progress|unassessed|not yet/i.test(state || '') ? 'unknown' : /supported|complete|reviewed/i.test(state || '') ? 'supported' : 'historical';
const badge = (text, state = '') => `<span class="pill ${h(state || stateClass(text))}">${h(str(text))}</span>`;
const action = (name, text, attrs = '', primary = false) => `<button${primary ? ' class="primary"' : ''} data-action="${h(name)}" ${attrs}>${h(text)}</button>`;
const empty = text => `<p class="empty">${h(text)}</p>`;
const technical = (text, title = 'Technical details') => `<details class="secondary-details"><summary>${h(title)}</summary><div class="secondary-content">${text}</div></details>`;
const detail = (name, value, wide = false) => `<div${wide ? ' class="wide"' : ''}><span>${h(name)}</span><b>${h(str(value))}</b></div>`;
const bullet = values => values.length ? `<ul>${values.map(v => `<li>${h(str(v))}</li>`).join('')}</ul>` : empty('None recorded.');
const recordStatus = (s, id) => statusText(reviewStatus(s, id)) || 'Completion status not yet assessed';
const recordComplete = (s, id) => /complete/i.test(recordStatus(s, id)) && !/incomplete|not complete|not yet/i.test(recordStatus(s, id));
const taskGroup = g => { const x = taskBucket(g); return typeof x === 'string' ? x : x?.bucket || x?.code || x?.label || 'not_assessed'; };
const isActive = g => /active|blocking|blocked|in.progress|open/i.test(taskGroup(g)) && !/deferred|resolved|disposition/i.test(taskGroup(g));
const taskLabel = g => taskGroup(g) === 'not_assessed' ? 'Not yet assessed by the lab' : taskGroup(g) === 'blocked' ? 'Blocked' : /deferred/i.test(taskGroup(g)) ? 'Deferred' : /unable|disposition/i.test(taskGroup(g)) ? 'Unable to resolve / dispositioned' : /resolved/i.test(taskGroup(g)) ? 'Resolved' : 'Active / needs checking';
export const currentLabLabel = (s, c) => timingReviewState(s, c);
export const supportedReviewAttribute = (s, c) => reviewed(c, s) && eligible(c, s) ? ' data-current-supported-review="true"' : '';
export function presentationRecordType(s, id) {
  const type = recordType(s, id);
  return type.canonical === 'combined supported causal episode' ? {...type, label: 'Attack / effect record'} : type;
}
export function preservedRecordType(s, id) {
  const type = recordType(s, id);
  return `<details class="secondary-details preserved-record-type" data-preserved-record-type="${h(type.canonical || '')}"><summary>Preserved research record type</summary><div class="secondary-content"><p><b>${h(label(type.canonical || 'Not recorded'))}</b></p><p class="subtle">This describes the preserved research record. Current lab validation is determined from the fact-level review states shown above.</p></div></details>`;
}
export function causalFindingState(s, c) {
  const current = reviewed(c, s), supported = Boolean(current && eligible(c, s) && c.current_verified_value === true);
  return {claim_id: c.claim_id, supported, lab_review_state: labReviewState(c, s), review_label: currentLabLabel(s, c), value_text: !current ? 'Not established by current lab' : c.validation_state === 'CONFLICTING' ? 'Conflicting' : ['SUPPORTED', 'NOT_SUPPORTED', 'NOT_APPLICABLE'].includes(c.validation_state) ? valueText(c) : 'Not established', prior_value_text: valueText(c)};
}
export function currentLabCausation(s, id) {
  const facts = claims(s, id).filter(c => c.claim_family === 'ATTACK_TO_EFFECT_CAUSATION');
  return `<div data-current-lab-causation>${facts.map(c => {const state = causalFindingState(s, c);return `<div data-causal-claim="${h(c.claim_id)}" data-current-lab-causation-supported="${state.supported}"><p><b>${h(state.value_text)}</b></p>${badge(state.review_label, state.supported ? 'supported' : state.lab_review_state === 'REOPENED' ? 'conflicting' : 'unknown')}<small style="display:block">${h(c.subject)}</small>${state.lab_review_state !== 'REVIEWED' ? `<small style="display:block">Prior research finding: ${h(state.prior_value_text)} · ${h(label(c.validation_state))}</small>` : `<small style="display:block">${h(label(c.validation_state))}</small>`}</div>`;}).join('') || '<p>Not established — no current causal fact recorded.</p>'}</div>`;
}

export function preservedResearchClaim(s, c) {
  const historical = rows(s, 'ACTIVITY_LOG')
    .filter(a => a.entity_type === 'CLAIM' && a.entity_id === c.claim_id)
    .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')))
    .map(a => a.before_ref || a.old_value)
    .find(v => v?.claim_id === c.claim_id && String(v.validation_origin).startsWith('LEGACY_'));
  return historical || (String(c.validation_origin).startsWith('LEGACY_') ? c : null);
}
export function priorResearchDetails(s, c) {
  const lab = s.workflow?.claims?.[c.claim_id] || {}, preserved = preservedResearchClaim(s, c), recorded = preserved || c;
  const humanEntry = !preserved && c.ai_original_value == null && !c.ai_original_provenance;
  const reviewerName = id => s.team?.find(p => p.user_id === id)?.display_name || id || 'Reviewer not recorded';
  return `${humanEntry ? '<p><b>Research entry:</b> Added by a human researcher; no AI-original value is recorded.</p>' : `<p><b>Original research value:</b> ${h(str(c.ai_original_value))}</p>`}${preserved ? `<p><b>Prior / preserved research finding:</b> ${h(valueText(preserved))} · ${h(label(preserved.validation_state))}</p>` : humanEntry ? '<p class="subtle">The initial entry and subsequent changes remain in the activity history. Entry alone does not establish the fact.</p>' : '<p class="subtle">A preserved historical claim snapshot is not available in this view. Inspect the activity history and authority references for earlier research.</p>'}<p><b>${preserved ? 'Historical human-review provenance' : 'Current record provenance'}:</b> ${priorHumanReviewed(recorded) ? 'Individual human adjudication recorded' : 'No individual human adjudication recorded'} · ${h(reviewerName(recorded.reviewer))} · ${h(recorded.reviewed_at || 'Review time not recorded')}</p><p><b>Research origin:</b> ${h(str(recorded.validation_origin))}</p><p><b>Value authority:</b> ${h(str(recorded.current_value_authority))}</p><p>${h(recorded.review_notes || 'No review note recorded.')}</p><p class="subtle">Historical adjudication remains part of the evidence chain. It does not satisfy current-lab validation.</p>${lab.lab_reviewed_by || lab.lab_reviewed_at ? `<p><b>Current lab review record:</b> ${h(reviewerName(lab.lab_reviewed_by))} · ${h(lab.lab_reviewed_at || 'Time not recorded')} · reviewed fact revision ${h(lab.lab_reviewed_claim_revision ?? 'Not recorded')}</p>` : ''}<p class="subtle">Fact ${h(c.claim_id)} · current revision ${h(s.revisions?.CLAIM?.[c.claim_id] ?? 'Not recorded')}. Prior changes remain in the activity history.</p>${renderApprovalHistory(s,c)}`;
}

const causeTarget = c => c.effect_claim_id || c.causal_effect_claim_id || c.causation_scope?.effect_claim_id || c.current_value_authority?.effect_claim_id || null;
const directImpact = c => /^(directly reported|directly_reported)$/i.test(c.impact_basis || '');
export function facilityIdentityHistory(s, fid) {
  const decisions = (s.workflow?.facility_resolutions || []).filter(r => r.facility_id === fid || r.target_facility_id === fid);
  if (!decisions.length) return '';
  const person = id => s.team?.find(p => p.user_id === id)?.display_name || id || 'Reviewer not recorded';
  const name = id => facilityName(rows(s, 'FACILITY').find(f => f.facility_id === id)) || id || 'Comparison facility not recorded';
  const events = [];
  for (const r of decisions) {
    events.push({at: r.reviewed_at, actor: r.reviewer, title: ({same: 'Same physical facility', different: 'Different physical facility', unsure: 'Not sure yet — identity needs review'})[r.outcome] || 'Identity decision recorded', reason: r.review_note || r.basis, resolution: r});
    const reopening = r.reopening || facilityResolutionReopening(s, r.id);
    if (reopening) events.push({at: reopening.reopened_at, actor: reopening.reopened_by, title: 'Supervisor reopened the facility identity decision', reason: reopening.reason, resolution: r, reopened: true});
  }
  events.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  const current = decisions.filter(r => r.outcome === 'same' && isCurrentFacilityResolution(s, r));
  return `<section class="section" data-facility-identity-history="${h(fid)}">${s.profile?.role === 'supervisor' && current.length ? `<div class="callout"><b>Current same-facility decision</b>${current.map(r => `<p>${h(name(r.facility_id))} → ${h(name(r.target_facility_id))}</p><button type="button" data-action="reopen-facility-identity" data-facility="${h(r.facility_id)}" data-resolution="${h(r.id)}">Reopen Facility Identity Decision</button>`).join('')}<p class="subtle">Reopening returns identity to review. It does not declare the facilities different.</p></div>` : ''}<details class="secondary-details"><summary>Facility identity decision history (${events.length})</summary><div class="secondary-content">${events.map(e => `<article class="activity-row" data-identity-resolution="${h(e.resolution.id)}"${e.reopened ? ' data-identity-reopening="true"' : ''}><div><b>${h(e.title)}</b><time>${h(e.at || 'Time not recorded')}</time></div><p>${h(person(e.actor))} · ${h(name(e.resolution.facility_id))} / ${h(name(e.resolution.target_facility_id))}</p><p>${h(e.reason || 'Reason not recorded')}</p>${e.reopened ? '<p class="subtle">Prior decision, aliases, and earlier incident associations remain preserved. Identity needs a new evidence-backed review.</p>' : ''}</article>`).join('')}</div></details></section>`;
}

export function workflowStrip(current = 1) {
  const stages = ['Open your case', 'Check the facility', 'Review facts and sources', 'Fix or add information', 'Review and submit'];
  return `<nav class="research-steps" aria-label="Research workflow">${stages.map((text, i) => `<div class="research-step${current === i + 1 ? ' current' : ''}"${current === i + 1 ? ' aria-current="step"' : ''}><span>${i + 1}</span><b>${h(text)}</b></div>`).join('')}</nav>`;
}

function locationText(f) {
  if(f?.location_review&&Object.hasOwn(f.location_review,'locality'))return f.location_review.locality||'Location not established in current review';
  const place = f?.locality_governorate;
  if (typeof place === 'string') return place || 'Location not yet established';
  const values = [place?.locality, place?.adm3_name, place?.adm2_name, place?.adm1_name, f?.locality].filter(Boolean);
  return [...new Set(values)].join(' · ') || 'Location not yet established';
}

export function facilityBanner(s, id) {
  const f = rows(s, 'FACILITY').find(x => x.facility_id === id) || facilityFor(s, id);
  if (!f) return `<aside class="facility-banner"><b>Facility not yet selected</b><p>Choose the physical facility before reviewing the incident.</p></aside>`;
  const name = facilityName(f), type = statusText(facilityType(s, f.facility_id)) || 'Type not yet established';
  const identity = statusText(identityState(s, f.facility_id));
  const aliases = (f.aliases || []).map(a => typeof a === 'string' ? a : a.value).filter(a => a && a !== name);
  return `<aside class="facility-banner" data-facility-context="${h(f.facility_id)}" aria-label="Current facility"><div><span class="eyebrow">Facility you are reviewing</span><h2>${h(name)}</h2><p><b>${h(type)}</b><span class="context-dot">·</span>${h(locationText(f))}</p></div><div class="facility-banner-actions">${badge(identity || 'Identity under review')}${action('facility', 'View facility / aliases', `data-id="${h(f.facility_id)}"`)}</div>${aliases.length ? `<details class="facility-aliases"><summary>Known alternate names (${aliases.length})</summary><p>${aliases.map(h).join(' · ')}</p></details>` : ''}</aside>`;
}

function eventDate(s, id, { compact = false } = {}) {
  const i = findIncident(s, id), c = claims(s, id).find(c => c.claim_family === 'EVENT_DATE');
  if (c) {
    const episodeDiffers = i?.date_precision && i.date_precision !== 'UNKNOWN' &&
      (i.date_precision !== c.date_precision || i.event_start == null || (i.event_end && i.event_end !== i.event_start));
    if (episodeDiffers) {
      const bounds = `${i.event_start || 'Start unknown'}${i.event_end ? ' – ' + i.event_end : ' – end unknown'}`;
      if (compact) return `${valueText(c)} · Episode dates: ${bounds}`;
      return `${valueText(c)} — ${c.subject || 'Recorded date finding'}. Recorded episode bounds: ${bounds} · ${label(i.date_precision)}.`;
    }
    return valueText(c);
  }
  if (i?.date_precision === 'UNKNOWN' || !i?.event_start) return 'Date not established';
  return `${i.event_start}${i.event_end && i.event_end !== i.event_start ? ' – ' + i.event_end : ''} · ${label(i.date_precision || 'UNKNOWN')}`;
}

function dateLabel(s, id) {
  const type = presentationRecordType(s, id);
  if (groupOf(type) === 'attack') {
    const i = findIncident(s, id);
    const datedObservation = claims(s, id).find(c => c.claim_family === 'EVENT_DATE')?.date_precision === 'DAY';
    return i?.date_precision === 'APPROXIMATE' && datedObservation
      ? 'Reported attack observation'
      : 'Strike / attack date';
  }
  if (/service|follow.up/i.test(typeText(type))) return 'Service observation period';
  if (groupOf(type) === 'context') return 'Operational episode date / period';
  return 'Proposed event date / period';
}

function queueRow(s, i, supervisor = false) {
  const id = i.incident_id, f = facilityFor(s, id), all = claims(s, id), work = tasks(s, id), type = presentationRecordType(s, id);
  const active = work.filter(isActive), next = active[0]?.factual_question || all.find(c => s.workflow?.claims?.[c.claim_id]?.review_needed)?.subject;
  return `<article class="panel incident-queue-row" data-incident-id="${h(id)}" data-search-text="${h([facilityName(f), i.incident_label, eventDate(s, id)].join(' ').toLowerCase())}"><div class="queue-row-main"><div class="inline">${badge(typeText(type), groupOf(type) === 'attack' ? 'derived' : 'historical')}${badge(recordStatus(s, id))}</div><h3>${h(i.incident_label || 'Incident under review')}</h3><p class="queue-facility"><b>${h(facilityName(f))}</b> · ${h(statusText(facilityType(s, f?.facility_id)) || 'Type not yet established')}</p><p class="subtle">${h(dateLabel(s, id))}: ${h(eventDate(s, id))}</p><p class="next-task"><b>Next:</b> ${h(next || 'Open the record to check the current review requirements.')}</p><div class="queue-small-stats"><span>${all.filter(c => !reviewed(c, s)).length} facts needing current-lab validation</span><span>${active.length} active tasks</span><span>${work.filter(g => /deferred/i.test(taskGroup(g))).length} deferred</span></div></div>${action(supervisor ? 'supervisor-detail' : 'open', supervisor ? 'View incident' : 'Open case', `data-id="${h(id)}"`, !supervisor)}</article>`;
}


function evidencePairs(s, claimId) {
  const found = evidenceFor(s, claimId) || [];
  return found.map(item => {
    const relation = item.relation || item.link || item.claim_source || item;
    const source = item.source || rows(s, 'SOURCE').find(src => src.source_id === relation.source_id);
    return {relation, source};
  }).filter(x => x.source);
}

export function evidenceCard(s, source, relation = {}, full = false) {
  return renderEvidenceCard(s, source, relation, full);
}

function conflictFor(s, c) {
  const conflict = (s.conflicts || []).find(x => x.claim_ids?.includes(c.claim_id));
  if (!conflict && c.validation_state !== 'CONFLICTING') return '';
  const accounts = conflict?.representations || [];
  return `<div class="conflict-box"><h4>Conflicting accounts</h4>${accounts.length ? accounts.map((a, i) => `<p><b>Account ${String.fromCharCode(65 + i)}:</b> ${h(str(a.value))}</p>`).join('') : `<p>${h(c.review_notes || 'The saved sources disagree. Read the supporting and challenging evidence before deciding.')}</p>`}<p>Do not force a single answer when the evidence does not resolve the disagreement.</p></div>`;
}

function nextForFact(s, c) {
  const g = tasks(s, c.incident_id).find(g => g.claim_id === c.claim_id && taskGroup(g) !== 'resolved');
  if (g && taskGroup(g) !== 'not_assessed') return {text: taskLabel(g), detail: g.next_action || 'Review the saved evidence and identify what remains unresolved for this proposition.', task: g};
  if (s.workflow?.claims?.[c.claim_id]?.review_needed) return {text: 'Review new evidence', detail: 'A new source may change this finding. Review it with the saved evidence; prior research remains preserved.'};
  if (reviewed(c, s)) return {text: 'View review', detail: 'You can still add evidence. New evidence does not erase the earlier review.'};
  return {text: 'Review fact', detail: 'Read the saved evidence and decide what it establishes. Choose Unknown if it does not answer the question.'};
}

function proposedEntry(s, c) {
  const p = s.workflow?.claims?.[c.claim_id]?.proposal;
  if (!p || (!Object.hasOwn(p, 'value') && !Object.hasOwn(p, 'proposed_value'))) return '';
  const value = Object.hasOwn(p, 'value') ? p.value : p.proposed_value;
  return `<aside class="proposed-entry callout"><b>Initial entry — needs validation</b><p>${h(valueText({...c, ...p, current_verified_value:value}))}</p><p class="subtle">This is the researcher's initial entry. It remains separate from the verified finding until an explicit fact review.</p></aside>`;
}

export function factCard(s, c, readOnly = false) {
  const pairs = evidencePairs(s, c.claim_id), next = nextForFact(s, c);
  const groups = [...new Set(pairs.map(p => p.relation.dependency_group_id).filter(Boolean))];
  const lab = s.workflow?.claims?.[c.claim_id] || {};
  const reviewLabel = currentLabLabel(s, c);
  const evidence = renderFactEvidence(s,c);
  return `<article class="panel fact-card view-fact-card"${supportedReviewAttribute(s,c)} data-claim-id="${h(c.claim_id)}" data-evidence-state="${h(c.validation_state)}"${readOnly ? ' data-read-only="true"' : ''}><div class="fact-heading"><div><h3 class="fact-type">${h(factLabel(c))}</h3><p class="fact-proposition">${h(c.subject || 'Factual question not yet recorded')}</p></div>${badge(label(c.validation_state || 'NOT_REVIEWED'))}${!pairs.length ? badge('Needs evidence','unknown') : ''}</div><p class="fact-current-value"><span>${labReviewState(c, s) === 'NOT_REVIEWED' && String(c.validation_origin || '').startsWith('LEGACY_') ? 'Prior research finding' : 'Current finding'}</span><b>${h(valueText(c))}</b></p><div class="view-review-meta"><div><span>Research origin</span><b>${h(statusText(origin(c)) || 'Origin not recorded')}</b></div><div><span>Current lab validation</span><b>${h(reviewLabel)}</b>${lab.lab_reviewed_by || lab.lab_reviewed_at ? `<small>${h(lab.lab_reviewed_by || 'Researcher not recorded')} · ${h(lab.lab_reviewed_at || 'Time not recorded')}</small>` : ''}</div><div><span>Evidence</span><b>${new Set(pairs.map(p => p.source.source_id)).size} linked source${pairs.length === 1 ? '' : 's'}</b><small>${groups.length ? groups.length + ' recorded reporting groups' : 'Source independence not yet established'} · repetitions are not independent confirmation</small></div></div>${proposedEntry(s, c)}${conflictFor(s, c)}${!readOnly ? `<div class="fact-next"><b>What to do next:</b> ${h(next.detail)}<div class="inline">${action('review', next.text, `data-claim="${h(c.claim_id)}"`)}${action('evidence', '+ Add evidence', `data-claim="${h(c.claim_id)}"`, true)}${next.task ? action('task', 'Work this research task', `data-id="${h(next.task.gap_task_id)}"`) : ''}</div></div>` : ''}<details class="fact-evidence"><summary>Inspect evidence and source details (${pairs.length})</summary>${evidence || empty('No source is linked to this fact yet. Add evidence before making a supported factual finding.')}</details>${technical(`${priorResearchDetails(s, c)}<p><b>Fact identifier:</b> ${h(c.claim_id)}</p><p><b>Original recorded value:</b> ${h(str(c.ai_original_value))}</p><p><b>Review basis:</b> ${h(str(c.review_notes))}</p><pre class="raw">${h(JSON.stringify({validation_origin: c.validation_origin, current_value_authority: c.current_value_authority, individual_human_factual_adjudication: c.individual_human_factual_adjudication, claim_revision: s.revisions?.CLAIM?.[c.claim_id] ?? null}, null, 2))}</pre>`)}</article>`;
}

function taskCard(s, g, readOnly = false) {
  const c = findClaim(s, g.claim_id), bucket = taskGroup(g);
  const instruction = g.next_action || 'The lab has not yet assessed this task. Review the preserved question and evidence before deciding what work is needed.';
  return `<details class="task-card" data-task-id="${h(g.gap_task_id)}" data-task-bucket="${h(bucket)}"><summary><div><b>${h(g.factual_question || 'Question not yet specified')}</b>${c ? `<span>${h(factLabel(c))}: ${h(c.subject)}</span>` : ''}</div>${badge(taskLabel(g), isActive(g) ? 'unknown' : 'historical')}</summary><div class="task-body"><dl><dt>What is unclear or missing?</dt><dd>${h(g.factual_question || 'Not yet specified')}</dd><dt>Why does it matter?</dt><dd>${h(g.reason || g.historical_reason || 'Its relevance has not yet been recorded.')}</dd><dt>What should you look for?</dt><dd>${h(instruction)}</dd><dt>Current lab status</dt><dd>${h(taskLabel(g))}${g.resolution ? ' · ' + h(g.resolution) : ''}</dd></dl>${g.lab_task_by || g.lab_task_at ? `<p class="subtle">Lab decision: ${h(g.lab_task_by || 'Researcher not recorded')} · ${h(g.lab_task_at || 'Time not recorded')} · revision ${h(g.revision ?? 'Not recorded')}</p>` : ''}${/deferred/i.test(bucket) ? '<p class="callout">This work is deferred. Keep the uncertainty visible; it is not an instruction to start an active search.</p>' : /unable|disposition/i.test(bucket) ? '<p class="callout">This question has an explicit unresolved disposition. It is not counted as an active search task.</p>' : ''}${technical(`<p><b>Original research question:</b> ${h(s.records.GAP_TASK.find(t => t.gap_task_id === g.gap_task_id)?.factual_question || "Not recorded")}</p><p><b>Previous research disposition:</b> ${h(label(g.historical_disposition || g.historical_status || 'Not recorded'))}</p><p>${h(g.historical_resolution || 'No previous resolution note recorded.')}</p><p><b>Previous research instruction:</b> ${h(g.historical_next_action || 'Not recorded')}</p><p class="subtle">Historical decisions are preserved. They do not assign or defer current lab work.</p>`, 'Previous research task history')}${!readOnly ? `<div class="inline">${action('task', bucket === 'not_assessed' ? 'Assess this research task' : 'Work this research task', `data-id="${h(g.gap_task_id)}"`)}${c ? action('evidence', '+ Add evidence to this fact', `data-claim="${h(c.claim_id)}"`) : ''}</div>` : ''}</div></details>`;
}

function taskSection(s, id, readOnly = false) {
  const all = tasks(s, id);
  return `<section class="section task-section" id="research-tasks"><div class="section-title"><div><div class="eyebrow">Research tasks</div><h2>What still needs checking</h2><p>Check each current lab status. Missing evidence does not always mean outside research is required.</p></div></div><div class="task-counts">${badge(all.filter(g => taskGroup(g) === 'not_assessed').length + ' not yet assessed', 'unknown')}${badge(all.filter(isActive).length + ' active / blocking', 'unknown')}${badge(all.filter(g => taskGroup(g) === 'deferred').length + ' deferred', 'historical')}${badge(all.filter(g => /unable|disposition/i.test(taskGroup(g))).length + ' unable to resolve / dispositioned', 'historical')}${badge(all.filter(g => taskGroup(g) === 'resolved').length + ' resolved', 'historical')}</div>${all.map(g => taskCard(s, g, readOnly)).join('') || empty('No research task has been recorded for this incident.')}</section>`;
}

function finding(s, id, family, heading) {
  const cs = claims(s, id).filter(c => c.claim_family === family);
  return `<div class="finding" data-field="${h(family)}"><span>${h(heading || label(family))}</span>${cs.length ? cs.map(c => `<p><b>${h(valueText(c))}</b>${badge(label(c.validation_state))}<small>${h(timingReviewState(s, c))}${labReviewState(c, s) === 'REOPENED' ? ' · Previous lab review preserved' : ''}</small></p>`).join('') : '<p><b>Not established</b><small>No finding recorded. This does not mean it did not occur.</small></p>'}</div>`;
}

const OPERATION_FAMILIES = ['FULL_CLOSURE', 'PARTIAL_CLOSURE', 'DEPARTMENT_OR_SERVICE_SHUTDOWN', 'REDUCED_CAPACITY', 'EVACUATION', 'PATIENT_TRANSFER', 'UTILITY_LOSS', 'ACCESS_DISRUPTION', 'RELOCATION'];
function operatingContext(s, id) {
  const relevant = claims(s, id).filter(c => c.claim_family === 'REDUCED_CAPACITY' ||
    (/baseline|before|prior|operating/i.test(c.subject || '') && ['FULL_CLOSURE', 'HUMAN_IMPACT_MEASURE'].includes(c.claim_family)));
  return relevant.length ? `<p class="subtle">Related operating findings keep their own dates and scope below. Do not treat post-event activity as proof of pre-event operation.</p>${relevant.map(c => supervisorFinding(s, c)).join('')}` : '<p>Not established from current findings. Do not infer a baseline from a later strike.</p>';
}
function durationPanel(s, id, {readOnly = false} = {}) {
  const projection = timingProjection(s, id);
  const intervals = timingIntervals(s, id);
  const renderRow = row => {
    const details = `${row.value_type === 'TEXT_WHERE_REQUIRED' ? '<p>Recorded timing account; retain its stated scope and limitations.</p>' : ''}${row.impact_basis ? `<p>Evidence basis: ${h(label(row.impact_basis))}</p>` : row.value_type === 'QUANTITATIVE' ? '<p>Reporting basis not established.</p>' : ''}${row.review_notes ? `<p>${h(row.review_notes)}</p>` : ''}`;
    return `<article class="duration-finding timing-finding" data-timing-claim="${h(row.claim_id)}" data-evidence-state="${h(row.validation_state)}" data-review-needed="${row.review_needed}" data-lab-review-state="${h(row.lab_review_state)}" data-eligible="${row.eligible}"><p>${row.lab_review_state === 'NOT_REVIEWED' ? '<small>Prior research finding</small>' : ''}<b>${h(row.value_text)}</b> ${badge(label(row.validation_state))}</p><p>${h(row.subject)}</p>${row.scope && row.scope !== row.subject ? `<p><b>Scope:</b> ${h(str(row.scope))}</p>` : ''}${row.review_needed ? badge(row.human_review_state, 'conflicting') : `<small>${h(row.human_review_state)}</small>`}${row.lab_review_state === 'REOPENED' ? '<small>Previous lab review preserved</small>' : ''}${row.date_precision ? `<small>Date precision: ${h(label(row.date_precision))}</small>` : ''}${details ? `<details class="timing-provenance"><summary>Recorded basis and limitations</summary>${details}</details>` : ''}${!readOnly ? `<div class="actions">${action('review', 'Review this fact', `data-claim="${h(row.claim_id)}"`)}${action('evidence', '+ Add evidence', `data-claim="${h(row.claim_id)}"`)}</div>` : ''}</article>`;
  };
  const newFactAction = group => readOnly ? '' : action('new-fact', ({effect_onset: '+ Add effect onset fact', restoration_status: '+ Add restoration status fact', restoration_date: '+ Add restoration date fact', source_reported_duration: '+ Add source-reported duration fact'})[group.key], `data-family="${h(group.claim_family)}" data-value-type="${h(group.value_type)}" data-incident="${h(id)}"`);
  const renderGroup = group => {
    const existingDuration = group.key === 'source_reported_duration' && projection.other_duration_rows.length;
    const missing = `<p><b>Not established</b><small>${group.key === 'source_reported_duration' ? 'No directly reported duration is currently recorded.' : 'No current fact is recorded. This does not mean it did not occur.'}</small></p>${existingDuration ? '<details class="timing-provenance"><summary>Using the existing duration facts</summary><p>The existing duration facts below retain their recorded basis. Review them before adding a distinct duration fact.</p></details>' : newFactAction(group)}`;
    return `<div class="finding" data-field="${h(group.claim_family)}" data-timing-field="${h(group.key)}"><span>${h(group.heading)}</span>${group.rows.length ? group.rows.map(renderRow).join('') : missing}${existingDuration && !group.rows.length ? `<h4>Other recorded duration facts</h4>${projection.other_duration_rows.map(renderRow).join('')}` : ''}</div>`;
  };
  return `<section class="panel section duration-panel" id="service-disruption-timing" data-incident-id="${h(id)}" data-read-only="${readOnly}"><h2>Service Disruption &amp; Restoration Timing</h2><p class="subtle">Recorded service effects and timing; unknown does not mean no disruption.</p><details class="timing-guidance"><summary>Questions for a sparse or unresolved record</summary><p><b>This section updates automatically from the recorded facts below.</b> To change a finding, review that fact or add evidence to it.</p><p>Is there evidence that healthcare services were interrupted? Identify the affected service and distinguish operational disruption from physical building damage.</p><ul><li>Which services were affected, and when did the disruption begin?</li><li>Did the facility close, reduce capacity, relocate or continue operating?</li><li>Is partial reopening or restoration of a particular service supported?</li><li>Was full service restored, and when?</li><li>Can source-supported dates establish a duration for the same service and scope?</li></ul><p>Do not infer closure from an attack, a nearby strike, road damage or interrupted access. Do not infer restoration because reporting stopped. No evidence of disruption differs from evidence that services were not disrupted. A justified not-applicable decision belongs in the normal factual-review workflow.</p></details><div class="finding-grid">${projection.groups.map(renderGroup).join('')}</div>${projection.groups.find(g => g.key === 'source_reported_duration').rows.length && projection.other_duration_rows.length ? `<div class="section"><h3>Other recorded duration facts</h3><p class="subtle">These keep their recorded evidence basis and are not treated as directly reported durations.</p>${projection.other_duration_rows.map(renderRow).join('')}</div>` : ''}<div class="timing-interval"><h3>Elapsed time from reviewed dates</h3>${intervals.length?intervals.map(x=>`<p data-derived-interval data-start-claim="${h(x.start_claim_id)}" data-end-claim="${h(x.end_claim_id)}"><b>${x.min_days===x.max_days?x.min_days:`${x.min_days}–${x.max_days}`} elapsed days</b> · ${h(x.scope)}. ${h(label(x.start_precision))} start; ${h(label(x.end_precision))} end. Derived from the two reviewed date findings; not a new factual assertion or a directly reported duration.</p>`).join(''):'<p>Not calculable from current reviewed dates. Unknown, disputed or unmatched endpoints remain unresolved.</p>'}<details><summary>How elapsed time is calculated</summary><p>A duration can only be calculated from matching, source-supported, human-reviewed date findings.</p><p>Use one current reviewed supported onset and one current reviewed supported restoration date with the same explicitly recorded effect or scope and supporting source relationships. Subtract UTC calendar dates, excluding the restoration day: same-day restoration is 0 elapsed days. Exact days give one value. Month and date-range precision give minimum and maximum calendar-day bounds. Approximate dates, overlapping uncertain endpoints, conflicting or reopened reviews, multiple endpoints and missing scope withhold a result. A reported duration stays separate; publication dates are never substituted.</p></details></div></section>`;
}

function history(s, id) {
  const logs = rows(s, 'ACTIVITY_LOG').filter(a => !id || a.incident_id === id).slice().sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''))).slice(0, 12);
  return logs.map(a => {
    const labels = {CLAIM:{create:'Fact added',validate:'Fact reviewed',revise:'Fact updated',reopen:'Fact review reopened'},CLAIM_SOURCE:{create:'Evidence added',revise:'Evidence relationship updated'},SOURCE:{create:'Source added',revise:'Source updated'},GAP_TASK:{create:'Research task added',defer:'Research task deferred',resolve:'Research task resolved',revise:'Research task updated'},FACILITY:{create:'Facility proposed',revise:'Facility identity or type updated'},INCIDENT:{create:'Incident submitted to Team Review',validate:/override/i.test(a.reason || '')?'Supervisor completion override recorded':'Incident review completed',reopen:'Incident review reopened',revise:'Review requirements updated',derive:'Completion retained after a nonmaterial change'}};
    const title = a.action_type === 'import' ? 'Preserved record imported' : labels[a.entity_type]?.[a.action_type] || label(a.action_type || 'Recorded change');
    const incident = findIncident(s, a.incident_id), facility = rows(s, 'FACILITY').find(f => f.facility_id === a.facility_id) || facilityFor(s, a.incident_id);
    return `<article class="activity-row"><div><b>${h(title)}</b><time>${h(a.timestamp || 'Time not recorded')}</time></div><p>${h(a.reason || 'A change was recorded.')}</p><small>${h(a.actor_display_name || a.actor || 'Researcher not recorded')}${facility ? ' · ' + h(facilityName(facility)) : ''}${incident ? ' · ' + h(incident.incident_label) : ''}</small>${technical(`<p>History entry ${h(a.activity_id)} · ${h(a.entity_type)} ${h(a.entity_id)}</p>`)}</article>`;
  }).join('') || empty('No activity has been recorded for this incident.');
}

export function renderIncident(s, id) {
  const i = findIncident(s, id);
  if (!i) return empty('This incident is not available. Return to My Work and reload the latest records.');
  const all = claims(s, id), type = presentationRecordType(s, id);
  const physical = all.filter(c => c.claim_family === 'PHYSICAL_DAMAGE');
  const operations = all.filter(c => OPERATION_FAMILIES.includes(c.claim_family));
  return `${workflowStrip(3)}${facilityBanner(s, id)}<div class="page-head"><div><div class="eyebrow">Incident workspace</div><h1>${h(i.incident_label || 'Incident under review')}</h1><p>${h(dateLabel(s, id))}: <b>${h(eventDate(s, id))}</b></p><div class="inline section-space">${badge(typeText(type))}${badge(recordStatus(s, id))}</div></div>${action('review-changes', 'Review changes', `data-id="${h(id)}"`, true)}</div>${groupOf(type) === 'context' ? '<div class="no-strike-banner">Operational / service context record — no separate strike is established in this record.</div>' : ''}<section class="panel incident-brief"><h2>What is currently recorded</h2><div class="finding-grid">${finding(s, id, 'KINETIC_EVENT', 'Attack occurrence')}${finding(s, id, 'ATTACK_RELATIONSHIP', 'Attack relationship')}${finding(s, id, 'FULL_CLOSURE', 'Full closure')}${finding(s, id, 'ATTACK_TO_EFFECT_CAUSATION', 'Attack → specific operational effect')}</div><p class="subtle">Read each finding with its evidence and human-review label. Damage, evacuation, closure, and causation are separate questions.</p></section><div class="impact-overview"><section class="panel"><h2>Physical impact</h2>${physical.length ? physical.map(c => `<p><b>${h(valueText(c))}</b> · ${badge(label(c.validation_state))}<br>${h(c.subject)}</p>`).join('') : '<p>Physical damage not established.</p>'}</section><section class="panel"><h2>Healthcare-service / operational impact</h2>${operations.length ? operations.map(c => `<p><b>${h(factLabel(c))}:</b> ${h(valueText(c))} · ${badge(label(c.validation_state))}</p>`).join('') : '<p>Operational effects not established.</p>'}</section></div><section class="section" id="facts-section"><div class="section-title"><div><div class="eyebrow">Facts and evidence</div><h2>What the evidence currently establishes</h2><p>Check one fact at a time. If the evidence does not answer it, keep Unknown.</p></div></div><div class="view-facts">${all.map(c => factCard(s, c)).join('') || empty('No fact is recorded yet. Add a factual question and the evidence you found.')}</div><div class="new-fact-action"><p>Use a new fact only for a different question. Evidence about an existing fact belongs on that fact.</p>${action('new-fact', '+ Add fact', `data-id="${h(id)}"`)}</div></section>${taskSection(s, id)}${durationPanel(s, id)}<section class="panel section"><h2>Incident review</h2>${badge(recordStatus(s, id))}<p>Individual fact reviews do not complete the incident. Completion concerns the required work at the current revision, and later evidence can reopen it.</p>${action('supervisor-detail', 'View review requirements and completion', `data-id="${h(id)}"`)}${action('new-incident', '+ Add another incident for this facility', `data-facility="${h(facilityFor(s, id)?.facility_id || '')}"`)}</section>${technical(`<p>Incident ${h(id)} · revision ${revision(s, id)} · ${all.length} current factual claims. Preserved baseline classifications remain available as historical methodology.</p>${(s.classifications || []).filter(c => c.incident_id === id).map(c => `<p><b>Preserved baseline classification — not recalculated for later revisions:</b> ${h(label(c.derived_classification))}</p>`).join('')}`)}<details class="secondary-details"><summary>Activity and prior review history</summary><div class="secondary-content">${history(s, id)}</div></details>`;
}

function metric(name, value, key) { return `<div class="panel supervisor-metric" data-metric="${h(key)}"><strong>${value}</strong><span>${h(name)}</span></div>`; }
function downstreamReady(s, id) { const result = downstream(s, id); return typeof result === 'boolean' ? result : Boolean(result?.eligible || result?.attackEligible || result?.ready); }
function downstreamReason(s, id) { const result = downstream(s, id); return typeof result === 'object' && result ? result.reason || (result.eligible ? 'Ready at the current revision.' : 'Not yet eligible for reviewed output.') : result ? 'Ready at the current revision.' : 'Not yet eligible for reviewed output.'; }

export function renderSupervisor(s) {
  const all = rows(s, 'INCIDENT'), taskRows = rows(s, 'GAP_TASK'), facts = rows(s, 'CLAIM');
  const attention = all.filter(i => tasks(s, i.incident_id).some(g => isActive(g) && (!g.claim_id || requiredIds(s, i.incident_id).includes(g.claim_id))) || claims(s, i.incident_id).some(c => {
    if (s.workflow?.claims?.[c.claim_id]?.review_needed) return true;
    if (c.validation_state !== 'CONFLICTING') return false;
    const linked = taskRows.filter(g => g.claim_id === c.claim_id);
    const disposition = workflow(s, i.incident_id).dispositions?.[c.claim_id];
    const explicit = ['deferred','unable_to_resolve','not_required'].includes(disposition?.disposition) && Boolean(disposition.reason?.trim());
    return !explicit && !linked.some(g => ['deferred','unable','resolved'].includes(taskGroup(g)));
  }));
  const newRows = all.filter(i => workflow(s, i.incident_id).entered_by || workflow(s, i.incident_id).status === 'new');
  const ready = all.filter(i => downstreamReady(s, i.incident_id));
  return `<div id="supervisor-hub"><div class="page-head"><div><div class="eyebrow">Currently recorded work</div><h1>Supervisor Hub</h1><p>See what needs attention, what changed, and which reviews are ready to use.</p></div></div><section class="section"><h2>Project snapshot</h2><p>These counts describe currently recorded work. They do not claim the historical record is exhaustive.</p><div class="supervisor-metrics">${metric('Currently recorded facilities', rows(s, 'FACILITY').length, 'facilities')}${metric('Currently recorded incident records', all.length, 'records')}${metric('Attack-containing records', all.filter(i => groupOf(recordType(s, i.incident_id)) === 'attack').length, 'attacks')}${metric('Operational / service context records', all.filter(i => groupOf(recordType(s, i.incident_id)) === 'context').length, 'context')}${metric('Active / blocking research tasks', taskRows.filter(isActive).length, 'active-tasks')}${metric('Deferred tasks', taskRows.filter(g => /deferred/i.test(taskGroup(g))).length, 'deferred-tasks')}${metric('Unable to resolve / dispositioned tasks', taskRows.filter(g => /unable|disposition/i.test(taskGroup(g))).length, 'dispositioned-tasks')}${metric('Resolved tasks', taskRows.filter(g => taskGroup(g) === 'resolved').length, 'resolved-tasks')}${metric('Conflicting facts', facts.filter(c => c.validation_state === 'CONFLICTING').length, 'conflicts')}${metric('Facts needing review after new evidence', facts.filter(c => s.workflow?.claims?.[c.claim_id]?.review_needed).length, 'reopened-facts')}${metric('Reviews complete at current revision', all.filter(i => recordComplete(s, i.incident_id)).length, 'complete')}${metric('Supervisor completion overrides', all.filter(i => /override/i.test(recordStatus(s, i.incident_id))).length, 'overrides')}${metric('Reviewed attack records ready downstream', ready.filter(i => groupOf(recordType(s, i.incident_id)) === 'attack').length, 'downstream')}</div></section><section class="section" id="needs-attention"><h2>Needs attention</h2><p>Active tasks, conflicting accounts, and new evidence that needs review. Deferred work remains visible separately.</p>${attention.map(i => queueRow(s, i, true)).join('') || empty('No current attention flag is recorded.')}</section><section class="section" id="new-submissions"><h2>New submissions</h2><p>A team submission can remain incomplete. It does not automatically become a reviewed attack.</p>${newRows.map(i => queueRow(s, i, true)).join('') || empty('No new team-review submissions are currently recorded.')}</section><section class="section"><h2>Recent changes</h2>${history(s)}</section><section class="section" id="reviewed-ready"><h2>Reviewed / downstream-ready incidents</h2><p>Unknown fields remain unknown after completion. Context records accompany attack records; they do not add strikes.</p>${ready.map(i => queueRow(s, i, true)).join('') || empty('No incident has yet met the current completion and output requirements.')}</section><section class="section"><h2>Facility / incident search</h2><p>Choose a facility to inspect its currently recorded chronology.</p><div class="facility-choices">${rows(s, 'FACILITY').map(f => `<div class="facility-choice"><div><b>${h(facilityName(f))}</b><span>${h(statusText(facilityType(s, f.facility_id)) || 'Type not yet established')} · ${h(locationText(f))}</span></div>${action('facility', 'View chronology', `data-id="${h(f.facility_id)}"`)}</div>`).join('')}</div><div class="section">${all.map(i => queueRow(s, i, true)).join('')}</div></section></div>`;
}

function completionChecklist(s, id) {
  const result = preflight(s, id), info = typeof result === 'object' && result ? result : {};
  const issues = Array.isArray(result) ? result : info.issues || info.blockers || info.reasons || [];
  return `<section class="panel section completion-preflight"><h2>Acceptance readiness</h2><p>A supervisor may accept the recorded work and displayed limitations for validated output. Acceptance preserves factual values and review states.</p><div class="preflight"><div><b>Reviewed findings</b><span>Current factual review remains separate from acceptance.</span></div><div><b>Deferred / waived findings</b><span>A reasoned fact waiver permits advancement without certifying that fact.</span></div><div><b>Research tasks</b><span>Nonblocking research opportunities; actual states remain unchanged.</span></div><div><b>Unknowns and conflicts</b><span>Keep limitations visible; acceptance does not resolve them.</span></div><div><b>Private changes</b><span>Owner-private drafts remain preserved.</span></div></div>${issues.length ? `<h3>Outstanding limitations</h3>${bullet(issues.map(x => typeof x === 'string' ? x : x.message || x.reason || x.label))}` : '<p>No outstanding requirement is currently recorded.</p>'}${s.profile?.role === 'supervisor' ? action('requirements', 'Review required / optional work', `data-id="${h(id)}"`) : '<p class="subtle">A supervisor records the required and optional work. You can inspect the current requirements above.</p>'}</section>`;
}

function supervisorFinding(s, c) {
  return `<article class="supervisor-finding" data-claim-id="${h(c.claim_id)}"><h3 class="fact-type">${h(factLabel(c))}</h3><p class="fact-proposition">${h(c.subject)}</p><b>${h(valueText(c))}</b><div class="inline">${badge(label(c.validation_state))}${badge(timingReviewState(s, c), s.workflow?.claims?.[c.claim_id]?.review_needed ? 'conflicting' : reviewed(c, s) ? 'supported' : 'unknown')}${labReviewState(c, s) === 'REOPENED' ? '<small>Previous lab review preserved</small>' : ''}</div>${c.review_notes ? `<p class="subtle">${h(c.review_notes)}</p>` : ''}</article>`;
}

export function renderSupervisorDetail(s, id, {includeTiming = true} = {}) {
  const i = findIncident(s, id);
  if (!i) return empty('Incident not available. Reload the current workspace.');
  const all = claims(s, id), type = presentationRecordType(s, id), supervisor = s.profile?.role === 'supervisor';
  const physical = all.filter(c => c.claim_family === 'PHYSICAL_DAMAGE');
  const operational = all.filter(c => OPERATION_FAMILIES.includes(c.claim_family));
  const causal = all.filter(c => c.claim_family === 'ATTACK_TO_EFFECT_CAUSATION');
  const humans = all.filter(c => c.claim_family === 'HUMAN_IMPACT_MEASURE' && directImpact(c));
  const context = all.filter(c => c.claim_family === 'HUMAN_IMPACT_MEASURE' && !directImpact(c));
  const unknown = all.filter(c => c.current_verified_value == null || ['CONFLICTING', 'NEEDS_MORE_EVIDENCE', 'NOT_REVIEWED'].includes(c.validation_state));
  return `<div id="supervisor-incident-detail" data-incident-id="${h(id)}" data-read-only="true">${facilityBanner(s, id)}<div class="page-head"><div><div class="eyebrow">Read-only incident summary</div><h1>${h(i.incident_label)}</h1><div class="inline">${badge(typeText(type))}${badge(recordStatus(s, id))}</div></div>${action('open', 'View research details / evidence', `data-id="${h(id)}"`)}</div><div class="supervisor-hero"><div><span>${h(dateLabel(s, id))}</span><strong>${h(eventDate(s, id))}</strong></div><div><span>Review decision</span><strong>${h(recordStatus(s, id))}</strong><small>Revision ${revision(s, id)} · ${h(downstreamReason(s, id))}</small></div></div>${groupOf(type) === 'context' ? '<div class="no-strike-banner">No separate strike established in this record. Service and operating-status observations are not additional attacks.</div>' : ''}<div class="callout">This summary uses the research below. Open the evidence details to see how each finding is supported. Completion does not turn unknowns into facts.</div><section class="section finding-grid">${finding(s, id, 'ATTACK_RELATIONSHIP', 'Attack relationship')}${finding(s, id, 'KINETIC_EVENT', 'Attack occurrence')}${finding(s, id, 'FULL_CLOSURE', 'Full closure')}</section><section class="panel section"><h2>What was struck / affected object</h2>${all.filter(c => c.claim_family === 'KINETIC_EVENT' || c.claim_family === 'PHYSICAL_DAMAGE').map(c => `<p>${h(c.subject)} · ${badge(label(c.validation_state))}</p>`).join('') || '<p>Not established from the current findings.</p>'}<p class="subtle">A service or department closing does not establish that it was physically struck.</p></section><section class="panel section"><h2>Operating state before the event</h2>${operatingContext(s, id)}<p class="subtle">Read the timing and scope in each proposition. Service capacity is context, not a count of people affected by the attack.</p></section><div class="impact-overview"><section class="panel"><h2>Physical impact</h2>${physical.map(c => supervisorFinding(s, c)).join('') || '<p>Physical damage not established.</p>'}</section><section class="panel"><h2>Healthcare-service / operational effects</h2>${operational.map(c => supervisorFinding(s, c)).join('') || '<p>Operational effects not established.</p>'}</section></div><section class="panel section"><h2>Attack → specific effect</h2>${causal.map(c => `<div>${supervisorFinding(s, c)}<p><b>Effect addressed:</b> ${h(causeTarget(c) ? findClaim(s, causeTarget(c))?.subject || 'Linked effect not available' : 'Read the preserved proposition and scope; no structured effect link recorded.')}</p></div>`).join('') || '<p>Causal link not established.</p>'}<p class="subtle">A causal finding about evacuation does not establish that the attack caused full closure or another effect.</p></section>${includeTiming ? durationPanel(s, id, {readOnly: true}) : ''}<section class="panel section"><h2>Alternate / replacement service</h2>${all.filter(c => c.claim_family === 'RELOCATION' || c.claim_family === 'PATIENT_TRANSFER').map(c => supervisorFinding(s, c)).join('') || '<p>No alternate service is established in this record.</p>'}<p>Later service availability does not establish original-site restoration or prove that the attack created the replacement service.</p></section><section class="panel section"><h2>Direct human effects</h2>${humans.map(c => supervisorFinding(s, c)).join('') || '<p>No directly reported human-effect quantity is established in this record.</p>'}<div class="capacity-context"><h3>Baseline / capacity / community context</h3>${context.map(c => supervisorFinding(s, c)).join('') || '<p>No contextual quantity is recorded.</p>'}<p>These are not counts of people impacted by the attack.</p></div></section><section class="panel section supervisor-limits"><h2>Important unknowns and conflicting findings</h2>${unknown.map(c => `<p><b>${h(factLabel(c))}:</b> ${h(c.subject)} — ${h(valueText(c))}; ${h(label(c.validation_state))}.</p>`).join('') || '<p>No unknown or conflicting factual value is currently recorded.</p>'}</section>${taskSection(s, id, true)}${completionChecklist(s, id)}<section class="panel section"><h2>Completion decision</h2><p>Completion applies to the current revision. A supervisor may accept unresolved work for a recorded reason, while every factual value remains unchanged.</p>${supervisor ? `<div class="inline">${action('complete', 'Complete normal review', `data-id="${h(id)}" data-mode="normal"`)}${action('complete', 'Supervisor completion override', `data-id="${h(id)}" data-mode="override"`)}${action('reopen', 'Reopen incident', `data-id="${h(id)}"`)}</div>` : '<p>Only a supervisor can make completion or reopening decisions.</p>'}</section><section class="section"><h2>Activity and completion history</h2>${history(s, id)}</section>${technical(`<p>Incident ${h(id)} · ${h(str(type?.canonical || i.incident_type))} · revision ${revision(s, id)}.</p><p>This is a read-only presentation of factual records. Completion operations affect workflow only.</p>${(s.classifications || []).filter(c => c.incident_id === id).map(c => `<p><b>Preserved baseline classification — secondary; not recalculated for later revisions:</b> ${h(label(c.derived_classification))}</p>`).join('')}`)}</div>`;
}

export function renderFacility(s, fid) {
  const f = rows(s, 'FACILITY').find(f => f.facility_id === fid);
  if (!f) return empty('This facility is not available.');
  const links = rows(s, 'INCIDENT_FACILITY').filter(r => r.facility_id === fid && r.is_current !== false);
  const ids = [...new Set(links.map(r => r.incident_id))], list = ids.map(id => findIncident(s, id)).filter(Boolean).sort((a, b) => String(a.event_start || '9999').localeCompare(String(b.event_start || '9999')));
  const complete = ids.filter(id => recordComplete(s, id)).length;
  const facts = rows(s, 'CLAIM').filter(c => c.facility_id === fid && ['IDENTITY', 'FACILITY_TYPE'].includes(c.claim_family) && c.is_current !== false);
  return `${workflowStrip(2)}<div id="facility-detail" data-facility-id="${h(fid)}">${facilityBanner(s, fid)}<div class="page-head"><div><h1>Facility and currently recorded incidents</h1><p>${complete === ids.length && ids.length ? 'All currently recorded incidents reviewed' : `${complete} of ${ids.length} currently recorded incidents reviewed`}</p><p>${ids.filter(id => groupOf(recordType(s, id)) === 'attack').length} attack-containing records · ${ids.filter(id => groupOf(recordType(s, id)) === 'context').length} operational / service context records</p></div>${action('new-incident', '+ Add incident for this facility', `data-facility="${h(fid)}"`, true)}</div><section class="panel"><h2>Check the physical facility</h2><p>Confirm the name, facility type, location, and whether a similarly named record is the same place. A human makes this decision; records are never merged automatically.</p><div class="finding-grid">${detail('Name', facilityName(f))}${detail('Facility type', statusText(facilityType(s, fid)) || 'Type not yet established')}${detail('Locality', locationText(f))}${detail('Identity status', statusText(identityState(s, fid)))}</div><p>${h(f.identity_notes || 'Identity notes have not been recorded.')}</p>${technical(`<p><b>Facility coordinates:</b> ${h(f.geo?.latitude != null && f.geo?.longitude != null ? `${f.geo.latitude}, ${f.geo.longitude}` : 'Not established')}</p><p>${h(str(f.geo?.precision))} · ${h(str(f.geo?.limitations))}</p><p>These are facility coordinates; they are not substituted for a strike location.</p>`)}</section><section class="section"><h2>Identity and type evidence</h2>${facts.map(c => factCard(s, c)).join('') || empty('Identity and facility type still need evidence-backed review.')}</section><section class="section"><h2>Currently recorded chronology</h2><p>Each record keeps its own date, effects, and review state. Operational and service records are not additional strikes.</p>${list.map(i => queueRow(s, i, s.profile?.role === 'supervisor')).join('') || empty('No incident has been recorded for this facility.')}</section></div>`;
}

export function renderSourceDetails(s, sourceId, claimId = null, relationId = null) {
  return renderEvidenceDetails(s, sourceId, claimId, relationId);
}

function proposalEvidence(s, proposal) {
  const source = proposal.source || proposal.evidence?.source || proposal.evidence || rows(s, 'SOURCE').find(src => src.source_id === (proposal.source_id || proposal.relation?.source_id));
  if (!source) return '';
  const relation = proposal.relation || proposal.claim_source || proposal.evidence?.relation || {claim_id: proposal.claim_id, support_direction: proposal.relationship || source.relationship, evidence_locator: source.locator, relevant_excerpt: source.excerpt, limitations: source.limitations, originality: source.originality, directness: source.directness};
  const adapted = {...source, source_id: source.source_id || 'Proposed source', title: source.title, publisher_platform: source.publisher_platform || source.publisher, original_url: source.original_url || source.identifier, source_type: source.source_type || source.type, content_preservation_status: source.content_preservation_status || source.preservation, retrieval_body_status: source.retrieval_body_status || source.access, publication_date: source.publication_date || (source.publicationDate ? {value: source.publicationDate, precision: source.publicationPrecision} : null)};
  const shaped = {...relation, relevant_excerpt: relation.relevant_excerpt || proposal.excerpt || source.excerpt, evidence_locator: relation.evidence_locator || proposal.locator || source.locator};
  return evidenceCard(s, adapted, shaped, true);
}

export function renderReview(s, id, changes = []) {
  const list = Array.isArray(changes) ? changes : changes.changes || [changes];
  return `${workflowStrip(5)}<h2>Review changes before submitting</h2><p>Check the exact source, fact, value, and limitations below. Editing stays private until you submit.</p><div class="change-review-list">${list.map((change, index) => {
    const p = change.payload || change, body = p.claim || p.task || p, cid = p.claim_id || body.claim_id || change.claim_id, c = findClaim(s, cid);
    const kind = change.kind || change.type || change.operation || 'Submission item';
    const title = ({evidence: 'New evidence for this fact', review: 'Your factual review', new_fact: 'Add fact — needs lab validation', task: 'Research task decision', evidence_only: 'Evidence addition without another factual review'})[kind] || label(kind);
    const valueKey = (kind === 'new_fact' ? ['proposed_value', 'value', 'current_verified_value'] : ['current_verified_value', 'value', 'proposed_value']).find(key => Object.hasOwn(body, key));
    const approvalBasis = p.approval_evidence?.filter(e => e.selected) || [];
    const approvalSources = approvalBasis.length ? `<h4>Evidence selected for approval</h4><ul>${approvalBasis.map(e => `<li>${h(s.records.SOURCE.find(source => source.source_id === e.source_id)?.title || e.source_id)} · relationship ${h(e.id)} rev ${h(e.revision)}</li>`).join('')}</ul>` : '';
    const sources = approvalSources + (Array.isArray(p.sources) ? p.sources.map(e => proposalEvidence(s, e)).join('') : proposalEvidence(s, p));
    const editLabel = { evidence: "Edit evidence", review: "Edit review", new_fact: "Edit fact entry" }[change.type];
    const editButton = editLabel
      ? `<button type="button" data-action="edit-pending" data-index="${index}">${editLabel}</button>`
      : "";
    const privateActions = Array.isArray(changes)
      ? `<div class="inline">${editButton}<button type="button" data-action="remove-submission-item" data-index="${index}">Remove private change</button></div>`
      : editButton;
    return `<article class="change-review-item" data-change-kind="${h(kind)}"><h3>${h(title)}</h3>${privateActions}${c ? `<p><b>${h(factLabel(c))}:</b> ${h(c.subject)}</p>` : body.subject || body.proposition ? `<p>${h(body.subject || body.proposition)}</p>` : ''}${kind === 'new_fact' ? '<p class="callout">This fact will be added to the case as Needs lab validation. Its initial entry does not become a verified finding.</p>' : ''}<div class="change-detail-grid">${valueKey ? detail(kind === 'new_fact' ? 'Initial entry — needs validation' : 'Proposed value', body[valueKey], true) : ''}${c && valueKey ? detail('Prior current value', valueText(c), true) : ''}${body.validation_state || body.determination ? detail('Evidence assessment', label(body.validation_state || body.determination)) : ''}${body.date_precision || body.precision ? detail('Date precision', label(body.date_precision || body.precision)) : ''}${body.impact_basis || body.basis ? detail('Evidence basis', label(body.impact_basis || body.basis)) : ''}${body.quantitative_unit || body.unit ? detail('Unit', body.quantitative_unit || body.unit) : ''}${body.review_notes || body.notes ? detail('Reviewer explanation / limitations', body.review_notes || body.notes, true) : ''}${body.basis_explanation ? detail('Competing accounts / explanation of the evidence basis', body.basis_explanation, true) : ''}${body.identity_disposition ? detail('Physical-facility identity decision', body.identity_disposition === 'different' ? 'Different physical facility — comparison complete' : label(body.identity_disposition), true) : ''}${body.identity_reason ? detail('Reason for the identity decision', body.identity_reason, true) : ''}${body.attack_claim_id ? detail('Attack fact', findClaim(s, body.attack_claim_id)?.subject || 'Linked attack proposition is unavailable; check the selection before submitting.', true) : ''}${body.effect_claim_id ? detail('Specific effect fact', findClaim(s, body.effect_claim_id)?.subject || 'Linked effect proposition is unavailable; check the selection before submitting.', true) : ''}${body.distinct_reason || p.distinct_reason || p.distinct ? detail('Why this is a different fact', body.distinct_reason || p.distinct_reason || p.distinct, true) : ''}${body.factual_question ? detail('What needs checking', body.factual_question, true) : ''}${body.reason ? detail('Why it matters', body.reason, true) : ''}${body.lab_task_state ? detail('Current lab task status', body.lab_task_state === 'NOT_ASSESSED' ? 'Not yet assessed by the lab' : label(body.lab_task_state)) : body.status ? detail('Task status', label(body.status)) : ''}${body.next_action ? detail('What should happen next', body.next_action, true) : ''}${body.resolution ? detail('Task decision', body.resolution, true) : ''}</div>${sources}${p.source && kind !== 'review' ? '<p>Adding evidence does not itself record a new human factual decision.</p>' : ''}${technical(`<pre class="raw">${h(JSON.stringify(change, null, 2))}</pre>`)}</article>`;
  }).join('') || empty('There are no private changes to submit.')}</div><p class="callout warning">If someone else changes this record first, reload the latest version before submitting. Your submission must not overwrite a newer review silently.</p>`;
}

export {eventDate,dateLabel,locationText,evidencePairs,conflictFor,nextForFact,proposedEntry,valueText,history,completionChecklist,durationPanel,operatingContext,supervisorFinding,downstreamReason,downstreamReady,taskLabel,taskGroup,isActive,finding};
