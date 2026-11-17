import { factWaived } from "../../../../packages/domain/src/acceptance-policy.js";
import { currentEvidence, labReviewState } from "../approved/shared.js";
import { locationPresentation } from "../approved/geography.js";
import { isDirectlyReportedDuration } from "../approved/timing.js";

const present = value => value !== null && value !== undefined && (typeof value !== "string" || value.trim() !== "");
const current = row => row.is_current !== false && row.correction_withdrawn !== true;

export function periodicalFactReviewState(snapshot, claim) {
  const review = snapshot.workflow?.claims?.[claim.claim_id];
  const revision = snapshot.revisions?.CLAIM?.[claim.claim_id];
  if (snapshot.saved_periodical_capture === true && review?.scoped_review_recorded === true &&
      review.lab_review_state === "REVIEWED" && review.lab_reviewed_at && !review.review_needed &&
      Number.isSafeInteger(revision) && review.lab_reviewed_claim_revision === revision)
    return "REVIEWED";
  if (review?.lab_review_state === "REVIEWED" && !Number.isSafeInteger(revision)) return "NOT_REVIEWED";
  return labReviewState(claim, snapshot);
}

export function currentSupportedFact(snapshot, eventId, claim) {
  return current(claim) && present(claim.current_verified_value) && claim.validation_state === "SUPPORTED" &&
    snapshot.dispositions?.facts?.[claim.claim_id]?.state !== "DEFERRED" &&
    !factWaived(snapshot, claim.claim_id, eventId) && periodicalFactReviewState(snapshot, claim) === "REVIEWED";
}

export function casualtyType(claim) {
  if (claim.claim_family !== "HUMAN_IMPACT_MEASURE" || claim.value_type !== "QUANTITATIVE" ||
      /capacity|context|percent|%/i.test([claim.impact_basis, claim.quantitative_unit].join(" "))) return null;
  const text = [claim.casualty_type, claim.measure_type, claim.quantitative_unit, claim.scope, claim.effect_scope, claim.subject]
    .filter(value => typeof value === "string").join(" ");
  const death = /\b(?:death[s]?|killed|died|fatalit(?:y|ies)|deceased)\b/i.test(text);
  const injury = /\b(?:injur(?:y|ies|ed)|wound(?:ed|s)?)\b/i.test(text);
  if (death && !injury) return "Deaths";
  if (injury && !death) return "Injuries";
  return death || injury || /\bcasualt(?:y|ies)\b/i.test(text) ? "Combined or unspecified" : null;
}

export function physicalIdentity(claim, facilityIds) {
  return claim.claim_family === "IDENTITY" && facilityIds.has(claim.facility_id) &&
    claim.identity_purpose !== "facility_comparison" && !/\b(?:operator|operated by)\b/i.test(claim.subject || "");
}

function inSimplifiedReport(claim, facilityIds, allowUnresolved) {
  if (claim.claim_family === "EVENT_DATE" || physicalIdentity(claim, facilityIds)) return true;
  if (claim.claim_family === "RESTORATION_DATE" && claim.value_type === "QUANTITATIVE")
    return allowUnresolved || (isDirectlyReportedDuration(claim) && Number.isFinite(claim.current_verified_value) &&
      claim.current_verified_value >= 0 && present(claim.quantitative_unit));
  const casualty = casualtyType(claim);
  return casualty !== null && (allowUnresolved || (casualty !== "Combined or unspecified" &&
    Number.isInteger(claim.current_verified_value) && claim.current_verified_value >= 0 && claim.current_verified_value <= 2147483647));
}

export function currentGeographicReview(snapshot, facility) {
  if (!current(facility)) return null;
  const location = locationPresentation(snapshot, facility);
  const { current: reviewed, pendingProposal, reviewed: review } = location;
  const coordinates = review?.coordinates;
  const revision = snapshot.revisions?.FACILITY?.[facility.facility_id];
  const workflow = snapshot.workflow?.facility_reviews?.[facility.facility_id] ?? snapshot.workflow?.facilities?.[facility.facility_id];
  if (!Number.isSafeInteger(revision) || !workflow?.lab_location_reviewed_by || !workflow.lab_location_reviewed_at ||
      workflow.lab_location_reviewed_facility_revision !== revision || !reviewed || pendingProposal || review?.state !== "SUPPORTED" || review.coordinate_rejected ||
      coordinates?.crs !== "EPSG:4326" || !Number.isFinite(coordinates.latitude) ||
      !Number.isFinite(coordinates.longitude) || Math.abs(coordinates.latitude) > 90 ||
      Math.abs(coordinates.longitude) > 180) return null;
  return review;
}

function evidenceIndex(snapshot) {
  const { ACTIVITY_LOG, CLAIM_SOURCE, SOURCE } = snapshot.records;
  return {
    activity: new Map((ACTIVITY_LOG || []).map(row => [row.activity_id, row])),
    relationships: new Map(CLAIM_SOURCE.map(row => [row.claim_source_id, row])),
    sources: new Map(SOURCE.map(row => [row.source_id, row])),
  };
}

