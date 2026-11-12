import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AccessError } from "@/lib/access";
import { accountActor } from "@/lib/account-control";
import { designatedOwner } from "@/lib/account-mode";
import { command } from "@/lib/account-ledger";
import { verifyCurrentPassword } from "@/lib/password-security";
import { checkOrigin, boundedBody, json, failure } from "@/lib/http";
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("enroll"),
      current: z.string().min(1).max(256),
    })
    .strict(),
  z
    .object({
      action: z.literal("confirm"),
      id: z.uuid(),
      code: z.string().regex(/^\d{6}$/),
    })
    .strict(),
]);
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const actor = await accountActor(request);
    if (!designatedOwner(actor.userId))
      throw new AccessError(403, "OWNER_ONLY");
    const binding = await command(actor, "owner");
    if (binding?.factor !== null) throw new AccessError(403, "ALREADY_BOUND");
    const input = schema.safeParse(await boundedBody(request, 1024));
    if (!input.success) throw new AccessError(400, "INVALID_INPUT");
    const { data, error } = await actor.client.auth.getUser();
    if (error || data.user?.id !== actor.userId || !data.user.email)
      throw new AccessError(401, "SIGN_IN_REQUIRED");
    const factors = data.user.factors ?? [];
    if (factors.some((f) => f.status === "verified"))
      throw new AccessError(409, "USE_ENROLLED_FACTOR");
    if (input.data.action === "enroll") {
      await verifyCurrentPassword(
        data.user.email,
        actor.userId,
        input.data.current,
      );
      const result = await actor.client.auth.mfa.enroll({
        factorType: "totp",
        issuer: "Lebanon Research Workspace",
        friendlyName: "Workspace administrator " + randomUUID().slice(0, 8),
      });
      if (result.error) throw new AccessError(409, "ENROLLMENT_UNAVAILABLE");
      return json({ id: result.data.id, setupKey: result.data.totp.secret });
    }
    const v = await actor.client.auth.mfa.challengeAndVerify({
      factorId: input.data.id,
      code: input.data.code,
    });
    if (v.error) throw new AccessError(403, "FACTOR_FAILED");
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
