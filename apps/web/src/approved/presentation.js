// Owner-authorized presentation only. No writes, storage, requests or workflow decisions.
// Original renderers, finding values and form/action contracts remain unchanged.
import { claims, eligible, h, factLabel, label } from "./shared.js";
import { episodeReading } from "./case-reading.js";
import { valueText, currentLabLabel, causalFindingState } from "./view-data.js";

const copy = new Map(
  Object.entries({
    "Your next research task is already identified": "My work",
    "My work / incident queue": "Research workspace",
    "Currently recorded incident": "Incident",
    "Current research state": "Review status",
    "Facts needing lab validation": "Needs review",
    "Lab validation": "Review",
    "Current lab validation": "Current review",
    "Lab validation snapshot": "Review progress",
    "Currently recorded work": "Research workspace",
    "Supervisor Work Queue": "Work queue",
    "Currently recorded facilities": "Facilities",
    "Currently recorded incidents": "Incidents",
    "Facilities currently recorded": "Facilities",
    "Incident / context records": "Incidents and context records",
    "Facts reviewed by current lab": "Facts reviewed",
    "Incidents review complete": "Reviews complete",
    "Downstream ready": "Ready for the next stage",
    "Needs lab validation": "Needs review",
    "Needs current lab validation": "Needs review",
    "Reviewed by current lab": "Reviewed",
    "Lab reviewed": "Reviewed",
    "Review complete at current revision": "Review complete",
    "Review reopened — completion revision is not current":
      "Needs review again",
    "Not yet assessed by the lab": "Not assessed",
    "Active / needs checking": "In progress",
    "Needs More Evidence": "Needs more evidence",
    "Not Supported": "Not supported",
    "Not Applicable": "Not applicable",
    "Not Reviewed": "Not reviewed",
    "Current research requirement": "Next step",
    "Research requirement not yet specified":
      "Review the saved evidence and identify the remaining question.",
    "Current lab status": "Task status",
    "Current verified value": "Current finding",
    "Review result and verified value": "Your review",
    "Review notes / limitations": "Review notes and limitations",
    "Reviewer notes / limitations": "Review notes and limitations",
    "Original research value and review provenance":
      "Earlier finding and review history",
    "Earlier value and review history": "Finding and review history",
    "What Still Needs Checking": "What still needs checking",
    "What the evidence currently establishes": "Facts and evidence",
    "Healthcare-service / operational effects": "Effects on services",
    "Restoration & timing": "Recovery and timing",
    "Technical details: sources, history, and record mapping":
      "Record history and references",
    "General + Add evidence": "+ Add evidence for several facts",
    "Add note / context": "Add note",
    "Facility / aliases": "Facility details",
    "View facility / aliases": "Facility details",
    "Facility / identity review": "Facility review",
    "Confirm the physical facility": "Confirm the facility",
    "Known names / aliases:": "Other recorded names:",
    "Currently recorded chronology": "Incident timeline",
    "Recorded task details / previous research disposition":
      "Earlier task history",
    "Completion Readiness": "Ready for approval?",
    "Review completion checklist": "Review approval checklist",
    "Review required / optional work": "Review requirements",
    "All currently recorded work": "All work",
    "Reopened after new evidence": "Reopened",
    "Ready for Phase 2 approval": "Ready for output approval",
    "Approved for Phase 2": "Approved for output",
    "Needs Phase 2 reapproval": "Needs output reapproval",
    "Modeling ready": "Model inputs ready",
    "Phase 2 readiness": "Output readiness",
    "Phase 2 approval": "Output approval",
    "Phase 2 status": "Output approval",
    "Phase 2 brief · derived from current facts": "Research summary",
    "Approval provenance": "Approval history",
    "Read-only / Phase 2 repository": "Approved research",
    "Phase 2 repository": "Approved research",
    "Validated Healthcare Facility Incidents": "Validated incidents",
    "Canonical facility name": "Facility name",
    "URL or preserved identifier": "URL or saved identifier",
    "Review result — what does the evidence show?":
      "What does the evidence show?",
    "Private staged changes": "Your unsent changes",
    "Add review to changes": "Add review to changes",
  }),
);
const labels =
  "h1,h2,h3,th,dt,legend,summary,[data-action],.eyebrow,.pill,.label,.metric>span,.supervisor-metric>span,.fact-context>div>span,.fact-context>div:first-child>b,.fact-state-guidance>p>b";
