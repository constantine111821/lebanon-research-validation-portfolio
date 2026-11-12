import { AccessError, authorizedActor } from "@/lib/access";
import { boundedBody, checkOrigin, failure, json } from "@/lib/http";

function rpcFailure(error: { code?: string; message: string }) {
  const status = error.code === "42501" ? 403
    : error.code === "PT404" ? 404
      : error.code === "PT423" ? 423
        : ["PT409", "40001", "23505"].includes(error.code || "") ? 409
          : ["P0001", "22023", "22P02", "23514", "23503"].includes(error.code || "") ? 400 : 503;
  return json({ error: "FACT_CORRECTION_PACKAGE_REJECTED", message: status === 503 && error.code !== "PT503" ? "Correction packages are temporarily unavailable." : error.message }, status);
}

export async function GET(request: Request) {
  try {
    const incidentId = new URL(request.url).searchParams.get("incident_id");
    if (incidentId !== null && (!incidentId || incidentId.length > 200))
      throw new AccessError(400, "INVALID_CASE");
    const { client } = await authorizedActor();
    const { data, error } = await client.rpc("lab_fact_correction_packages", { p_incident_id: incidentId });
    if (error) return rpcFailure(error);
    return json(data);
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { client } = await authorizedActor();
    const input = await boundedBody(request, 500_000);
    const { data, error } = await client.rpc("lab_fact_correction_command", { p_request: input });
    if (error) return rpcFailure(error);
    return json({ ok: true, result: data });
  } catch (error) { return failure(error); }
}
