import type { DraftPayload, ResearchRow, Snapshot } from "./index.ts";

export function emptyDraft(
  snapshot: Snapshot,
  incidentId: string,
): DraftPayload {
  const incident = snapshot.records.INCIDENT.find(
    (i) => i.incident_id === incidentId,
  );
  if (!incident) throw new Error("CASE_NOT_FOUND");
  return {
    incident_id: incidentId,
    title: incident.incident_label,
    expected_revision: snapshot.revisions.INCIDENT[incidentId],
    creation: null,
    changes: [],
    facilityCommand: null,
  };
}

export function draftIsSupported(payload: DraftPayload) {
  return (
    payload.creation === null &&
    payload.facilityCommand === null &&
    Array.isArray(payload.changes) &&
    payload.changes.every(
      (change) =>
        (change.type === "review" && change.value_type === "BOOLEAN") ||
        (change.type === "new_fact" &&
          change.claim?.value_type === "BOOLEAN" &&
          ["KINETIC_EVENT", "PHYSICAL_DAMAGE", "FULL_CLOSURE"].includes(
            change.claim.claim_family,
          )),
    )
  );
}

export function setDraftChange(
  payload: DraftPayload,
  change: ResearchRow,
): DraftPayload {
  const key = change.claim_id || change.claim?.claim_id;
  const changes = payload.changes.filter(
    (c) => (c.claim_id || c.claim?.claim_id) !== key,
  );
  return { ...payload, changes: [...changes, structuredClone(change)] };
}

export function booleanValue(choice: string): boolean | null {
  if (choice === "unknown") return null;
  if (choice === "yes") return true;
  if (choice === "no") return false;
  throw new Error("Choose Unknown, Yes or No.");
}
