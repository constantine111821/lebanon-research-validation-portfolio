import { accountActor } from "@/lib/account-control";
import { claim, ownRequest, settle } from "@/lib/account-ledger";
import { z } from "zod";
import { AccessError } from "@/lib/access";
import { checkOrigin, boundedBody, json, failure } from "@/lib/http";
import {
  checkPassword,
  screenPassword,
  verifyCurrentPassword,
} from "@/lib/password-security";

const password = z.string().min(1).max(256);
const input = z
  .object({
    action: z.literal("change"),
    approval: z.uuid(),
    currentPassword: password,
    password,
  })
  .strict();

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const parsed = input.safeParse(await boundedBody(request, 4096));
    if (!parsed.success) throw new AccessError(400, "INVALID_INPUT");
    const command = parsed.data;
    const actor = await accountActor(request);
    const { client, userId } = actor;
    const approval = await ownRequest(actor);
    if (approval?.state !== "approved" || approval.id !== command.approval)
      throw new AccessError(409, "APPROVAL_REQUIRED");
    checkPassword(command.password);
    const current = await client.auth.getUser();
    if (
      current.error ||
      !current.data.user?.email ||
      current.data.user.id !== userId
    )
      throw new AccessError(401, "SIGN_IN_REQUIRED");
    if (current.data.user.factors?.some((f) => f.status === "verified")) {
      const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error || assurance.data?.currentLevel !== "aal2")
        throw new AccessError(403, "SECOND_FACTOR_REQUIRED");
    }
    await verifyCurrentPassword(
      current.data.user.email,
      userId,
      command.currentPassword,
    );
    await screenPassword(command.password);
    await claim(actor, command.approval);
    let result;
    try {
      result = await client.auth.updateUser({
        password: command.password,
        current_password: command.currentPassword,
      });
    } catch {
      await settle(actor, command.approval, "uncertain");
      throw new AccessError(503, "OUTCOME_UNCERTAIN");
    }
    if (result.error) {
      const status = result.error.status ?? 0;
      const definitive = status >= 400 && status < 500 && status !== 408;
      await settle(
        actor,
        command.approval,
        definitive ? "rejected" : "uncertain",
      );
      throw new AccessError(
        definitive ? 400 : 503,
        definitive ? "PASSWORD_REJECTED" : "OUTCOME_UNCERTAIN",
      );
    }
    if (result.data.user?.id !== userId) {
      await settle(actor, command.approval, "uncertain");
      throw new AccessError(503, "OUTCOME_UNCERTAIN");
    }
    try {
      await settle(actor, command.approval, "completed");
    } catch {
      throw new AccessError(503, "OUTCOME_UNCERTAIN");
    }
    return json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
