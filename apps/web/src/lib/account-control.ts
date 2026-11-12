import "server-only";
import { AccessError, authorizedActor } from "./access";
import { administrationEnabled, designatedOwner } from "./account-mode";
export async function accountActor(request?: Request) {
  if (!administrationEnabled())
    throw new AccessError(404, "ACCOUNTS_UNAVAILABLE");
  const actor = await authorizedActor();
  if (request && request.headers.get("x-rvw-actor") !== actor.userId)
    throw new AccessError(409, "WORKSPACE_ACTOR_CHANGED");
  return actor;
}
export async function freshOwner(
  actor: Awaited<ReturnType<typeof accountActor>>,
) {
  if (!designatedOwner(actor.userId)) throw new AccessError(403, "OWNER_ONLY");
  const { data, error } = await actor.client.auth.getClaims();
  const now = Date.now() / 1000,
    claims = data?.claims;
  if (
    error ||
    claims?.sub !== actor.userId ||
    claims.aal !== "aal2" ||
    !Array.isArray(claims.amr)
  )
    return false;
  const methods: unknown[] = claims.amr;
  if (
    !methods.some(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        "method" in m &&
        (m.method === "totp" || m.method === "mfa/totp") &&
        "timestamp" in m &&
        typeof m.timestamp === "number" &&
        Number.isFinite(m.timestamp) &&
        m.timestamp <= now &&
        now - m.timestamp < 600,
    )
  )
    return false;
  const factors = await actor.client.auth.mfa.listFactors();
  return (
    !factors.error &&
    Boolean(factors.data?.totp.some((f) => f.status === "verified"))
  );
}
