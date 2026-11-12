import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { evidenceFor, effectiveSource, eligible } from '../../apps/web/src/approved/shared.js';
import { renderFactEvidence, renderEvidenceDetails } from '../../apps/web/src/approved/evidence-presentation.js';
import { renderReview } from '../../apps/web/src/approved/view-data.js';

function fixture() {
  return {
    records: {
      CLAIM: [{ claim_id: 'F1', subject: 'Synthetic proposition' }, { claim_id: 'F2', subject: 'Another synthetic proposition' }],
      SOURCE: [{ source_id: 'S1', title: 'Original citation', source_type: 'news', original_url: 'https://example.invalid/original' }],
      CLAIM_SOURCE: [
        { claim_source_id: 'E1', claim_id: 'F1', source_id: 'S1', support_direction: 'SUPPORTS', citation_override: { source_id: 'S1', title: 'عنوان مصحح', original_url: 'https://example.invalid/revised', source_type: 'official' } },
        { claim_source_id: 'E2', claim_id: 'F2', source_id: 'S1', support_direction: 'LIMITS' },
        { claim_source_id: 'E3', claim_id: 'F1', source_id: 'S1', support_direction: 'SUPPORTS', is_current: false, correction_withdrawn: true },
      ],
    },
  };
}

test('019 scoped citation appears in case reading and complete details without changing the shared source', () => {
  const state = fixture(), original = JSON.stringify(state);
  const selected = evidenceFor(state, 'F1');
  assert.equal(selected.length, 1);
  assert.equal(selected[0].source.title, 'عنوان مصحح');
  assert.equal(evidenceFor(state, 'F2')[0].source.title, 'Original citation');
  const summary = new JSDOM(renderFactEvidence(state, state.records.CLAIM[0])).window.document;
  assert.equal(summary.querySelector('.evidence-compact h4').textContent, 'عنوان مصحح');
  assert.equal(summary.querySelectorAll('.evidence-compact').length, 1);
  const detail = new JSDOM(renderEvidenceDetails(state, 'S1', 'F1', 'E1')).window.document;
  assert.equal(detail.querySelector('.evidence-source-head h3').textContent, 'عنوان مصحح');
  const advanced = JSON.parse([...detail.querySelectorAll('.evidence-advanced pre')].at(-1).textContent);
  assert.equal(advanced.preserved_shared_source.title, 'Original citation');
  assert.equal(advanced.selected_fact_relationship.claim_source_id, 'E1');
  assert.equal(JSON.stringify(state), original);
});

test('019 withdrawn last support is absent from current support, with historical record retained', () => {
  const state = fixture();
  state.records.CLAIM_SOURCE[0].correction_withdrawn = true;
  assert.equal(evidenceFor(state, 'F1').length, 0);
  const html = renderFactEvidence(state, state.records.CLAIM[0]);
  assert.match(html, /0 linked sources/);
  assert.equal(state.records.CLAIM_SOURCE.length, 3);
  const claim = { claim_id: 'F1', validation_state: 'SUPPORTED', current_verified_value: false, correction_withdrawn: true };
  assert.equal(eligible(claim, state), false);
});

test('019 citation projection cannot replace source identity; unknowns and negatives survive', () => {
  const source = { source_id: 'S1', publication_date: { precision: 'UNKNOWN', value: null } };
  const effective = effectiveSource(source, { citation_override: { source_id: 'ATTEMPTED', limitations: ['Uncertainty retained'] } });
  assert.equal(effective.source_id, 'S1');
  assert.deepEqual(effective.publication_date, source.publication_date);
  assert.equal(eligible({ claim_id: 'F1', validation_state: 'SUPPORTED', current_verified_value: false }, {}), true);
});

test('Review Changes edits the exact private review or evidence item', () => {
  const state = fixture();
  const html = renderReview(state, 'I1', [
    { type: 'review', claim_id: 'F1' },
    { type: 'evidence', claim_id: 'F1', source_id: 'S1' },
    { type: 'evidence', claim_id: 'F2', source_id: 'S1' },
  ]);
  const document = new JSDOM(html).window.document;
  const buttons = [...document.querySelectorAll('[data-action="edit-pending"]')];
  assert.deepEqual(buttons.map(button => [button.dataset.index, button.textContent.trim()]), [
    ['0', 'Edit review'],
    ['1', 'Edit evidence'],
    ['2', 'Edit evidence'],
  ]);
  assert.match(document.body.textContent, /Editing stays private until you submit/);
  assert.equal(document.querySelectorAll('[data-action="edit-submitted"]').length, 0);
});
