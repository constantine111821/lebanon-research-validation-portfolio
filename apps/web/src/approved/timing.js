import {claims, eligible, fmt, label, reviewed, labReviewState, priorHumanReviewed} from './shared.js';

// A fresh, read-only projection of canonical current claims and their existing
// review workflow flags. It stores no factual values and never calculates time.
export const isDirectlyReportedDuration = c => c.claim_family === 'RESTORATION_DATE' &&
  c.value_type === 'QUANTITATIVE' && /^(directly reported|directly_reported)$/i.test(c.impact_basis || '');

export function timingValueText(c) {
  const value = c.current_verified_value;
  if (value === null || value === undefined || value === '') return 'Not established';
  if (c.claim_family === 'RESTORATION_STATUS' && value === 'not_found') {
    return 'Restoration not established from current evidence';
  }
  if (c.value_type === 'CATEGORICAL' && typeof value === 'string') return label(value);
  if (c.value_type === 'QUANTITATIVE') return `${fmt(value)} ${c.quantitative_unit || 'unit not recorded'}`;
  return fmt(value);
}

export function timingReviewState(s, c) {
  const state = labReviewState(c, s);
  if (state === 'REOPENED') return s.workflow?.claims?.[c.claim_id]?.review_needed ? 'Review needed — new evidence · Lab review reopened' : 'Lab review reopened';
  if (reviewed(c, s)) return 'Reviewed by the current lab';
  return s.workflow?.claims?.[c.claim_id]?.review_needed ? 'Needs lab validation · Review needed — new evidence' : 'Needs lab validation';
}

function timingRow(s, c) {
  const reviewNeeded = Boolean(s.workflow?.claims?.[c.claim_id]?.review_needed);
  const priorHumanReview = priorHumanReviewed(c), lab = s.workflow?.claims?.[c.claim_id] || {};
  return {
    claim_id: c.claim_id,
    incident_id: c.incident_id,
    subject: c.subject || 'Factual question not yet recorded',
    // Preserve the proposition even when a separate structured scope is absent.
    scope: c.scope ?? c.effect_scope ?? c.subject ?? null,
    claim_family: c.claim_family,
    value_type: c.value_type,
    value: c.current_verified_value ?? null,
    value_text: timingValueText(c),
    date_precision: c.date_precision ?? null,
    quantitative_unit: c.quantitative_unit ?? null,
    impact_basis: c.impact_basis ?? null,
    validation_state: c.validation_state || 'NOT_REVIEWED',
    human_review_state: timingReviewState(s, c),
    lab_review_state: labReviewState(c, s),
    lab_reviewed_by: lab.lab_reviewed_by ?? null,
    lab_reviewed_at: lab.lab_reviewed_at ?? null,
    lab_reviewed_claim_revision: lab.lab_reviewed_claim_revision ?? null,
    review_needed: reviewNeeded,
    prior_human_review: priorHumanReview,
    eligible: eligible(c, s),
    reviewer: c.reviewer ?? null,
    reviewed_at: c.reviewed_at ?? null,
    review_notes: c.review_notes || '',
    revision: s.revisions?.CLAIM?.[c.claim_id] ?? null
  };
}

export function timingProjection(s, incidentId) {
  const current = claims(s, incidentId);
  const groups = [
    {key: 'effect_onset', heading: 'Effect onset', claim_family: 'EFFECT_ONSET', value_type: 'DATE',
      select: c => c.claim_family === 'EFFECT_ONSET'},
    {key: 'restoration_status', heading: 'Restoration status', claim_family: 'RESTORATION_STATUS', value_type: 'CATEGORICAL',
      select: c => c.claim_family === 'RESTORATION_STATUS'},
    {key: 'restoration_date', heading: 'Effect end / restoration date', claim_family: 'RESTORATION_DATE', value_type: 'DATE',
      select: c => c.claim_family === 'RESTORATION_DATE' && ['DATE', 'DATE_RANGE'].includes(c.value_type)},
    {key: 'source_reported_duration', heading: 'Source-reported duration', claim_family: 'RESTORATION_DATE', value_type: 'QUANTITATIVE',
      select: isDirectlyReportedDuration}
  ].map(({select, ...group}) => ({...group, rows: current.filter(select).map(c => timingRow(s, c))}));
  return {
    incident_id: incidentId,
    groups,
    // Keep unverified, contextual, and proxy quantities inspectable without
    // relabeling their basis as a directly reported duration.
    other_duration_rows: current.filter(c => c.claim_family === 'RESTORATION_DATE' &&
      c.value_type === 'QUANTITATIVE' && !isDirectlyReportedDuration(c)).map(c => timingRow(s, c))
  };
}
