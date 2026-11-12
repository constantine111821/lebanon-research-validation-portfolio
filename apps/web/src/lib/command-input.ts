import { z } from "zod";
import { AccessError } from "./access";
import { correctionFields } from "./corrections";
export const commandSchema = z
  .object({
    operation_id: z.uuid(),
    incident_id: z.string().min(1).max(200),
    expected_revision: z.number().int().nonnegative(),
    kind: z.enum([
      "submit_changes",
      "create_incident",
      "resolve_facility",
      "review_location",
      "review_facility_association",
      "facility_evidence",
      "update_requirements",
      "complete_incident",
      "reopen_incident",
      "assign_case",
      "approve_phase2",
      "revoke_phase2",
      "reopen_facility_identity",
      "set_disposition",
      "request_disposition",
      "decline_disposition_request",
      "propose_correction",
      "review_correction",
    ]),
    payload: z.record(z.string(), z.json()),
  })
  .strict();
export function commandInput(value: unknown, role: string) {
  const r = commandSchema.safeParse(value);
  if (!r.success) throw new AccessError(400, "INVALID_COMMAND");
  // UI-first launch remains on schema 012. Never send successor review commands
  // (including a restored private draft) to the older database dispatcher.
  if (["review_location", "review_facility_association"].includes(r.data.kind))
    throw new AccessError(409, "GEOGRAPHIC_REVIEW_DEFERRED_FOR_LAUNCH");
  if (
    [
      "review_location",
      "review_facility_association",
      "update_requirements",
      "reopen_incident",
      "complete_incident",
      "assign_case",
      "approve_phase2",
      "revoke_phase2",
      "reopen_facility_identity",
      "set_disposition",
      "decline_disposition_request",
      "review_correction",
    ].includes(r.data.kind) &&
    role !== "supervisor"
  )
    throw new AccessError(403, "SUPERVISOR_REQUIRED");
  if (r.data.kind === "request_disposition" && role !== "researcher")
    throw new AccessError(403, "RESEARCHER_REQUIRED");
  const reason = z.string().trim().min(1).max(4000);
  if (r.data.kind === "assign_case" && "assigned_researchers" in r.data.payload) {
    const payload = z.object({
      assigned_researchers: z.array(z.uuid()).max(100),
      expected_assignment_revision: z.number().int().nonnegative(),
      assignment_note: reason,
    }).strict().safeParse(r.data.payload);
    if (!payload.success || new Set(payload.data.assigned_researchers.map(id => id.toLowerCase())).size !== payload.data.assigned_researchers.length)
      throw new AccessError(400, "INVALID_ASSIGNMENT_TEAM");
  }
  if (r.data.kind === "propose_correction") {
    const proposal = z
      .object({
        target_type: z.enum(["fact", "evidence", "source"]),
        target_id: z.string().min(1).max(200),
        fact_id: z.string().min(1).max(200),
        action: z.enum(["amend", "withdraw"]),
        expected_target_revision: z.number().int().nonnegative(),
        reason,
        changes: z.record(z.string(), z.json()),
      })
      .strict()
      .safeParse(r.data.payload);
    if (!proposal.success) throw new AccessError(400, "INVALID_CORRECTION");
    const p = proposal.data;
    if (p.target_type === "fact" && role !== "supervisor")
      throw new AccessError(403, "SUPERVISOR_REQUIRED");
    const keys = Object.keys(p.changes);
    if (
      (p.target_type === "fact" && p.target_id !== p.fact_id) ||
      (p.target_type === "source" && p.action !== "amend") ||
      (p.action === "withdraw" && keys.length > 0) ||
      (p.action === "amend" && keys.length === 0) ||
      keys.some(
        (k) =>
          !(correctionFields[p.target_type] as readonly string[]).includes(k),
      )
    )
      throw new AccessError(400, "INVALID_CORRECTION_FIELDS");
    if (
      p.changes.support_direction !== undefined &&
      !["SUPPORTS", "CONTRADICTS", "LIMITS", "CONTEXT_ONLY"].includes(
        String(p.changes.support_direction),
      )
    )
      throw new AccessError(400, "INVALID_EVIDENCE_RELATIONSHIP");
  }
  if (
    r.data.kind === "review_correction" &&
    !z
      .object({
        correction_id: z.uuid(),
        decision: z.enum(["accept", "reject"]),
        reason,
      })
      .strict()
      .safeParse(r.data.payload).success
  )
    throw new AccessError(400, "INVALID_CORRECTION_REVIEW");
  if (r.data.kind === "set_disposition") {
    const payload = z
      .object({
        target_type: z.enum(["fact", "incident"]),
        target_id: z.string().min(1).max(200),
        action: z.enum(["DEFER", "APPROVE", "REOPEN"]),
        reason,
        expected_target_revision: z.number().int().nonnegative(),
        attestation: z.boolean().optional(),
        review: z.record(z.string(), z.json()).optional(),
        override: z.boolean().optional(),
        request_id: z.uuid().optional(),
      })
      .strict()
      .safeParse(r.data.payload);
    if (
      !payload.success ||
      (payload.data.action !== "REOPEN" && payload.data.attestation !== true) ||
      (payload.data.action === "APPROVE" &&
        payload.data.target_type === "fact" &&
        (!payload.data.review ||
          payload.data.review.type !== "review" ||
          payload.data.review.claim_id !== payload.data.target_id ||
          payload.data.review.attestation !== true))
    )
      throw new AccessError(400, "INVALID_DISPOSITION_DECISION");
  }
  if (
    r.data.kind === "request_disposition" &&
    !z
      .object({
        requested_action: z.enum(["DEFER", "APPROVE"]),
        explanation: reason,
      })
      .strict()
      .safeParse(r.data.payload).success
  )
    throw new AccessError(400, "INVALID_DISPOSITION_REQUEST");
  if (
    r.data.kind === "decline_disposition_request" &&
    !z
      .object({ request_id: z.uuid(), reason })
      .strict()
      .safeParse(r.data.payload).success
  )
    throw new AccessError(400, "INVALID_DISPOSITION_DECLINE");
  return r.data;
}
