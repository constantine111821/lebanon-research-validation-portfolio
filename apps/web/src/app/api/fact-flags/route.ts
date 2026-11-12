import { AccessError, authorizedActor } from "@/lib/access";
import { boundedBody, checkOrigin, failure, json } from "@/lib/http";

function rpcFailure(error: { code?: string; message: string }) {
  if (error.code === "42501")
    return json({ error: "FACT_FLAGS_DENIED", message: error.message }, 403);
  if (error.code === "PT404")
    return json(
      { error: "CASE_OR_FLAG_NOT_FOUND", message: error.message },
      404,
    );
  if (["PT409", "40001", "23505"].includes(error.code || ""))
    return json({ error: "FACT_FLAG_CONFLICT", message: error.message }, 409);
  if (["P0001", "22023", "22P02", "23514", "23503"].includes(error.code || ""))
    return json({ error: "FACT_FLAG_REJECTED", message: error.message }, 400);
  return json({ error: "FACT_FLAGS_UNAVAILABLE" }, 503);
}

export async function GET(request: Request) {
  try {
    const incidentId = new URL(request.url).searchParams.get("incident_id");
    if (!incidentId || incidentId.length > 200)
      throw new AccessError(400, "INVALID_CASE");
    const { client } = await authorizedActor();
    const { data, error } = await client.rpc("lab_fact_flags", {
      p_incident_id: incidentId,
    });
    if (error) return rpcFailure(error);
    return json({ ok: true, ...data });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { client } = await authorizedActor();
    const input = await boundedBody(request, 24_000);
    const { data, error } = await client.rpc("lab_fact_flag_command", {
      p_request: input,
    });
    if (error) return rpcFailure(error);
    return json({ ok: true, result: data });
  } catch (error) {
    return failure(error);
  }
}
