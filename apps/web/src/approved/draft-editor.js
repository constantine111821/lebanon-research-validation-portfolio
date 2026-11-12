import * as F from './forms.js';
import {h, clone} from './shared.js';

// Apply only fields the user changed. Unrendered provenance, IDs and additional
// citation locators survive the existing form's normalizing reader unchanged.
export function editedFields(original, before, after) {
  if (JSON.stringify(before) === JSON.stringify(after)) return original === undefined ? undefined : clone(original);
  if (Array.isArray(after)) {
    const result = clone(original || []);
    after.forEach((value, index) => { result[index] = editedFields(result[index], before?.[index], value); });
    return result;
  }
  if (after && typeof after === 'object') {
    const result = clone(original || {});
    for (const key of Object.keys(after)) {
      if (JSON.stringify(before?.[key]) !== JSON.stringify(after[key]))
        result[key] = editedFields(result[key], before?.[key], after[key]);
    }
    return result;
  }
  return clone(after);
}

export function draftEditor(item, pending, snapshot, facts) {
  const original = clone(item);
  let html, read, sourceOwner = null;
  if (item.type === 'evidence') {
    sourceOwner = item.source ? item : pending.find(x => x.source?.source_id === item.source_id);
    const source = sourceOwner?.source || snapshot.records.SOURCE.find(x => x.source_id === item.source_id);
    if (!source) throw Error('The recorded source is unavailable. Your draft is unchanged.');
    html = `<form id="draft-edit-form">${F.renderSource('draft', {...item, source})}<p class="subtle">${sourceOwner ? 'Only this private source and evidence proposal will change. Linked private evidence keeps the same source identifier.' : 'This source is already shared. Its metadata is read-only; you can revise this private evidence relationship.'} Additional recorded citation locations and provenance are retained.</p></form>`;
    read = form => F.readSource(form, 'draft', {reuse: !sourceOwner});
  } else if (item.type === 'new_fact') {
    const claim = {...item.claim, current_verified_value: item.claim.proposed_value ?? null};
    html = `<form id="draft-edit-form"><label class="field">Factual question<textarea name="subject" required>${h(item.claim.subject)}</textarea></label><label class="field">How is it different from existing facts?<textarea name="distinct_reason" required>${h(item.distinct_reason || '')}</textarea></label>${F.renderTyped('draft', claim)}<p class="subtle">The initial value remains unverified. Attached evidence and identifiers are retained.</p></form>`;
    read = form => {
      const fd = new FormData(form), subject = String(fd.get('subject') || '').trim(), reason = String(fd.get('distinct_reason') || '').trim();
      if (!subject || !reason) throw Error('Enter the factual question and explain how it differs.');
      const {value, ...typed} = F.readTyped(fd, 'draft', claim);
      return {claim: {...typed, subject, proposed_value: value}, distinct_reason: reason};
    };
  } else if (item.type === 'review') {
    const claim = facts.find(x => x.claim_id === item.claim_id);
    if (!claim) throw Error('The fact is unavailable. Your draft is unchanged.');
    const proposal = {...claim, ...item, current_verified_value: item.value};
    html = F.factForm(proposal, facts, snapshot, item).replace('id="fact-form"', 'id="draft-edit-form"');
    read = form => F.readFact(form, proposal);
  } else throw Error('This item uses its original review workflow. Your saved draft is unchanged.');
  return {
    html,
    bind(form) {
      if (item.type === 'evidence' && !sourceOwner) {
        const relationNames = new Set(['relationship','locator','excerpt','limitations','directness','originality','relies','underlying','dependency','material','material-reason']);
        for (const field of form.querySelectorAll('[name]'))
          if (!relationNames.has(field.name.replace(/^draft-/, ''))) field.disabled = true;
      }
      if (item.type === 'review') {
        form.elements.basis_explanation.value = item.basis_explanation || '';
        // Capture normalized baseline with attestation, but require a fresh check.
        form.elements.attestation.checked = true;
      }
      if (item.type === 'evidence') {
        form.elements['draft-material'].checked = Boolean(item.material);
        F.syncSourceRequirements(form);
      }
      let before;
      try { before = read(form); } catch { before = {}; } // Incomplete older drafts remain editable.
      if (item.type === 'review') form.elements.attestation.checked = false;
      return () => {
        const after = read(form);
        const replacement = editedFields(original, before, after);
        if (item.type === 'review') {
          delete replacement.expected_claim_revision;
          delete replacement.approval_evidence;
          if (after.approval_evidence) {
            replacement.expected_claim_revision = after.expected_claim_revision;
            replacement.approval_evidence = after.approval_evidence;
          }
        }
        // A shared private source may be carried by an earlier queue item.
        const source = sourceOwner && editedFields(sourceOwner.source, before.source, after.source);
        if (item.type === 'evidence') {
          if (original.source) replacement.source = source;
          else delete replacement.source;
          // The existing reader enforces challenges and material-qualification rules.
          if (before.relation?.support_direction !== after.relation.support_direction)
            replacement.material = after.material;
        }
        return {replacement, sourceOwner, source};
      };
    },
  };
}
