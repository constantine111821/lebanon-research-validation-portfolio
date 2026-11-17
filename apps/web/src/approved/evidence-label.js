import { h, currentEvidence, evidenceFor } from "./shared.js";
import { renderIncidentEvidence, relationship } from "./evidence-presentation.js";

const choices = [
  ["SUPPORTS", "Supports"],
  ["LIMITS", "Qualifies"],
  ["CONTRADICTS", "Challenges"],
  ["CONTEXT_ONLY", "Provides background"],
];
const endpoint = "/api/fact-correction-packages";

export function evidenceCorrections(store, incidentId) {
  return store.request(endpoint + "?incident_id=" + encodeURIComponent(incidentId));
}

export function evidenceLabelStatus(snapshot, claimId, relationshipId) {
  const packages = snapshot.packages.filter(item => item.fact_id === claimId);
  const pending = packages.find(item => item.status === "pending");
  if (pending) return "Correction submitted. Awaiting approval from a different Supervisor.";
  const latest = packages.find(item => item.evidence.some(link =>
    (!relationshipId || link.relationship_id === relationshipId) && link.action === "change" &&
    Object.hasOwn(link.changes, "support_direction")));
  return {
    accepted: "Evidence label correction accepted. Check the saved evidence before making your fact decision.",
    returned: "Evidence label correction returned for revision. The saved label is still in use.",
    rejected: "Evidence label correction rejected. The saved label is still in use.",
  }[latest?.status] || "";
}

function labelCommand(snapshot, fact, link, direction, reason) {
  return {
    operation_id: crypto.randomUUID(),
    incident_id: snapshot.incident_id,
    expected_revision: snapshot.revision,
    kind: "propose_fact_correction_package",
    payload: {
      fact_id: fact.id,
      expected_fact_revision: fact.revision,
      changes: {},
      reason,
      same_fact_attestation: true,
      evidence: fact.evidence.filter(item => currentEvidence(item.data)).map(item => {
        const changed = item.id === link.id;
        return {
          relationship_id: item.id,
          source_id: item.source.id,
          expected_relationship_revision: item.revision,
          expected_source_revision: item.source.revision,
          action: changed ? "change" : "retain",
          changes: changed ? { support_direction: direction } : {},
          reason: changed ? reason : "",
        };
      }),
    },
  };
}

