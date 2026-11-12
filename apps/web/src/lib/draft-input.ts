import { z } from "zod";
import { AccessError } from "./access";
const id = z.string().min(1).max(200),
  object = z.record(z.string(), z.json());
const payload = z
  .object({
    incident_id: id,
    title: z.string().min(1).max(2000),
    expected_revision: z.number().int().nonnegative(),
    creation: object.nullable(),
    changes: z.array(object).max(200),
    facilityCommand: object.nullable(),
  })
  .strict();
export const draftSaveSchema = z
  .object({ id, expected_revision: z.number().int().nonnegative(), payload })
  .strict();
export const deleteInput = z
  .object({ id, expected_revision: z.number().int().positive() })
  .strict();
export type DraftScope = { records: {
  INCIDENT: Array<{ incident_id: string }>;
  CLAIM: Array<{ claim_id: string; incident_id?: string | null }>;
} };
export function saveInput(value: unknown, snapshot: DraftScope) {
  const result = draftSaveSchema.safeParse(value);
  if (!result.success) throw new AccessError(400, "INVALID_DRAFT");
  const r = result.data,
    p = r.payload;
  // Private draft JSON is untrusted. Only lab_commit may validate and publish it.
  if (
    !p.creation &&
    !snapshot.records.INCIDENT.some((i) => i.incident_id === p.incident_id)
  )
    throw new AccessError(404, "CASE_NOT_FOUND");
  const newIds = new Set(
    p.changes
      .filter((c) => c.type === "new_fact")
      .map((c) => (c.claim as Record<string, unknown>)?.claim_id),
  );
  for (const c of p.changes) {
    if (!["review", "new_fact", "evidence", "task"].includes(String(c.type)))
      throw new AccessError(400, "INVALID_DRAFT_CHANGE");
    if (
      ["review", "evidence"].includes(String(c.type)) &&
      !newIds.has(c.claim_id) &&
      !snapshot.records.CLAIM.some(
        (x) =>
          x.claim_id === c.claim_id &&
          (x.incident_id === p.incident_id || x.incident_id == null),
      )
    )
      throw new AccessError(400, "DRAFT_FACT_SCOPE");
    if (
      c.type === "new_fact" &&
      snapshot.records.CLAIM.some(
        (x) => x.claim_id === (c.claim as Record<string, unknown>)?.claim_id,
      )
    )
      throw new AccessError(400, "DRAFT_FACT_ID_EXISTS");
  }
  // Preserve the approved ordered review list, including successive corrections.
  // It is private until the database validates the complete shared command.
  return r;
}
