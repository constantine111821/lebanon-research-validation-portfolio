import "server-only";
import { createHmac } from "node:crypto";
import { AccessError } from "./access";
import { administrationEnabled } from "./account-mode";

// The user JWT identifies the holder. The short-lived signature binds this website operation to that session.
export async function command(actor, op, req = null, detail = "") {
  if (!administrationEnabled())
    throw new AccessError(503, "ACCOUNTS_UNAVAILABLE");
  const claims = await actor.client.auth.getClaims();
  const session = claims.data?.claims?.session_id;
  if (
    claims.error ||
    claims.data?.claims?.sub !== actor.userId ||
    typeof session !== "string"
  )
    throw new AccessError(401, "SIGN_IN_REQUIRED");
  const stamp = Math.floor(Date.now() / 1000);
  const proof = createHmac(
    "sha256",
    Buffer.from(process.env.RVW_ACCOUNT_SIGNING_KEY, "hex"),
  )
    .update(
      ["v1", actor.userId, session, op, req ?? "", detail, stamp].join("|"),
    )
    .digest("hex");
  const { data, error } = await actor.client.rpc("lab_account_command", {
    op,
    req,
    detail,
    stamp,
    proof,
  });
  if (error) {
    if (error.code === "42501")
      throw new AccessError(403, "ACCOUNT_ACCESS_REQUIRED");
    if (error.code === "PT409") throw new AccessError(409, "REQUEST_CHANGED");
    if (error.code === "PT429") throw new AccessError(429, "SLOW_DOWN");
    throw new AccessError(503, "ACCOUNTS_UNAVAILABLE");
  }
  return data;
}
export const ownRequest = (actor) => command(actor, "status");
export const openRequest = (actor) => command(actor, "request");
export const decide = (actor, id, approved, basis) =>
  command(actor, approved ? "approve" : "deny", id, basis);
export const claim = (actor, id) => command(actor, "claim", id);
export const settle = (actor, id, state) => command(actor, "settle", id, state);
export const dashboard = (actor) => command(actor, "dashboard");
