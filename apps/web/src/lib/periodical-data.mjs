import { factWaived } from "../../../../packages/domain/src/acceptance-policy.js";
import { incidentPassages, relationship } from "../approved/evidence-presentation.js";
import { locationPresentation } from "../approved/geography.js";
import { phase2Approval, phase2Eligible } from "../approved/phase2-state.js";
import { currentEvidence, effectiveSource, FAMILIES, fmt, label, recordType } from "../approved/shared.js";
import { casualtyType, currentGeographicReview, currentSupportedFact, periodicalFactReviewState, physicalIdentity } from "./periodical-scope.mjs";
import { reviewedGeographicAuthority } from "../../../../packages/domain/src/facility-geography.mjs";
import { isDirectlyReportedDuration } from "../approved/timing.js";
import { historicalLocationProvenance } from "./periodical-location-provenance.mjs";

const periodicalHeaders = [
  "Facility", "Event ID", "Incident date", "Incident date citations",
  "Facility identity", "Facility identity citations", "Closure duration", "Closure duration citations",
  "Facility coordinates", "Facility coordinates citations", "Casualties", "Casualties citations",
];
export const periodicalScope = "Internal lab snapshot · Includes research in progress";

const missing = "Not recorded";
const validated = "Validated";
const known = value => value !== null && value !== undefined && value !== "";
const sortById = key => (a, b) => a[key].localeCompare(b[key], "en");
const recordedText = value => known(value) ? fmt(value) : missing;
const joinDetails = entries => entries.filter(Boolean).join(" · ");

function component(title, value, status, citations, summary = value) {
  return { title, value, status, citations, summary };
}

function pair(components) {
  if (!components.length) components = [component("", missing, missing, [])];
  /** @type {"validated" | "attention"} */
  const status = components.every(item => item.status === validated) ? "validated" : "attention";
  return [
    { status, findings: components, text: components.map(item => findingText(item)).join("\n") },
    { status, text: components.map(item =>
      findingText(item, item.citations.length ? item.citations.map(citation => citation.text).join("\n") : "No linked citation recorded"),
    ).join("\n\n") },
  ];
}

export function findingText(item, value = item.value) {
  return `[${item.status}] ${item.title ? fmt(item.title) + " · " : ""}${value}`;
}

