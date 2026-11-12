import "server-only";
import { AccessError, authorizedActor } from "./access";
import type { CorrectionsSnapshot } from "./corrections";
export async function authorizedCorrections(incidentId: string) {
  if (!incidentId || incidentId.length > 200)
    throw new AccessError(400, "INVALID_CASE");
  const { client, profile, userId } = await authorizedActor();
  const { data, error } = await client.rpc("lab_corrections", {
    p_incident_id: incidentId,
  });
  if (error) {
    if (error.code === "42501")
      throw new AccessError(403, "CORRECTIONS_DENIED");
    if (["PT404", "P0002", "22023"].includes(error.code))
      throw new AccessError(404, "CASE_NOT_FOUND");
    throw new AccessError(503, "CORRECTIONS_UNAVAILABLE");
  }
  if (!data || data.incident_id !== incidentId)
    throw new AccessError(404, "CASE_NOT_FOUND");
  const { data: context, error: contextError } = await client.rpc(
    "lab_fact_correction_context",
    { p_incident_id: incidentId },
  );
  if (contextError || context?.incident_id !== incidentId)
    throw new AccessError(503, "CORRECTIONS_UNAVAILABLE");
  data.incident_label = context.incident_label;
  data.facts = data.facts.map((fact: CorrectionsSnapshot["facts"][number]) => ({
    ...fact,
    correction_restriction: context.restrictions[fact.id] || undefined,
  }));
  return { snapshot: data as CorrectionsSnapshot, profile, userId };
}
