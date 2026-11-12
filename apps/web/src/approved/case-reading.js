import { h, claims, tasks, taskBucket, evidenceFor } from "./shared.js";
import { evidenceEntries } from "./evidence-presentation.js";

// Current snapshot only. Historical diagnostic conclusions never fill missing facts.
export function caseReading(s, id) {
  const own = claims(s, id).filter(
    (c) =>
      c.incident_id === id &&
      !["IDENTITY", "FACILITY_TYPE"].includes(c.claim_family),
  );
  const items = own.flatMap((c) =>
      evidenceFor(s, c.claim_id).map((p) => ({ claim: c, ...p })),
    ),
    seen = new Set();
  const examples = items.filter((p) => {
    const k = p.claim.claim_id + "|" + p.source.source_id;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return {
    own,
    examples,
    gaps: tasks(s, id).filter(
      (g) => !["resolved", "deferred"].includes(taskBucket(g)),
    ),
  };
}
export function renderCaseReading(s, id) {
  const { own, examples, gaps } = caseReading(s, id);
  const next = gaps[0];
  const related = next?.claim_id ? examples.find(e=>e.claim.claim_id===next.claim_id) : null;
  const guidance = next ? `<p><b>Next question:</b> ${h(next.factual_question)}</p><p>${h(next.next_action || "Open the research task and record the evidence needed.")}</p>${next.reason ? `<details><summary>Why investigate this?</summary><p>${h(next.reason)}</p></details>` : ''}${related ? `<p>Already linked to this question’s fact: <button data-action="source" data-id="${h(related.source.source_id)}" data-claim="${h(related.claim.claim_id)}" data-relation="${h(related.relation.claim_source_id)}">${h(related.source.title)}</button></p>` : '<p class="subtle">The passages above may concern other propositions. Check relevance before linking a source to this question.</p>'}<button data-action="task" data-id="${h(next.gap_task_id)}">Open research task</button><p class="subtle">Record progress and next steps; save privately to continue later. Adding evidence does not resolve the question.</p>` : '<p>No open question is recorded. This does not establish completeness; add a research task when you identify a specific unanswered question.</p>';
  const cards = examples
    .slice(0, 2)
    .map(({ claim, source, relation }) => {
      const entries = evidenceEntries(s, source, relation),
        entry =
          entries.find((x) => !/structured record/i.test(x.label || "")) ||
          entries[0],
        text = entry?.text || "";
      return `<article class="case-evidence-preview"><p><b>${h(claim.subject)}</b></p><p class="subtle">${h(source.title)} · ${h(source.publisher_platform || "Publisher not recorded")} · ${h({ SUPPORTS: "Supports this proposition", CONTRADICTS: "Contradicts this proposition", LIMITS: "Limits this proposition", CONTEXT_ONLY: "Context only; not proof" }[relation.support_direction] || "Relationship needs assessment")}</p><p dir="auto">${h(text ? text.slice(0, 360) + (text.length > 360 ? "…" : "") : "No case-specific passage is saved. Inspect the recorded source and limitations before drawing a conclusion.")}</p><p class="subtle">${h(entry?.label || "Preserved passage or assessment; not newly verified")} · Current factual review remains separate.</p><button data-action="source" data-id="${h(source.source_id)}" data-claim="${h(claim.claim_id)}" data-relation="${h(relation.claim_source_id)}">Read evidence and limitations</button></article>`;
    })
    .join("");
  return `<section id="case-evidence" class="section"><h2>What the sources report</h2>${cards || "<p>No incident-specific evidence relationship is recorded yet. Shared facility identity evidence does not establish an attack or service effect.</p>"}<p class="subtle">${own.length} incident-specific propositions. See all exact relationships on the fact cards below; linked sources are not necessarily independent.</p>${guidance}<details class="secondary-details"><summary>What else might need investigation?</summary><p>Consider identity/location, chronology, event/classification, facility connection, physical damage, operational consequences, closure/restoration/duration, and provenance/corroboration/contradictions. These are reference domains, not eight required tasks. Use a case-specific question only when relevant.</p><p>Not yet assessed does not mean investigated without an answer. Record conflicting evidence and explain genuinely inapplicable questions. Missing damage or closure evidence does not mean either occurred.</p></details></section>`;
}

export function episodeReading(s, id) {
  const { own, examples, gaps } = caseReading(s, id);
  const priority = [
    "KINETIC_EVENT",
    "PHYSICAL_DAMAGE",
    "HUMAN_IMPACT_MEASURE",
    "ATTACK_RELATIONSHIP",
    "ACCESS_DISRUPTION",
    "EVACUATION",
    "FULL_CLOSURE",
    "PARTIAL_CLOSURE",
    "RESTORATION_STATUS",
    "RELOCATION",
  ];
  const scoped = examples.filter((x) =>
    priority.includes(x.claim.claim_family),
  );
  const chosen = scoped
    .slice()
    .sort(
      (a, b) =>
        Number(b.relation.support_direction === "SUPPORTS") -
          Number(a.relation.support_direction === "SUPPORTS") ||
        priority.indexOf(a.claim.claim_family) -
          priority.indexOf(b.claim.claim_family),
    )[0];
  if (chosen)
    return {
      text: `${chosen.source.publisher_platform || chosen.source.title || "The preserved source"} — ${chosen.relation.support_direction === "SUPPORTS" ? "linked reporting" : "unsettled proposition"}: ${chosen.claim.subject}`,
      qualification:
        chosen.relation.support_direction === "CONTEXT_ONLY"
          ? "Background reporting; this relationship does not establish an attack or effect."
          : chosen.relation.support_direction === "CONTRADICTS"
            ? "This source challenges the proposition. Inspect the competing evidence."
            : chosen.relation.support_direction === "LIMITS"
              ? "This source qualifies the proposition; its limits remain part of the review."
              : "Source-linked proposition; available reporting is separate from completed human validation.",
      fact_id: chosen.claim.claim_id,
      source_id: chosen.source.source_id,
    };
  const gap = gaps.find(
    (g) => g.factual_question && !/not.*specified/i.test(g.factual_question),
  );
  return {
    text: gap
      ? `The episode remains unresolved: ${gap.factual_question}`
      : "The saved record does not establish what happened to this facility in this episode. Check the linked facility evidence and establish the event, date and facility effect before drawing a conclusion.",
    qualification: own.length
      ? "Dates or classification alone do not establish an attack or service effect."
      : "Shared facility identity does not establish an episode.",
    fact_id: null,
    source_id: null,
  };
}
