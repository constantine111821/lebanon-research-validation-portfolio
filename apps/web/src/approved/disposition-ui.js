import { acceptanceReadiness } from "../../../../packages/domain/src/acceptance-policy.js";
import { h, fmt, claims, tasks } from "./shared.js";
import {
  dispositionState,
  dispositionLabel,
  factLock,
  facilityLock,
  incidentLock,
  lockMessage,
} from "../../../../packages/domain/src/disposition.ts";
export { dispositionState, factLock, incidentLock, lockMessage };

function button(type, id, action, extra = "") {
  return `<button type="button" data-action="disposition-start" data-target-type="${type}" data-target-id="${h(id)}" data-disposition-action="${action}" ${extra}>${action === "REOPEN" ? "Reopen" : action === "DEFER" ? "Defer" : "Approve"} ${type}</button>`;
}
function stateNote(lock, type) {
  const heading =
    type === "fact" && lock.state === "ACTIVE"
      ? lock.cause === "dependency"
        ? "Protected by a dependent fact"
        : lock.protection_state === "INCIDENT_COMPLETED"
          ? "Protected by a completed incident"
          : "Editing locked for this incident"
      : dispositionLabel(lock.state, type);
  return `<div class="disposition-note" data-disposition-ui><strong>${h(heading)}</strong>${lock.reason ? `<p>${h(lock.reason)}</p>` : ""}${lock.locked ? `<p>${h(lockMessage(lock))}</p>` : ""}</div>`;
}
function controls(s, type, id) {
  const state = dispositionState(s, type, id);
  const lock = type === "fact" ? factLock(s, id) : incidentLock(s, id);
  if (type === "fact" && state === "ACTIVE" && lock.locked) return "";
  return `<div class="inline disposition-actions" data-disposition-ui aria-label="${type === "fact" ? "Fact" : "Incident"} disposition">${state === "ACTIVE" ? button(type, id, "DEFER") + button(type, id, "APPROVE") : button(type, id, "REOPEN")}</div>`;
}
const factActions = new Set(["review", "evidence", "open-fact"]);
const incidentActions = new Set([
  "new-fact",
  "add-evidence",
  "note",
  "requirements",
]);
export function actionLock(s, el, current, view) {
  const action = el.dataset.action;
  if (factActions.has(action) && el.dataset.claim)
    return factLock(s, el.dataset.claim);
  if (action === "task") {
    const task = tasks(s).find((x) => x.gap_task_id === el.dataset.id);
    const cid = el.dataset.claim || task?.claim_id;
    if (cid && factLock(s, cid).locked) return factLock(s, cid);
    return incidentLock(s, task?.incident_id || current);
  }
  if (incidentActions.has(action) && view !== "facility")
    return incidentLock(s, current);
  if (
    [
      "facility-resolution",
      "location-review",
      "facility-evidence",
      "reopen-facility-identity",
    ].includes(action)
  ) {
    return facilityLock(s, el.dataset.facility);
  }
  if (["phase2-approve", "phase2-revoke"].includes(action)) {
    const lock = incidentLock(s, el.dataset.id || current);
    if (lock.state === "DEFERRED") return lock;
  }
  return { locked: false };
}