function rename(root) {
  for (const el of root.querySelectorAll(labels)) {
    if (
      el.closest(
        ".source-card,.source-metadata,.fact-proposition,[data-form-claims],[data-manual-records]",
      )
    )
      continue;
    if (el.children.length) continue;
    const next = copy.get(el.textContent.trim());
    if (next) el.textContent = next;
  }
  // Replace only the direct label text; never remove an input or its association.
  for (const el of root.querySelectorAll("label"))
    for (const n of el.childNodes)
      if (n.nodeType === 3) {
        const t = n.textContent.trim(),
          next = copy.get(t);
        if (next) n.textContent = n.textContent.replace(t, next);
      }
  for (const select of root.querySelectorAll(
    '[name="validation_state"],[name="task_disposition"],[data-supervisor-filter],[data-phase2-filter]',
  ))
    for (const option of select.options) {
      const next = copy.get(option.textContent.trim());
      if (next) option.textContent = next;
    }
}
function details(doc, title, cls = "polish-details") {
  const el = doc.createElement("details");
  el.className = cls;
  const summary = doc.createElement("summary");
  summary.textContent = title;
  el.append(summary);
  return el;
}
function foldNodes(nodes, title, cls) {
  const available = nodes.filter(Boolean);
  if (!available.length) return null;
  const d = details(available[0].ownerDocument, title, cls);
  available[0].before(d);
  for (const node of available) d.append(node);
  return d;
}
function incidentOverview(root, s, id) {
  const body = root.querySelector(".brief-body");
  if (!body || root.querySelector("[data-consolidated-overview]") || body.querySelector(".polish-overview")) return;
  const doc = body.ownerDocument,
    all = claims(s, id),
    record = s.records.INCIDENT.find((i) => i.incident_id === id);
  const dimensions = body.querySelector(":scope>.facts"),
    heading = [...body.children].find(
      (el) => el.tagName === "H2" && el.textContent === "Review status",
    );
  if (!dimensions || !heading) return;
  const firstHeading = [...body.children].find(
    (el) => el.tagName === "H2" && el.textContent === "What happened",
  );
  const originalDescription = firstHeading?.nextElementSibling;
  const originalDates = root.querySelector(".brief-head>div>p");
  const historic = details(
    doc,
    "Research details and earlier findings",
    "secondary-details polish-record-details",
  );
  dimensions.before(historic);
  historic.append(dimensions);
  if (originalDescription) {
    historic.append(originalDescription);
    const description = doc.createElement("p");
    description.textContent = episodeReading(s, record?.incident_id).text;
    description.dataset.episodeSummary = "true";
    const qualification = doc.createElement("p");
    qualification.className = "subtle";
    qualification.textContent = episodeReading(
      s,
      record?.incident_id,
    ).qualification;
    firstHeading.after(description, qualification);
  }
  if (originalDates) historic.append(originalDates);
  heading.remove();
  body.querySelector('[data-guidance="incident-brief-purpose"]')?.remove();
  const explanatory = [...body.children].find(
    (el) =>
      el.tagName === "P" && el.textContent.startsWith("Preserved findings are"),
  );
  if (explanatory) historic.append(explanatory);
  const families = new Set([
    "KINETIC_EVENT",
    "ATTACK_RELATIONSHIP",
    "PHYSICAL_DAMAGE",
    "HUMAN_IMPACT_MEASURE",
    "EVACUATION",
    "FULL_CLOSURE",
    "PARTIAL_CLOSURE",
    "DEPARTMENT_OR_SERVICE_SHUTDOWN",
    "REDUCED_CAPACITY",
    "PATIENT_TRANSFER",
    "UTILITY_LOSS",
    "ACCESS_DISRUPTION",
    "RELOCATION",
    "ATTACK_TO_EFFECT_CAUSATION",
  ]);
  const relevant = all.filter((c) => families.has(c.claim_family));
  const supports = (c) =>
    c.claim_family === "ATTACK_TO_EFFECT_CAUSATION"
      ? causalFindingState(s, c).supported
      : eligible(c, s);
  const supported = relevant.filter(supports),
    unclear = relevant.filter(
      (c) => !supports(c) && c.validation_state !== "NOT_APPLICABLE",
    );
  const finding = (c) =>
    `<li><b>${h(factLabel(c))}</b><span>${h(valueText(c))}</span><small>${h(c.subject)} · ${h(copy.get(currentLabLabel(s, c)) || currentLabLabel(s, c))}</small></li>`;
  const uncertain = (c) =>
    `<li><b>${h(factLabel(c))}</b><span>${h(c.claim_family === "ATTACK_TO_EFFECT_CAUSATION" ? causalFindingState(s, c).value_text : s.workflow?.claims?.[c.claim_id]?.review_needed ? "Needs review again" : label(c.validation_state))}</span><small>${h(c.subject)}</small></li>`;
  const list = (items, renderer, empty) =>
    items.length
      ? `<ul class="polish-findings">${items.slice(0, 4).map(renderer).join("")}</ul>${items.length > 4 ? `<details class="polish-details"><summary>${items.length - 4} more findings</summary><ul class="polish-findings">${items.slice(4).map(renderer).join("")}</ul></details>` : ""}`
      : `<p class="subtle">${empty}</p>`;
  const overview = doc.createElement("div");
  overview.className = "polish-overview";
  overview.innerHTML = `<section aria-labelledby="polish-supported"><h2 id="polish-supported">What is supported</h2><p class="subtle">Recorded support is separate from current review.</p>${list(supported, finding, "No human-validated finding is established in these dimensions yet. See the source-linked proposals below; available reporting is not completed human validation.")}</section><section aria-labelledby="polish-unclear"><h2 id="polish-unclear">What remains unclear</h2>${list(unclear, uncertain, "No answer is recorded in these dimensions yet. Inspect the saved sources and current research questions; missing evidence does not mean that no effect occurred.")}</section>`;
  historic.before(overview);
  const attention = body.querySelector(".attention");
  if (attention) {
    attention.classList.add("polish-review-needed");
    const title = attention.querySelector("strong");
    if (title) {
      title.textContent = "Needs review";
      const h2 = doc.createElement("h2");
      h2.textContent = title.textContent;
      title.replaceWith(h2);
    }
    for (const n of attention.childNodes)
      if (n.nodeType === 3)
        n.textContent = n.textContent.replace(
          "facts need current lab validation.",
          "facts need review.",
        );
    overview.after(attention);
  }
  const next = body.querySelector(".next-box");
  if (next) attention?.after(next);
}
function factDetails(root) {
  if (root.querySelector("[data-research-layout=consolidated]")) return;
  for (const card of root.querySelectorAll(".fact-card")) {
    const review = card.querySelector(".fact-context>div:first-child");
    if (review && !review.querySelector(".polish-details"))
      foldNodes([...review.querySelectorAll(":scope>small")], "Review details");
    const evidence = card.querySelector(".fact-context>div:nth-child(2)");
    if (evidence && !evidence.querySelector(".polish-details"))
      foldNodes(
        [...evidence.querySelectorAll(":scope>small")],
        "About these sources",
      );
  }
}
function reviewDetails(root) {
  const context = root.querySelector(".fact-state-guidance");
  if (context && !context.querySelector(".polish-details")) {
    const original = context.querySelector(":scope>p");
    const status = original?.textContent
      .replace(/^Current (lab validation|review):\s*/, "")
      .split(" · ")[0]
      .trim();
    const extra = foldNodes(
      [original, context.querySelector('[data-guidance="fact-human-review"]')],
      "Review background",
    );
    if (status && extra) {
      const p = original.ownerDocument.createElement("p");
      p.innerHTML = "<b>Current review:</b> " + h(copy.get(status) || status);
      extra.before(p);
    }
  }
  const task = root.querySelector(".task-guidance");
  if (task && !task.closest(".polish-details"))
    foldNodes([task], "What to check");
  const completion = root.querySelector(".completion-states");
  if (completion && !completion.closest(".polish-details"))
    foldNodes(
      [
        completion,
        root.querySelector('[data-guidance="incident-completion-meaning"]'),
      ],
      "About incident approval",
    );
  for (const span of root.querySelectorAll(".dialog-actions>span"))
    if (
      span.textContent.trim() ===
      "Private proposal until you review and submit."
    )
      span.textContent = "Not shared until you submit.";
}
function outputDetails(root) {
  const output = root.querySelector("#validated-incidents");
  if (!output || output.querySelector(".polish-output-details")) return;
  const original = output.querySelector(":scope>.callout");
  if (original) {
    const note = original.ownerDocument.createElement("p");
    note.className = "callout";
    note.innerHTML =
      "<b>Approved research.</b> Findings reflect current facts. Unknown stays unknown.";
    original.before(note);
    foldNodes(
      [original, output.querySelector(":scope>.subtle.section")],
      "About approved research and future use",
      "polish-details polish-output-details",
    );
  }
  for (const p of output.querySelectorAll("[data-phase2-empty] p"))
    if (
      p.textContent.startsWith(
        "No incidents have been approved for Phase 2 yet.",
      )
    )
      p.textContent = "Incidents appear here after a supervisor approves them.";
}
export function polishPresentation(root, s = null, current = null) {
  root.classList.add("human-polish");
  rename(root);
  const firstReview = root.querySelector('[data-day-one="true"]');
  if (
    firstReview?.textContent.startsWith(
      "No current-lab validation has yet occurred.",
    )
  )
    firstReview.innerHTML =
      "<b>Reviews have not started.</b> Earlier findings do not count as current review.";
  if (s && current) incidentOverview(root, s, current);
  factDetails(root);
  reviewDetails(root);
  outputDetails(root);
  for (const li of root.querySelectorAll(
    "#supervisor-hub .supervisor-queue-table li",
  ))
    if (/^\d+ facts need lab validation$/.test(li.textContent.trim()))
      li.textContent = li.textContent.replace(
        "facts need lab validation",
        "facts need review",
      );
  const counts = root.querySelector(".supervisor-secondary-counts");
  if (counts && !counts.closest(".polish-details"))
    foldNodes(
      [counts, root.querySelector(".supervisor-phase2-counts")],
      "More review and task counts",
    );
  // Explanatory reference text stays available; actions and safeguards stay prominent.
  const footer = root.querySelector(".footer");
  if (footer && !footer.querySelector("details")) {
    const content = footer.ownerDocument.createElement("div");
    while (footer.firstChild) content.append(footer.firstChild);
    const d = details(footer.ownerDocument, "Historical reference baseline");
    d.append(content);
    footer.append(d);
  }
}
