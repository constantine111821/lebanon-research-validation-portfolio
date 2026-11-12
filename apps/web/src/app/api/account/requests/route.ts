import { z } from "zod";
import { AccessError } from "@/lib/access";
import { accountActor, freshOwner } from "@/lib/account-control";
import { designatedOwner } from "@/lib/account-mode";
import { openRequest, decide, command } from "@/lib/account-ledger";
import { checkOrigin, boundedBody, json, failure } from "@/lib/http";
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request") }).strict(),
  z
    .object({
      action: z.literal("approve"),
      id: z.uuid(),
      method: z.enum(["in-person", "known-callback"]),
    })
    .strict(),
  z.object({ action: z.literal("deny"), id: z.uuid() }).strict(),
  z
    .object({ action: z.literal("verify"), code: z.string().regex(/^\d{6}$/) })
    .strict(),
]);
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const actor = await accountActor(request);
    const result = input.safeParse(await boundedBody(request, 1024));
    if (!result.success) throw new AccessError(400, "INVALID_INPUT");
    const cmd = result.data;
    if (cmd.action === "request") {
      if (designatedOwner(actor.userId))
        throw new AccessError(403, "SELF_APPROVAL_DISABLED");
      await openRequest(actor);
    } else {
      if (cmd.action === "verify") {
        const owner = designatedOwner(actor.userId);
        const binding = await command(actor, owner ? "owner" : "status");
        if (!owner && binding?.state !== "approved")
          throw new AccessError(403, "APPROVAL_REQUIRED");
        const factors = await actor.client.auth.mfa.listFactors();
        const f = factors.data?.totp.find(
          (f) => f.status === "verified" && (!owner || f.id === binding.factor),
        );
        if (factors.error || !f)
          throw new AccessError(403, "OWNER_FACTOR_REQUIRED");
        const v = await actor.client.auth.mfa.challengeAndVerify({
          factorId: f.id,
          code: cmd.code,
        });
        if (v.error)
          throw new AccessError(
            v.error.status === 429 ? 429 : 403,
            "FACTOR_FAILED",
          );
      } else {
        if (!(await freshOwner(actor)))
          throw new AccessError(403, "FRESH_FACTOR_REQUIRED");
        await decide(
          actor,
          cmd.id,
          cmd.action === "approve",
          cmd.action === "approve" ? cmd.method : "not-verified",
        );
      }
    }
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