function publicSourceUrl(source) {
  for (const value of [source.original_url, source.canonical_url]) {
    try {
      const parsed = new URL(value);
      const credentials = [...parsed.searchParams.keys()].some(key =>
        /^(?:token|access_token|api_?key|signature|sig|x-amz-.*|x-goog-.*|x-vercel-protection-bypass)$/i.test(key),
      );
      if (["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password && !credentials)
        return value;
    } catch {
      // Some archived source records preserve identifiers instead of URLs.
    }
  }
  return null;
}

function citationPublication(source) {
  const date = typeof source?.publication_date === "object" ? source.publication_date?.value : source?.publication_date;
  return date ? recordedText(date) : "";
}

function citationRecord(source, direction, text, active = true, relationshipCode = "") {
  return {
    text, direction, active, relationshipCode,
    title: source?.title || "Source title not recorded", sourceId: source?.source_id,
    publisher: source?.publisher_platform, published: citationPublication(source),
    url: source ? publicSourceUrl(source) : null,
  };
}

function citationText(source, role, humanAdded, details = [], origin = source?.source_discovery_origin) {
  if (!source) return joinDetails([role, ...details]);
  const publication = citationPublication(source);
  const precision = source.publication_date?.precision;
  const provenance = origin && !/unknown|not[_ ]recorded/i.test(origin)
    ? "Discovery " + label(origin) : null;
  return joinDetails([
    role, source.title || "Source title not recorded", source.publisher_platform,
    publication && "Published " + recordedText(publication) + (precision && precision !== "DAY" ? " (" + label(precision) + ")" : ""),
    publicSourceUrl(source) || "Source URL not available",
    provenance, (humanAdded.has(source.source_id) || source.human_addition_audit === true) && "Human addition recorded",
    source.historical_source_id && "Historical source record",
    source.source_id && "Source ID " + source.source_id,
    ...details,
  ]);
}

function recordedPassages(snapshot, source, relation) {
  const saved = incidentPassages(snapshot, source, relation);
  const locators = Array.isArray(relation.evidence_locator) ? relation.evidence_locator : [];
  const passages = saved.map(({ text, kind, locator }) => {
    const paraphrase = /(?:paraphras|not (?:a )?(?:verbatim|quotation))/i.test(
      [kind === "excerpt" ? text : "", relation.excerpt_kind, relation.passage_kind,
        locators.find(item => item?.locator === locator)?.kind].filter(Boolean).join(" "),
    );
    const names = {
      source: "Saved verbatim excerpt", excerpt: "Saved excerpt",
      observation: "Recorded observation or paraphrase", assessment: "Recorded assessment",
      structured: "Saved source record",
    };
    const heading = paraphrase ? "Recorded paraphrase" : names[kind] || "Saved passage";
    return heading + (locator ? " (" + locator + ")" : "") + ": " + text;
  });
  // Preserve unmatched locators even when another locator has an excerpt.
  for (const entry of locators) {
    if (entry?.locator && !saved.some(passage => passage.locator === entry.locator))
      passages.push("Locator: " + entry.locator);
  }
  if (snapshot.periodicalSelection?.scope === "verified") return passages;
  if (!passages.length) {
    const sourceLocations = Array.isArray(source.evidence_locator) ? source.evidence_locator : [];
    for (const entry of sourceLocations) if (entry?.locator) passages.push("Source locator: " + entry.locator);
  }
  const sourceExcerpt = source.source_recorded_excerpt || source.content_preservation_status?.excerpt;
  if (sourceExcerpt && !saved.some(entry => entry.text === sourceExcerpt))
    passages.push("Saved source excerpt: " + sourceExcerpt);
  if (source.recorded_historical_paraphrase)
    passages.push("Historical paraphrase: " + source.recorded_historical_paraphrase);
  const sourceDescription = source.source_recorded_description || source.content_preservation_status?.description;
  if (sourceDescription && !saved.some(entry => entry.text === sourceDescription))
    passages.push("Recorded source description: " + sourceDescription);
  return passages;
}

export function findingStatus(snapshot, eventId, claim) {
  if (claim.correction_withdrawn === true) return "Withdrawn";
  if (claim.is_current === false) return "Superseded finding";
  if (claim.validation_state === "CONFLICTING") return "Disputed";
  if (factWaived(snapshot, claim.claim_id, eventId) ||
      snapshot.dispositions?.facts?.[claim.claim_id]?.state === "DEFERRED") return "Deferred";
  const state = periodicalFactReviewState(snapshot, claim);
  if (state === "REOPENED") return "Review reopened or superseded";
  const outcome = ({ NOT_SUPPORTED: "Not supported", NEEDS_MORE_EVIDENCE: "Needs more evidence", NOT_APPLICABLE: "Not applicable" })[claim.validation_state];
  if (state === "REVIEWED" && outcome) return outcome;
  if (!known(claim.current_verified_value)) return missing;
  if (currentSupportedFact(snapshot, eventId, claim)) return validated;
  if (claim.validation_state === "SUPPORTED" && ["YES", true].includes(claim.individual_human_factual_adjudication))
    return "Historical review · current validation pending";
  return outcome || "Unverified";
}

function recordedReviewer(snapshot, id) {
  const display = snapshot.team?.find(person => person.user_id === id)?.display_name;
  return typeof display === "string" && display.trim() && !/@|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(display) ? display.trim() : null;
}

const recordedTime = value => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;

function factComponent(snapshot, eventId, claim, evidence, title = claim.subject, value = claim.current_verified_value, status) {
  const id = claim.claim_id;
  const links = evidence.links.get(id) ?? [];
  const review = snapshot.workflow?.claims?.[id];
  const reviewer = recordedReviewer(snapshot, review?.lab_reviewed_by);
  const time = recordedTime(review?.lab_reviewed_at ?? claim.reviewed_at);
  const reviewDetails = joinDetails([
    "Fact ID " + id, known(snapshot.revisions?.CLAIM?.[id]) && "Revision " + snapshot.revisions.CLAIM[id],
    known(review?.lab_reviewed_claim_revision) && "Review revision " + review.lab_reviewed_claim_revision,
    time && (reviewer ? "Reviewed by " + reviewer + " · " + time : "Review recorded " + time),
    claim.validation_origin && "Origin " + label(claim.validation_origin),
    (claim.ai_original_recorded === true || known(claim.ai_original_value)) && "AI research provenance recorded",
    claim.intake_origin && "Intake " + label(claim.intake_origin),
    claim.individual_human_factual_adjudication === true && "Individual human adjudication recorded",
    claim.value_authority_type && "Value authority " + label(claim.value_authority_type),
    recordedTime(claim.value_authority_date) && "Authority date " + claim.value_authority_date,
  ]);
  const citations = links.map(relation => {
    evidence.coveredEvidence.add(relation.claim_source_id);
    const source = effectiveSource(evidence.sources.get(relation.source_id), relation);
    const state = currentEvidence(relation) ? relationship(relation.support_direction)[0]
      : "Inactive relationship · " + relationship(relation.support_direction)[0];
    const text = "Fact ID " + id + " · Evidence ID " + relation.claim_source_id + " · " + citationText(
      source, state, evidence.humanAdded, [
        !source && "Source unavailable · Source ID " + relation.source_id,
        known(snapshot.revisions?.CLAIM_SOURCE?.[relation.claim_source_id]) && "Link revision " + snapshot.revisions.CLAIM_SOURCE[relation.claim_source_id],
        recordedTime(relation.review_recorded_at) && "Link review recorded " + relation.review_recorded_at,
        ...(source ? recordedPassages(snapshot, source, relation) : recordedPassages(snapshot, {}, relation)),
      ], relation.source_discovery_origin ?? source?.source_discovery_origin,
    );
    return { ...citationRecord(source, state, text, currentEvidence(relation), relation.support_direction),
      evidenceId: relation.claim_source_id };
  });
  evidence.coveredFacts.add(id);
  return {
    ...component(title, recordedText(value) + "\n" + reviewDetails,
      status ?? findingStatus(snapshot, eventId, claim), citations, recordedText(value)),
    claimId: id, subject: claim.subject, family: claim.claim_family,
    reviewState: periodicalFactReviewState(snapshot, claim),
    reviewOutcome: claim.validation_state,
    citationStatus: snapshot.periodicalSelection?.scope === "verified" && !citations.length
      ? "No verified citation available" : null,
    hasRecordedValue: known(claim.current_verified_value),
    aiOrigin: claim.ai_original_recorded === true || known(claim.ai_original_value),
    current: claim.is_current !== false && claim.correction_withdrawn !== true,
  };
}

function durationFinding(snapshot, eventId, claim, evidence) {
  if (!isDirectlyReportedDuration(claim))
    return factComponent(snapshot, eventId, claim, evidence, claim.subject,
      known(claim.current_verified_value) ? "Unresolved · Recorded duration candidate " + recordedText(claim.current_verified_value) + (claim.quantitative_unit ? " " + claim.quantitative_unit : "") : null,
      "Unresolved");
  const value = joinDetails([
    known(claim.current_verified_value) && joinDetails([recordedText(claim.current_verified_value), claim.quantitative_unit]),
    claim.date_precision && "Precision " + label(claim.date_precision),
    claim.duration_precision && "Duration precision " + label(claim.duration_precision),
    "Source-reported",
  ]);
  return factComponent(snapshot, eventId, claim, evidence, claim.scope ?? claim.effect_scope ?? claim.subject,
    known(claim.current_verified_value) ? value : null);
}

export function recordedLocation(snapshot, facility) {
  const selected = facility.location_review?.coordinates ? facility.location_review : facility.geo;
  const point = selected?.coordinates ?? selected;
  if (!Number.isFinite(point?.latitude) || !Number.isFinite(point?.longitude) ||
      Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180)
    return { status: missing, point: null, selected };
  const review = locationPresentation(snapshot, facility);
  const status = review.pendingProposal ? "Pending geographic review"
    : review.current && selected === review.reviewed && review.reviewed?.state === "SUPPORTED" && !review.reviewed.coordinate_rejected ? validated
    : facility.location_review_state ? label(facility.location_review_state) + " · No current validation" : review.status;
  return { status, point, selected };
}

function locationComponent(snapshot, facility, sources, humanAdded) {
  const verified = snapshot.periodicalSelection?.scope === "verified";
  const { status, point, selected } = recordedLocation(snapshot, facility);
  if (!point) return component(facility.canonical_name, missing, missing, []);
  const historical = historicalLocationProvenance(snapshot, facility, sources);
  const sourceId = selected.source_id || selected.source || historical?.sourceId;
  const approvedSourceId = verified ? reviewedGeographicAuthority(snapshot, facility)?.source_id : sourceId;
  const source = sources.get(approvedSourceId);
  const sourceLocations = Array.isArray(source?.evidence_locator) ? source.evidence_locator : [];
  const locators = sourceLocations.flatMap(entry => {
    const location = entry.locator ? " (" + entry.locator + ")" : "";
    if (entry.excerpt) return ["Saved source excerpt" + location + ": " + entry.excerpt];
    if (entry.description) return ["Recorded observation" + location + ": " + entry.description];
    return entry.locator ? ["Source locator: " + entry.locator] : [];
  });
  const associated = (verified ? [] : facility.location_evidence || []).filter(entry =>
    entry.scope === "location" && entry.source_id === sourceId &&
    entry.location?.coordinates?.latitude === point.latitude && entry.location?.coordinates?.longitude === point.longitude,
  );
  for (const entry of associated) locators.push(...recordedPassages(snapshot, source || {}, entry.relation || entry));
  if (!verified && selected.source_evidence_version) locators.push("Source version: " + selected.source_evidence_version);
  if (!verified && typeof selected.locator === "string") locators.push("Locator: " + selected.locator);
  if (historical?.limitations) locators.push("Working-point limitations: " + historical.limitations);
  const locatorDetails = [...new Set(locators)];
  const relationshipLabel = historical ? "Historical source for working coordinates" : "Facility coordinate source";
  const citations = source || locatorDetails.length || !verified && sourceId
    ? [citationRecord(source, relationshipLabel, citationText(source, relationshipLabel, humanAdded, [
        !source && typeof sourceId === "string" && "Recorded source reference: " + sourceId,
        ...locatorDetails,
      ]))] : [];
  const coordinate = point.latitude + ", " + point.longitude;
  const finding = component(facility.facility_id, joinDetails([
    "Facility coordinates " + coordinate,
    point.crs || historical?.crs, (selected.precision ?? point.precision) && "Precision " + label(selected.precision ?? point.precision),
    selected.method && "Method " + selected.method,
    recordedTime(selected.reviewed_at) && "Review recorded " + selected.reviewed_at,
  ]), status, citations, coordinate);
  return { ...finding, citationStatus: verified && !citations.length ? "No verified citation available" : null };
}

export { casualtyType } from "./periodical-scope.mjs";

function casualties(snapshot, eventId, facts, evidence) {
  const verified = snapshot.periodicalSelection?.scope === "verified";
  const measurements = facts.map(claim => ({ claim, type: casualtyType(claim) })).filter(item => item.type);
  return ["Deaths", "Injuries", "Combined or unspecified"].flatMap(type => {
    const selected = measurements.filter(item => item.type === type);
    if (!selected.length) return verified || type === "Combined or unspecified" ? [] : [component(type, missing, missing, [])];
    return selected.map(({ claim }) => {
      const value = claim.current_verified_value;
      const scope = claim.scope ?? claim.effect_scope ?? claim.subject;
      return factComponent(snapshot, eventId, claim, evidence, type + (scope ? " · " + recordedText(scope) : ""),
        known(value) ? joinDetails([recordedText(value), claim.quantitative_unit, claim.impact_basis]) : null,
        type === "Combined or unspecified" ? "Scope unresolved" : undefined);
    });
  });
}

export function* workspaceEvents(snapshot, checkBudget = () => {}) {
  const { records } = snapshot;
  const byEvent = new Map();
  for (const link of records.INCIDENT_FACILITY) {
    if (link.is_current === false) continue;
    const links = byEvent.get(link.incident_id) || [];
    links.push(link);
    byEvent.set(link.incident_id, links);
  }
  const byFacility = new Map(records.FACILITY.map(facility => [facility.facility_id, facility]));
  for (const event of [...records.INCIDENT].sort(sortById("incident_id"))) {
    checkBudget();
    const links = byEvent.get(event.incident_id) || [];
    const ids = new Set(links.map(link => link.facility_id));
    const facilities = [...ids].map(id => byFacility.get(id)).filter(Boolean).sort(sortById("facility_id"));
    yield { event, links, facilities, ids };
  }
}

function eventDateFallback(event) {
  const start = event.event_start;
  const end = event.event_end;
  if (!known(start) && !known(end)) return missing;
  return known(end) && end !== start ? fmt({ start, end }) : recordedText(start);
}

const facilityName = facility => facility.canonical_name || facility.aliases?.find(alias => alias.value)?.value || missing;

const familyHeaders = {
  FACILITY_TYPE: "Facility type", IDENTITY: "Other identity findings", ACTOR_ATTRIBUTION: "Reported actor",
  ATTACK_RELATIONSHIP: "Direct or nearby effects", KINETIC_EVENT: "Attack occurrence",
  HUMAN_IMPACT_MEASURE: "Other human effects", RESTORATION_DATE: "Restoration date",
};

export function reviewStatus(snapshot, event) {
  const id = event.incident_id;
  if (event.is_current === false) return "Archived or superseded event";
  if (phase2Eligible(snapshot, id) || (snapshot.saved_periodical_capture === true && event.output_eligible === true)) return "Current validated output";
  const rawDisposition = snapshot.dispositions?.incidents?.[id]?.state || event.disposition;
  if (rawDisposition === "DEFERRED") return "Deferred";
  if (phase2Approval(snapshot, id)?.status === "APPROVED" || event.approval_status === "APPROVED") return "Needs reapproval";
  const workflow = snapshot.workflow?.incidents?.[id]?.status || event.workflow_status;
  return workflow && !["active", "in_progress", "not_started"].includes(workflow) ? label(workflow) + " · Pending output approval" : "In progress";
}

function detailValue(claim) {
  if (!known(claim.current_verified_value)) return null;
  return joinDetails([
    recordedText(claim.current_verified_value), claim.quantitative_unit,
    claim.date_precision && "Precision " + label(claim.date_precision),
    claim.impact_basis && "Basis " + label(claim.impact_basis),
    (claim.scope ?? claim.effect_scope) && "Scope " + fmt(claim.scope ?? claim.effect_scope),
  ]);
}

function reportHeadings(populatedFamilies, simplified) {
  const headings = [...periodicalHeaders, "Facility ID", "Record type", "Review status", "Snapshot date", "Export scope",
    "Event title", "Working classification", "Recorded event timing", "Study eligibility", "Facility locality", "Affected component", "Affected component citations"];
  if (simplified) return headings;
  for (const family of populatedFamilies) {
    const title = familyHeaders[family] || FAMILIES[family] || label(family);
    headings.push(title, title + " citations");
  }
  return headings;
}

function linkedFacility(facility, links) {
  const states = [...new Set(links.filter(link => link.facility_id === facility.facility_id && link.facility_match_state)
    .map(link => label(link.facility_match_state)))];
  const value = joinDetails([facilityName(facility), "Workspace facility ID " + facility.facility_id,
    states.length && "Event association " + states.join(", ")]);
  return component("Linked facility in the workspace", value, "Separate identity finding unavailable", [], "Linked facility recorded");
}

export function periodicalReport(snapshot, { snapshotDate = "", scope = periodicalScope, checkBudget = () => {} } = {}) {
  const { periodicalSelection, records } = snapshot;
  const verified = periodicalSelection?.scope === "verified";
  const simplified = periodicalSelection?.report === "simplified";
  const sources = new Map(records.SOURCE.map(source => [source.source_id, source]));
  const humanAdded = new Set((records.ACTIVITY_LOG || []).filter(entry =>
    entry.entity_type === "SOURCE" && entry.action_type === "create" &&
    ["researcher", "supervisor"].includes(entry.actor_role),
  ).map(entry => entry.entity_id));

  const links = new Map();
  for (const relation of [...records.CLAIM_SOURCE].sort(sortById("claim_source_id"))) {
    const entries = links.get(relation.claim_id) || [];
    entries.push(relation);
    links.set(relation.claim_id, entries);
  }
  const evidence = { sources, humanAdded, links, coveredFacts: new Set(), coveredEvidence: new Set() };
  const families = new Set();
  const prepared = Array.from(workspaceEvents(snapshot, checkBudget), ({ event, facilities, ids, links }) => {
    const id = event.incident_id;
    const selection = periodicalSelection?.factsByEvent?.get(id);
    const facts = records.CLAIM.filter(claim => (claim.incident_id === id || (!claim.incident_id && ids.has(claim.facility_id))) &&
      (!selection || selection.has(claim.claim_id))).sort(sortById("claim_id"));
    const dateClaims = facts.filter(claim => claim.claim_family === "EVENT_DATE");
    const dates = dateClaims.map(claim => factComponent(snapshot, id, claim, evidence, claim.subject, detailValue(claim)));
    if (!verified && !dateClaims.some(claim => known(claim.current_verified_value)) && (known(event.event_start) || known(event.event_end)))
      dates.push(component("Recorded episode date", joinDetails([
        eventDateFallback(event),
        "Precision " + label(event.date_precision || "Unknown"),
      ]), "Unverified", []));
    const identityClaims = facts.filter(claim => physicalIdentity(claim, ids));
    const identities = identityClaims.map(claim => factComponent(snapshot, id, claim, evidence));
    if (!verified && !identityClaims.some(claim => known(claim.current_verified_value)))
      identities.unshift(...facilities.map(facility => linkedFacility(facility, links)));
    const durationClaims = facts.filter(claim => claim.claim_family === "RESTORATION_DATE" && claim.value_type === "QUANTITATIVE");
    const durations = durationClaims.map(claim => durationFinding(snapshot, id, claim, evidence));
    const locations = facilities.filter(facility => !verified || currentGeographicReview(snapshot, facility))
      .map(facility => locationComponent(snapshot, facility, sources, humanAdded));
    const classified = new Set([...dateClaims, ...identityClaims, ...durationClaims]);
    const categories = new Map();
    const impactComponents = [];
    for (const claim of facts) {
      const explicitComponent = claim.affected_component ?? claim.affected_facility_component ?? claim.affected_service ?? claim.effect_scope;
      if (!simplified && known(explicitComponent)) impactComponents.push(factComponent(snapshot, id, claim, evidence, claim.subject, explicitComponent));
      if (simplified || classified.has(claim) || casualtyType(claim)) continue;
      const family = claim.claim_family || "OTHER_RECORDED_FINDINGS";
      const findings = categories.get(family) || [];
      findings.push(factComponent(snapshot, id, claim, evidence, claim.subject, detailValue(claim)));
      categories.set(family, findings);
      families.add(family);
    }
    if (!verified && !simplified && !categories.has("FACILITY_TYPE")) {
      const described = facilities.filter(facility => known(facility.source_described_types));
      if (described.length) {
        families.add("FACILITY_TYPE");
        categories.set("FACILITY_TYPE", described.map(facility => component(facilityName(facility), fmt(facility.source_described_types), "Recorded description · unverified", [])));
      }
    }
    const status = reviewStatus(snapshot, event);
    const record = recordType(snapshot, id);
    const state = record.group === "context" ? "Contextual · " + record.label : record.label;
    return { categories, row: [
      { text: facilities.map(facilityName).join("\n") || missing },
      { text: id },
      ...pair(dates), ...pair(identities), ...pair(durations), ...pair(locations),
      ...pair(casualties(snapshot, id, facts, evidence)),
      { text: [...ids].sort().join("\n") || missing }, { text: state },
      { text: status }, { text: snapshotDate }, { text: scope },
      { text: event.incident_label || missing }, { text: recordedText(event.working_type) },
      { text: verified ? "" : joinDetails([eventDateFallback(event), "Precision " + label(event.date_precision || "Unknown")]) },
      { text: known(event.temporal_eligibility) ? recordedText(event.temporal_eligibility) : missing },
      { text: facilities.map(facility => {
        const geography = facility.locality_governorate ?? facility;
        return typeof geography === "string" ? geography : [geography.locality, geography.district, geography.governorate].filter(Boolean).join(", ");
      }).filter(Boolean).join("\n") || missing },
      ...pair(impactComponents),
    ] };
  });
  const orderedFamilies = [...new Set([...Object.keys(familyHeaders), ...Object.keys(FAMILIES), ...families])].filter(family => families.has(family));
  const rows = prepared.map(({ row, categories }) => row.concat(orderedFamilies.flatMap(family => pair(categories.get(family) || []))));
  const relevant = records.CLAIM.filter(claim => evidence.coveredFacts.has(claim.claim_id));
  return {
    headers: reportHeadings(orderedFamilies, simplified), rows,
    selection: periodicalSelection ? { report: periodicalSelection.report, scope: periodicalSelection.scope } : { report: "full", scope: "all" },
    progress: {
      events: rows.length, facts: evidence.coveredFacts.size, evidenceLinks: evidence.coveredEvidence.size,
      aiOrigin: relevant.filter(claim => claim.ai_original_recorded === true || known(claim.ai_original_value)).length,
      reviewed: relevant.filter(claim => claim.is_current !== false && claim.correction_withdrawn !== true &&
        periodicalFactReviewState(snapshot, claim) === "REVIEWED").length,
      evidenceBindingMissing: periodicalSelection?.evidenceBindingMissing ?? 0,
    },
    coverage: {
      eventIds: prepared.map(({ row }) => row[1].text),
      factIds: [...evidence.coveredFacts].sort(), evidenceIds: [...evidence.coveredEvidence].sort(),
      excludedFactIds: records.CLAIM.map(claim => claim.claim_id).filter(id => !evidence.coveredFacts.has(id)),
      excludedEvidenceIds: records.CLAIM_SOURCE.map(relation => relation.claim_source_id).filter(id => !evidence.coveredEvidence.has(id)),
      families: orderedFamilies,
    },
  };
}
