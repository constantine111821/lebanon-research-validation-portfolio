import * as shared from "./legacy/shared.js";
import { timingProjection } from "./legacy/timing.js";
import { acceptanceReadiness, outputAuthorized } from "./acceptance-policy.js";

// The legacy schema has heterogeneous JSON records. Keep that boundary explicit;
// do not project absent research fields into invented canonical values.
export type ResearchRow = Record<string, any>;
export type Profile = {
  user_id: string;
  display_name: string;
  role: "researcher" | "supervisor";
  active: boolean;
};
export type DraftPayload = {
  incident_id: string;
  title: string;
  expected_revision: number;
  creation: null;
  changes: ResearchRow[];
  facilityCommand: null;
};
export type PrivateDraft = {
  id: string;
  owner_id: string;
  revision: number;
  updated_at: string;
  payload: DraftPayload;
};
export type Snapshot = {
  refresh_version?: string | null;
  acceptance_policy?: string;
  records: Record<string, ResearchRow[]>;
  revisions: Record<string, Record<string, number>>;
  workflow: Record<string, any>;
  profile: Profile;
  drafts: PrivateDraft[];
  source_excerpts?: Record<string, any>;
  classifications?: ResearchRow[];
};

export const {
  fmt,
  label,
  facilityName,
  factLabel,
  labReviewState,
  priorHumanReviewed,
  origin,
  safeURL,
  valueText,
} = shared;
export { timingProjection };

export function assertActiveProfile(
  profile: unknown,
  userId: string,
): asserts profile is Profile {
  const p = profile as Partial<Profile> | null;
  if (
    !p ||
    p.user_id !== userId ||
    p.active !== true ||
    !["researcher", "supervisor"].includes(p.role || "")
  ) {
    throw new Error("ACTIVE_PROFILE_REQUIRED");
  }
}

export function queueProjection(snapshot: Snapshot) {
  return snapshot.records.FACILITY.map((facility) => ({
    facility,
    name: shared.facilityName(facility),
    type: shared.facilityType(snapshot, facility.facility_id),
    sourceDescribedType: shared.sourceDescribedType(
      snapshot,
      facility.facility_id,
    ),
    identity: shared.identityState(snapshot, facility.facility_id),
    cases: snapshot.records.INCIDENT.filter((i) =>
      snapshot.records.INCIDENT_FACILITY.some(
        (l) =>
          l.facility_id === facility.facility_id &&
          l.incident_id === i.incident_id &&
          l.is_current !== false,
      ),
    ).map((incident) => ({
      incident,
      status: shared.reviewStatus(snapshot, incident.incident_id),
      factCount: shared.claims(snapshot, incident.incident_id).length,
      taskCount: shared.tasks(snapshot, incident.incident_id).length,
    })),
  })).filter((group) => group.cases.length > 0);
}

export function caseProjection(snapshot: Snapshot, incidentId: string) {
  const incident = shared.incident(snapshot, incidentId);
  if (!incident) return null;
  const facility = shared.facilityFor(snapshot, incidentId);
  return {
    incident,
    facility,
    facilityName: shared.facilityName(facility),
    facilityType: shared.facilityType(snapshot, facility?.facility_id),
    identity: shared.identityState(snapshot, facility?.facility_id),
    readiness: shared.facilityReadiness(snapshot, facility?.facility_id),
    status: shared.reviewStatus(snapshot, incidentId),
    facts: shared.claims(snapshot, incidentId).map((claim: ResearchRow) => ({
      claim,
      label: shared.factLabel(claim),
      value: shared.valueText(claim),
      labState: shared.labReviewState(claim, snapshot),
      origin: shared.origin(claim),
      priorHumanReviewed: shared.priorHumanReviewed(claim),
      evidence: shared
        .evidenceFor(snapshot, claim.claim_id)
        .map(({ source, relation }: ResearchRow) => ({
          source,
          relation,
          excerpts: shared.sourceExcerpts(snapshot, source, relation),
        })),
    })),
    tasks: shared.tasks(snapshot, incidentId),
    timing: timingProjection(snapshot, incidentId),
    downstream: snapshot.acceptance_policy === 'OWNER_AMENDMENT_008' ? {
      ...shared.downstream(snapshot, incidentId),
      eligible: outputAuthorized(snapshot, incidentId),
      attackEligible: outputAuthorized(snapshot, incidentId) && shared.recordType(snapshot, incidentId).group === 'attack',
      contextEligible: outputAuthorized(snapshot, incidentId) && shared.recordType(snapshot, incidentId).group === 'context',
      unresolvedEligible: outputAuthorized(snapshot, incidentId) && shared.recordType(snapshot, incidentId).group === 'unresolved',
      reason: outputAuthorized(snapshot, incidentId) ? 'Supervisor accepted the recorded classification and limitations for validated output.' : 'Current supervisor acceptance and output authorization are required.',
    } : shared.downstream(snapshot, incidentId),
    acceptance: snapshot.acceptance_policy === 'OWNER_AMENDMENT_008' ? acceptanceReadiness(snapshot, incidentId) : null,
    revision: snapshot.revisions.INCIDENT[incidentId] ?? 0,
  };
}
