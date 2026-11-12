import { h } from "./shared.js";

export const domains = [
  "Identity/location",
  "Chronology",
  "Event/classification",
  "Facility connection",
  "Physical damage",
  "Operational effects",
  "Closure/restoration/duration",
  "Provenance/dependence",
];
export const coverageLabels = {
  DOCUMENTED: "Documented",
  UNKNOWN: "Unknown",
  DISPUTED: "Conflicting evidence",
  NOT_YET_RESEARCHED: "Not yet researched",
  NOT_APPLICABLE: "Not applicable",
  NOT_YET_AUDITED: "Not yet audited",
};
export function coverageFor(id, coverageReference = {}) {
  return (
    coverageReference[id]?.domains ||
    domains.map((domain) => ({
      domain,
      status: "NOT_YET_AUDITED",
      basis: "This case has not had an eight-domain documentation audit.",
      limitation:
        "Recorded facts and tasks do not establish complete research coverage.",
      next: "Inspect the existing facts and sources before deciding what needs further research.",
      facts: "",
      sources: "",
      references: [],
    }))
  );
}
export function suggestedGuidance(id, coverageReference = {}) {
  return coverageReference[id]?.next || "";
}
export function coverageSummary(id, coverageReference = {}) {
  const rows = coverageFor(id, coverageReference),
    gaps = rows.filter(
      (x) => !["DOCUMENTED", "NOT_APPLICABLE"].includes(x.status),
    );
  return `${gaps.length} of 8 domains need clarification or assessment`;
}
export function renderCoverage(s, id) {
  const coverageReference = s.diagnostic_reference || {};
  const reference = coverageReference[id],
    own = (s.records?.CLAIM || []).filter(
      (c) => c.incident_id === id && c.is_current !== false,
    ).length;
  const sourceIds = new Set((s.records?.SOURCE || []).map((x) => x.source_id));
  return `<section class="section evidence-coverage" id="evidence-coverage" aria-labelledby="coverage-title"><h2 id="coverage-title">Dated diagnostic reference</h2><p>${h(coverageSummary(id, coverageReference))}. ${own} incident-specific facts recorded. Shared facility facts alone do not establish this episode.</p><p class="subtle">Documentation reference · Amendment 01, 9 October 2026. This is not factual validation or a live completeness score. Later research may require reassessment.</p>${own <= 1 ? '<p class="callout">This case has few incident-specific facts. Review the current facts, sources and questions; an empty task list does not mean the research is complete.</p>' : ""}<div class="coverage-grid">${coverageFor(
    id,
    coverageReference,
  )
    .map(
      (d) =>
        `<details class="coverage-domain" data-domain="${h(d.domain)}" data-coverage="${h(d.status)}"><summary><strong>${h(d.domain)}</strong><span class="pill ${d.status === "DISPUTED" ? "conflicting" : d.status === "DOCUMENTED" ? "historical" : "unknown"}">${h(coverageLabels[d.status])}</span></summary><p dir="auto">${h(d.basis)}</p><p dir="auto"><b>Limit:</b> ${h(d.limitation)}</p><p><b>Next check:</b> ${h(d.next)}</p><details><summary>Supporting references and scope</summary><p>Facts: ${h(d.facts || "No dedicated canonical proposition cited")}. Sources: ${h(d.sources || "No source cited")}.</p><p>${h(d.basisKind || "Diagnostic reference only")}. Citations here do not add or change fact–source relationships.</p>${(d.references || []).map((ref) => `<p>${sourceIds.has(ref.id) ? `<button data-action="source" data-id="${h(ref.id)}">${h(ref.title || ref.id)}</button>` : h(ref.title || ref.id)}<br><small>${h(ref.id)} · ${h(ref.layer)}${!sourceIds.has(ref.id) ? " · historical reference, not a current source record" : ""}</small></p>`).join("")}</details></details>`,
    )
    .join(
      "",
    )}</div>${reference ? `<details class="secondary-details"><summary>Case-specific research guidance and intake limitations</summary><p>${h(reference.assessment)}</p><p><b>Suggested next work:</b> ${h(reference.next)}</p><p>Diagnostic intake recommendation: ${h(reference.recommendation)}. This is not supervisor approval. PHC population decisions remain explicit; March 2 is inclusive in the local proposal only.</p></details>` : ""}<details class="secondary-details"><summary>What the coverage labels mean</summary><p>Documented: a scoped proposition or evidenced research outcome is recorded; it may be partial or unreviewed. Unknown: the evidence leaves an investigated question unresolved. Conflicting evidence: competing accounts need assessment. Not yet researched: no evidenced domain outcome was found in the audited material. Not applicable: a case-specific reason explains why this domain does not apply. Not yet audited: no diagnostic assessment is available.</p><p>No automatic task, factual review, certification or incident completion is created by these labels.</p></details></section>`;
}
