import { z } from "zod";
import { assertActiveProfile } from "@rvw/domain";
import { serverClient } from "@/lib/supabase";
import { boundedBody, checkOrigin, failure, json } from "@/lib/http";
import { AccessError } from "@/lib/access";
import { authAvailability } from "@/lib/auth-availability";
const login = z
  .object({ email: z.email().max(254), password: z.string().min(1).max(256) })
  .strict();

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const parsed = login.safeParse(await boundedBody(request, 4096));
    if (!parsed.success) throw new AccessError(400, "CHECK_EMAIL_AND_PASSWORD");
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
    const pendingCookies: (() => void)[] = [];
    const client = await serverClient({
      signal,
      deferCookies: (write) => pendingCookies.push(write),
    });
    const { data, error } = await client.auth.signInWithPassword(parsed.data);
    const unavailable = authAvailability(error);
    if (unavailable === 429)
      return json({ error: "SIGN_IN_THROTTLED" }, 429);
    if (unavailable === 503 || signal.aborted)
      return json({ error: "SIGN_IN_UNAVAILABLE" }, 503);
    if (error || !data.user || data.user.is_anonymous)
      throw new AccessError(401, "SIGN_IN_FAILED");
    const result = await client.rpc("lab_actor_profile");
    if (result.error || signal.aborted) {
      // The new session's cookies have not been published. Revoke only that
      // session if the provider is reachable.
      if (!signal.aborted) await client.auth.signOut({ scope: "local" });
      if (result.status === 429)
        return json({ error: "SIGN_IN_THROTTLED" }, 429);
      if (result.error?.code === "42501")
        throw new AccessError(403, "ACTIVE_PROFILE_REQUIRED");
      return json({ error: "SIGN_IN_UNAVAILABLE" }, 503);
    }
    try {
      assertActiveProfile(result.data, data.user.id);
    } catch {
      await client.auth.signOut({ scope: "local" });
      throw new AccessError(403, "ACTIVE_PROFILE_REQUIRED");
    }
    for (const write of pendingCookies) write();
    return json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const client = await serverClient();
    const { error } = await client.auth.signOut();
    if (error) throw error;
    return json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
