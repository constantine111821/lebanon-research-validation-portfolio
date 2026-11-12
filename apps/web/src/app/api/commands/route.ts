import { authorizedActor } from "@/lib/access";
import { commandInput } from "@/lib/command-input";
import { boundedBody, checkOrigin, failure, json } from "@/lib/http";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { client, profile, authMs, rpcMs } = await authorizedActor();
    const input = commandInput(await boundedBody(request), profile.role);
    const commitStart = performance.now();
    const { data, error } = await client.rpc("lab_commit", {
      p_request: input,
    });
    if (error) {
      if (error.code === "PT423") {
        let details: unknown = null;
        try {
          details = JSON.parse(error.details || "null");
        } catch {
          /* Preserve a safe explanatory message for non-JSON diagnostics. */
        }
        return json(
          {
            error: "DISPOSITION_LOCKED",
            message: `Shared changes are locked by supervisor disposition. ${error.message || "Supervisor reopening is required."} Your private draft and staged work are preserved. A supervisor must reopen the affected item before shared changes.`,
            details,
          },
          409,
        );
      }
      if (["PT409", "40001"].includes(error.code))
        return json({ error: "SHARED_CONFLICT", message: error.message }, 409);
      if (error.code === "42501")
        return json({ error: "COMMAND_DENIED", message: error.message }, 403);
      if (["P0001", "22023", "23514", "23503", "23505"].includes(error.code))
        return json({ error: "COMMAND_REJECTED", message: error.message }, 400);
      throw error;
    }
    const response = json(data);
    response.headers.set(
      "Server-Timing",
      `auth;dur=${authMs.toFixed(2)},profile;dur=${rpcMs.toFixed(2)},commit;dur=${(performance.now() - commitStart).toFixed(2)}`,
    );
    return response;
  } catch (error) {
    return failure(error);
  }
}