function boundReview(snapshot, claim, activity) {
  const authority = claim.current_value_authority?.authority_artifact;
  const log = activity.get(authority);
  if (!authority || log?.entity_type !== "CLAIM" || log.entity_id !== claim.claim_id || log.action_type !== "validate")
    return null;

  const artifact = log.authority_artifact?.payload?.operation?.review_artifact;
  const workflow = snapshot.workflow?.claims?.[claim.claim_id];
  const revision = snapshot.revisions?.CLAIM?.[claim.claim_id];
  if (artifact?.claim_id !== claim.claim_id || artifact.proposal?.validation_state !== "SUPPORTED" ||
      !Number.isSafeInteger(artifact.prior_revision) || artifact.prior_revision + 1 !== revision ||
      workflow?.lab_reviewed_claim_revision !== revision || !workflow.lab_reviewed_by ||
      artifact.reviewer !== workflow.lab_reviewed_by || !Array.isArray(artifact.approval_basis)) return null;
  return artifact;
}

function verifiedLinks(snapshot, claim, evidence) {
  const artifact = boundReview(snapshot, claim, evidence.activity);
  if (!artifact) return [];
  const links = [];
  for (const bound of artifact.approval_basis) {
    const relation = evidence.relationships.get(bound?.id);
    const source = evidence.sources.get(bound?.source?.id);
    if (!relation || !source || !currentEvidence(relation) || !current(source) ||
        relation.claim_id !== claim.claim_id || relation.support_direction !== "SUPPORTS" ||
        relation.source_id !== source.source_id || bound.data?.claim_id !== claim.claim_id ||
        bound.data.source_id !== relation.source_id || bound.data.support_direction !== "SUPPORTS" ||
        !Number.isSafeInteger(bound.revision) || snapshot.revisions?.CLAIM_SOURCE?.[relation.claim_source_id] !== bound.revision ||
        !Number.isSafeInteger(bound.source.revision) || snapshot.revisions?.SOURCE?.[source.source_id] !== bound.source.revision)
      continue;
    links.push(relation.claim_source_id);
  }
  return links;
}

/**
 * Give both output formats the same server-selected event, finding and evidence scope.
 * @param {any} snapshot
 * @param {{ report?: "simplified" | "full", scope?: "verified" | "all" }} [selection]
 */
export function selectPeriodicalScope(snapshot, { report = "full", scope = "all" } = {}) {
  if (!["simplified", "full"].includes(report) || !["verified", "all"].includes(scope))
    throw new TypeError("Invalid periodical export selection");
  const verified = scope === "verified";
  const { records } = snapshot;
  const selection = { report, scope, evidenceBindingMissing: 0 };
  if (report === "full" && !verified) return { ...snapshot, periodicalSelection: selection };

  const facilities = new Map(records.FACILITY.map(facility => [facility.facility_id, facility]));
  const linksByEvent = Map.groupBy(records.INCIDENT_FACILITY.filter(link => link.is_current !== false), link => link.incident_id);
  const factsByEvent = Map.groupBy(records.CLAIM, claim => claim.incident_id ?? null);
  const facilityFacts = Map.groupBy(factsByEvent.get(null) || [], claim => claim.facility_id);
  const selectedEvents = new Set();
  const selectedFacts = new Set();
  const factsBySelectedEvent = new Map();
  for (const event of records.INCIDENT) {
    if (verified && event.is_current === false) continue;
    const links = linksByEvent.get(event.incident_id) || [];
    const facilityIds = new Set(links.map(link => link.facility_id));
    const facts = [
      ...(factsByEvent.get(event.incident_id) || []),
      ...[...facilityIds].flatMap(id => facilityFacts.get(id) || []),
    ].filter(claim =>
      (report === "full" || inSimplifiedReport(claim, facilityIds, !verified)) &&
      (!verified || ((!claim.facility_id || facilityIds.has(claim.facility_id)) && currentSupportedFact(snapshot, event.incident_id, claim))),
    );
    const locationEligible = verified && links.length === 1 && links[0].facility_match_state === "supported" &&
      facilities.has(links[0].facility_id) && currentGeographicReview(snapshot, facilities.get(links[0].facility_id));
    if (verified && !facts.length && !locationEligible) continue;
    selectedEvents.add(event.incident_id);
    factsBySelectedEvent.set(event.incident_id, new Set(facts.map(fact => fact.claim_id)));
    for (const fact of facts) selectedFacts.add(fact.claim_id);
  }

  const claims = records.CLAIM.filter(claim => selectedFacts.has(claim.claim_id));
  let relationships = records.CLAIM_SOURCE.filter(link => selectedFacts.has(link.claim_id));
  if (verified) {
    const evidence = evidenceIndex(snapshot);
    const selectedLinks = new Set();
    for (const claim of claims) {
      const links = verifiedLinks(snapshot, claim, evidence);
      if (!links.length) selection.evidenceBindingMissing += 1;
      for (const id of links) selectedLinks.add(id);
    }
    relationships = relationships.filter(link => selectedLinks.has(link.claim_source_id));
  }

  return {
    ...snapshot,
    periodicalSelection: { ...selection, factsByEvent: factsBySelectedEvent },
    records: {
      ...records,
      INCIDENT: records.INCIDENT.filter(event => selectedEvents.has(event.incident_id)),
      INCIDENT_FACILITY: records.INCIDENT_FACILITY.filter(link => selectedEvents.has(link.incident_id)),
      CLAIM: claims,
      CLAIM_SOURCE: relationships,
    },
  };
}