export function decorateDisposition(root, s, current, view) {
  const supervisor = s.profile?.role === "supervisor";
  for (const card of root.querySelectorAll(
    "[data-claim-id],[data-phase2-claim]",
  )) {
    const id = card.dataset.claimId || card.dataset.phase2Claim;
    const lock = factLock(s, id);
    if (lock.locked) {
      card.classList.add(
        lock.state === "ACTIVE"
          ? "fact-protected"
          : `disposition-${lock.state.toLowerCase()}`,
      );
      card.insertAdjacentHTML("afterbegin", stateNote(lock, "fact"));
    }
    if (supervisor && !card.hasAttribute("data-phase2-claim"))
      card.insertAdjacentHTML("beforeend", controls(s, "fact", id));
  }
  for (const card of root.querySelectorAll("[data-incident-id]")) {
    const lock = incidentLock(s, card.dataset.incidentId);
    if (lock.locked) {
      card.classList.add(`disposition-${lock.state.toLowerCase()}`);
      (card.tagName === "TR"
        ? card.querySelector("td")
        : card
      ).insertAdjacentHTML("beforeend", stateNote(lock, "incident"));
    }
  }
  if (
    current &&
    ["incident", "supervisor-detail", "validated-detail"].includes(view)
  ) {
    const lock = incidentLock(s, current);
    const host =
      root.querySelector(".brief") ||
      root.querySelector("#completion-readiness") ||
      root.querySelector("#main");
    if (lock.locked)
      host.classList.add(`disposition-${lock.state.toLowerCase()}`);
    host.insertAdjacentHTML(
      "beforeend",
      `<section class="disposition-toolbar" data-disposition-ui aria-label="Incident disposition">${lock.locked ? stateNote(lock, "incident") : ""}${supervisor ? controls(s, "incident", current) : `<div class="inline"><button data-action="disposition-request" data-requested-action="DEFER" ${lock.locked ? "disabled" : ""}>Request incident deferral</button><button data-action="disposition-request" data-requested-action="APPROVE" ${lock.locked ? "disabled" : ""}>Request incident approval</button></div>`}<p class="subtle">Incident Approve completes review and authorizes Phase 2 / validated output together. Fact Defer waives a requirement; Incident Defer excludes the whole incident.</p></section>`,
    );
    const history = (s.disposition_history || []).filter(
      (x) =>
        x.incident_id === current ||
        (x.target_type === "fact" &&
          claims(s, current).some((c) => c.claim_id === x.target_id)),
    );
    if (history.length)
      root
        .querySelector("#main")
        .insertAdjacentHTML(
          "beforeend",
          `<details class="secondary-details disposition-history" data-disposition-ui><summary>Supervisor disposition history (${history.length})</summary>${history.map((x) => `<article><strong>${h(x.action)} · ${h(x.target_type)} ${h(x.target_id)}</strong><p>${h(x.prior_state || x.old_state)} → ${h(x.new_state || x.state)} · ${h(s.team?.find((p) => p.user_id === x.actor)?.display_name || x.actor || x.actor_id)} · ${h(x.occurred_at || x.created_at || x.timestamp)}</p><p>${h(x.reason)}</p><p>Revision ${h(x.revision ?? x.target_revision)}${x.request_id ? ` · Researcher request ${h(x.request_id)}` : ""}</p>${x.invalidation ? `<p>${h(fmt(x.invalidation))}</p>` : ""}</article>`).join("")}</details>`,
        );
    const requests = (s.disposition_requests || []).filter(
      (x) => x.incident_id === current,
    );
    if (requests.length)
      root
        .querySelector("#main")
        .insertAdjacentHTML(
          "beforeend",
          `<details class="secondary-details disposition-request-history" data-disposition-ui><summary>Incident disposition requests (${requests.length})</summary>${requests.map((x) => `<article><strong>${h(x.requested_action)} · ${h(x.status)}</strong><p>${h(s.team?.find((p) => p.user_id === x.requester)?.display_name || x.requester)} · ${h(x.created_at)} · requested revision ${h(x.incident_revision)}</p><p>${h(x.explanation)}</p>${x.resolution_reason ? `<p><b>Supervisor response:</b> ${h(x.resolution_reason)} · ${h(s.team?.find((p) => p.user_id === x.resolved_by)?.display_name || x.resolved_by)} · ${h(x.resolved_at)}</p>` : "<p>Pending supervisor decision; incident disposition is unchanged by the request.</p>"}</article>`).join("")}</details>`,
        );
  }
  if (supervisor && view === "supervisor") {
    const requests = (s.disposition_requests || []).filter(
      (x) => x.status === "PENDING",
    );
    if (requests.length)
      root
        .querySelector("#main")
        .insertAdjacentHTML(
          "afterbegin",
          `<section class="panel disposition-requests" data-disposition-ui><h2>Pending incident disposition requests (${requests.length})</h2>${requests.map((x) => `<article data-disposition-request="${h(x.id)}"><h3>${h(s.records.INCIDENT.find((i) => i.incident_id === x.incident_id)?.incident_label || x.incident_id)}</h3><p><b>${h(x.requested_action)}</b> requested by ${h(s.team?.find((p) => p.user_id === x.requester)?.display_name || x.requester)} · ${h(x.created_at)}</p><p>${h(x.explanation)}</p><p>Requested revision ${h(x.incident_revision)} · current ${h(dispositionLabel(dispositionState(s, "incident", x.incident_id), "incident"))}</p><div class="inline"><button data-action="supervisor-detail" data-id="${h(x.incident_id)}">View incident</button><button data-action="disposition-accept-request" data-request-id="${h(x.id)}">Accept request — review decision</button><button data-action="disposition-decline-request" data-request-id="${h(x.id)}">Decline request</button></div></article>`).join("")}</section>`,
        );
  }
  for (const el of root.querySelectorAll("[data-action]")) {
    const lock = actionLock(s, el, current, view);
    if (lock.locked) {
      el.disabled = true;
      el.setAttribute("aria-disabled", "true");
      el.title = lockMessage(lock);
    }
    if (!supervisor && ["complete", "reopen"].includes(el.dataset.action))
      el.disabled = true;
  }
}