// A second native modal keeps the actual unfinished review form mounted.
export function createEvidenceLabelDialog(container, store) {
  const dialog = document.createElement("dialog");
  dialog.className = "human-polish";
  dialog.setAttribute("aria-labelledby", "evidence-label-title");
  let request = null;
  let sending = false;
  let context = null;

  async function open(state, incidentId, claimId, relationshipId, onSaved, { fromReview, trigger, stillCurrent }) {
    const resumable = request?.incident_id === incidentId && request.payload.fact_id === claimId &&
      request.payload.evidence.some(item => item.relationship_id === relationshipId && item.action === "change");
    if (request && !resumable)
      throw Error("An earlier label correction could not be confirmed. Return to that evidence link to retry its exact submission.");
    const pair = evidenceFor(state, claimId).find(({ relation }) => relation.claim_source_id === relationshipId);
    const claim = state.records.CLAIM.find(item => item.claim_id === claimId);
    if (!pair || !claim) throw Error("This saved evidence link is unavailable. Refresh the case.");
    const snapshot = await evidenceCorrections(store, incidentId);
    if (!stillCurrent()) return;
    const fact = snapshot.facts.find(item => item.id === claimId);
    const link = fact?.evidence.find(item => item.id === relationshipId && currentEvidence(item.data));
    if (!resumable && (!link || fact.revision !== state.revisions.CLAIM[claimId] ||
        link.revision !== state.revisions.CLAIM_SOURCE[relationshipId] ||
        link.source.revision !== state.revisions.SOURCE[pair.source.source_id]))
      throw Error("This fact or evidence link changed. Refresh evidence and check the current label.");

    const restriction = !snapshot.writes_enabled ? "Correction writes are paused." :
      fact?.correction_restriction?.message || (fact?.lock?.locked ? fact.lock.reason : "");
    const status = evidenceLabelStatus(snapshot, claimId, relationshipId);
    context = { snapshot, fact, link, onSaved, trigger, claimId, relationshipId };
    dialog.innerHTML = `<div class="dialog-head"><h2 id="evidence-label-title">Change evidence label</h2><button type="button" data-label-close class="icon-button" aria-label="Close label correction">×</button></div>
      <div class="dialog-body">
        <p class="fact-proposition" dir="auto">${h(claim.subject)}</p>
        ${renderIncidentEvidence(state, pair.source, pair.relation, { sourceDetails: false })}
        <p data-label-status role="status">${h(status || restriction)}</p>
        <form>
          <fieldset${restriction && !resumable ? " hidden disabled" : ""}>
            <legend>Change this evidence link</legend>
            <p>Choose Supports if this excerpt supports the fact as written. Choose Qualifies if it narrows or limits what the fact can say.</p>
            <label class="field">New evidence label
              <select name="direction" aria-describedby="label-meaning" required>
                <option value="">Choose a different label</option>
                ${choices.map(([code, label]) => `<option value="${code}"${code === pair.relation.support_direction && !resumable ? " disabled" : ""}>${label}</option>`).join("")}
              </select>
            </label>
            <p id="label-meaning" class="subtle"></p>
            <label class="field">Correction reason<textarea name="reason" maxlength="4000" required></textarea></label>
            <p>A different Supervisor reviews this correction. Acceptance may reopen fact review. Use Refresh evidence in your review after approval.</p>
          </fieldset>
          <p class="form-error" role="alert" hidden></p>
          <div class="dialog-actions">
            <button type="button" data-label-close>${fromReview ? "Return to review" : "Close"}</button>
            ${!restriction || resumable ? '<button class="primary" type="submit">Submit label correction</button>' : ""}
          </div>
        </form>
      </div>`;
    if (resumable) {
      const form = dialog.querySelector("form");
      const change = request.payload.evidence.find(item => item.action === "change");
      form.elements.direction.value = change.changes.support_direction;
      form.elements.reason.value = request.payload.reason;
      showUnconfirmed(form);
    }
    container.append(dialog);
    dialog.showModal();
    dialog.querySelector("h2").setAttribute("tabindex", "-1");
    dialog.querySelector("h2").focus();
  }

  function showUnconfirmed(form) {
    form.querySelector("fieldset").disabled = true;
    form.querySelector('[type="submit"]').textContent = "Retry same submission";
    const error = form.querySelector("[role=alert]");
    error.hidden = false;
    error.textContent = "The save could not be confirmed. Retry the same submission to recover its recorded result.";
  }
  dialog.addEventListener("click", event => {
    if (!sending && event.target.closest("[data-label-close]")) dialog.close();
  });
  dialog.addEventListener("cancel", event => {
    if (sending) event.preventDefault();
  });
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    dialog.remove();
    const { trigger, claimId, relationshipId } = context;
    const replacement = [...container.querySelectorAll('[data-action="change-evidence-label"]')].find(button =>
      button.dataset.claim === claimId && button.dataset.relation === relationshipId);
    (trigger.isConnected ? trigger : replacement)?.focus();
  });
  dialog.addEventListener("change", event => {
    if (event.target.name === "direction")
      dialog.querySelector("#label-meaning").textContent = relationship(event.target.value)[1];
  });
  dialog.addEventListener("submit", async event => {
    event.preventDefault();
    if (sending) return;
    const form = event.target;
    const error = form.querySelector("[role=alert]");
    const submit = form.querySelector('[type="submit"]');
    const fields = form.querySelector("fieldset");
    const { snapshot, fact, link, onSaved } = context;
    if (!fields.disabled) {
      const direction = form.elements.direction.value;
      const reason = form.elements.reason.value.trim();
      if (!choices.some(([code]) => code === direction) || direction === link.data.support_direction || !reason) {
        error.hidden = false;
        error.textContent = "Choose a different evidence label and enter a correction reason.";
        return;
      }
      request = labelCommand(snapshot, fact, link, direction, reason);
    }
    sending = true;
    error.hidden = true;
    submit.disabled = fields.disabled = true;
    try {
      const { result } = await store.request(endpoint, "POST", request);
      request = null;
      submit.hidden = fields.hidden = true;
      const message = result.correction_status === "pending" ?
        "Correction submitted. Awaiting approval from a different Supervisor." : "Evidence label correction saved.";
      dialog.querySelector("[data-label-status]").textContent = message;
      onSaved(message);
      form.querySelector("[data-label-close]").focus();
    } catch (failure) {
      if (!failure.status || failure.status >= 500) showUnconfirmed(form);
      else {
        request = null;
        fields.disabled = failure.status === 409;
        submit.hidden = fields.disabled;
        error.hidden = false;
        error.textContent = failure.message;
      }
    } finally {
      sending = false;
      submit.disabled = false;
    }
  });
  return {
    open,
    close: () => dialog.close(),
    isOpen: () => dialog.open,
    hasUnfinished: () => Boolean(request || (dialog.open && dialog.querySelector("textarea")?.value.trim())),
    dispose: () => dialog.remove(),
  };
}