export function decisionSummary(s, flow) {
  const fact = s.records.CLAIM.find((c) => c.claim_id === flow.target_id);
  const target =
    flow.target_type === "fact"
      ? fact?.subject
      : s.records.INCIDENT.find((i) => i.incident_id === flow.target_id)
          ?.incident_label;
  const state = dispositionState(s, flow.target_type, flow.target_id);
  const r =
    flow.target_type === "incident"
      ? acceptanceReadiness(s, flow.incident_id)
      : null;
  return `<div class="disposition-summary">${r ? `<p><b>Classification:</b> ${h(r.classification)}</p><p><b>${r.reviewed} reviewed · ${r.waived} waived · ${r.outstanding} outstanding / ${r.total} fact requirements</b></p><p>${r.incident_facts.length} incident facts · ${r.shared_facility_requirements.length} shared facility requirements · ${r.other_requirements.length} other requirements. ${r.tasks.length} nonblocking research tasks.</p><p>Unknown: ${r.unknown.length} · conflicting: ${r.conflicting.length}. Accepted limitations remain visible.</p><details class="secondary-details"><summary>Finding, requirement and task details</summary><ul>${r.facts.map((f) => `<li>${h(f.claim_id)} · ${h(f.subject)} · ${h(f.status)} · ${h(fmt(f.value))} · ${h(f.validation_state)}</li>`).join("")}${r.other_requirements.map((f) => `<li>${h(f.id)} · ${h(f.status)}</li>`).join("")}${r.tasks.map((t) => `<li>${h(t.gap_task_id)} · ${h(t.state)} · ${h(t.question)}</li>`).join("")}</ul><p>Facility limitations: ${h(fmt(r.facility_limitations || []))}</p><p>Requirements assessed: ${r.requirements_assessed ? "Yes" : "No — accepted as recorded"}</p></details>` : ""}<p><b>Target:</b> ${h(flow.target_type)} · ${h(target || flow.target_id)}</p><p><b>Selected action:</b> ${h(flow.action)} · <b>Current disposition:</b> ${h(dispositionLabel(state, flow.target_type))}</p>${fact ? `<p><b>Current finding:</b> ${h(fmt(fact.current_verified_value))} · ${h(fact.validation_state)}</p><p><b>Recorded limitations:</b> ${h(fact.review_notes || fact.open_factual_question || "Inspect the linked evidence and recorded uncertainty below.")}</p>` : ""}${flow.review ? `<div class="callout"><h3>Displayed determination being certified</h3><p>${h(fmt(flow.review.value))} · ${h(flow.review.validation_state)}</p><p>${h(flow.review.review_notes)}</p><p>${h(flow.review.basis_explanation || "")}</p></div>` : ""}<p>${flow.action === "DEFER" ? (flow.target_type === "fact" ? "Fact Defer waives this requirement for completion and output. The finding is not certified, and linked research tasks remain unchanged and nonblocking." : "Incident Defer suspends and excludes the entire incident from validated output.") + " Findings, sources, uncertainty, history and private drafts are retained." : flow.action === "REOPEN" ? "Researcher access resumes subject to other recorded locks. Findings, assignments, evidence, history and private drafts are preserved. Previous completion and Phase 2 approval are not restored." : flow.target_type === "fact" ? "Only the displayed factual determination is certified. Shared changes to this fact are locked until a supervisor reopens it. Unknown and conflicting findings remain as explicitly reviewed." : "Approval accepts the recorded work and limitations, completes this incident and authorizes Phase 2 / validated output in one transaction. Child facts and tasks remain as recorded."}</p></div>`;
}

export function decisionForm(s, flow) {
  return `<form id="disposition-decision-form" class="disposition-flow" data-disposition-ui>${flow.action === "REOPEN" ? "" : "<p>Step 3 of 3 · Reason and attestation</p>"}${decisionSummary(s, flow)}<label>Supervisor ${flow.action === "REOPEN" ? "reopen " : ""}reason<textarea name="disposition_reason" required maxlength="4000"></textarea></label>${flow.action === "REOPEN" ? "" : `<label class="certification-box"><input type="checkbox" name="disposition_attestation" required> ${flow.target_type === "incident" ? "I accept the recorded incident work and limitations for validated output; this does not certify every fact." : "I have reviewed this factual determination and its available evidence."}</label>`}<div class="dialog-actions"><button type="button" data-action="close-dialog">Cancel</button><button class="primary" type="submit" disabled>Submit ${h(flow.action.toLowerCase())}</button></div></form>`;
}

export function updateDecisionSubmit(dialog) {
  const form = dialog.querySelector("#disposition-decision-form");
  if (!form) return;
  const reason = form.elements.disposition_reason.value.trim();
  const attestation = form.elements.disposition_attestation;
  form.querySelector('[type="submit"]').disabled =
    !reason || Boolean(attestation && !attestation.checked);
}
