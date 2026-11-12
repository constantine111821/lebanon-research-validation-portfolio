import { administrationEnabled } from "@/lib/account-mode";
import "server-only";
import coverageReference from "./coverage-reference.json";
import { isPrivateNoteId } from "./private-note-input";
function withCoverage(snapshot: Snapshot) {
  const references = coverageReference as Record<string, unknown>;
  return {
    ...snapshot,
    drafts: snapshot.drafts.filter(draft => !isPrivateNoteId(draft.id)),
    diagnostic_reference: Object.fromEntries(
      snapshot.records.INCIDENT.filter((i) => references[i.incident_id]).map(
        (i) => [i.incident_id, references[i.incident_id]],
      ),
    ),
  };
}
import { cache } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { assertActiveProfile, type Snapshot } from "@rvw/domain";
import { serverClient, type ServerClientOptions } from "./supabase";
import { authAvailability } from "./auth-availability";

export class AccessError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
async function authorizedClient(options?: ServerClientOptions) {
  const start = performance.now();
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY)
    throw new AccessError(503, "WORKSPACE_NOT_CONFIGURED");
  const client = await serverClient(options);
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  const unavailable = authAvailability(error);
  if (unavailable || options?.signal?.aborted)
    throw new AccessError(unavailable ?? 503, "WORKSPACE_UNAVAILABLE");
  if (error || !user || user.is_anonymous)
    throw new AccessError(401, "SIGN_IN_REQUIRED");
  // An old tab must never save its private input under a different signed-in actor.
  // This assertion supplements, never substitutes for, verified Auth and RLS.
  const expectedActor = (await headers()).get("x-rvw-actor");
  if (expectedActor && expectedActor !== user.id)
    throw new AccessError(409, "WORKSPACE_ACTOR_CHANGED");
  return { client, userId: user.id, authMs: performance.now() - start };
}
function rpcFailure(error: { code?: string; message: string }) {
  if (
    error.code === "42501" ||
    /active|profile|authorized|member|denied/i.test(error.message)
  )
    throw new AccessError(403, "ACTIVE_PROFILE_REQUIRED");
  throw new AccessError(503, "WORKSPACE_UNAVAILABLE");
}
export async function authorizedActor(options?: ServerClientOptions) {
  const { client, userId, authMs } = await authorizedClient(options);
  const start = performance.now();
  const { data, error } = await client.rpc("lab_actor_profile");
  if (error) rpcFailure(error);
  try {
    assertActiveProfile(data, userId);
  } catch {
    throw new AccessError(403, "ACTIVE_PROFILE_REQUIRED");
  }
  return {
    client,
    userId,
    profile: data as Snapshot["profile"],
    authMs,
    rpcMs: performance.now() - start,
  };
}
export async function incrementalWorkspace(version: string | null) {
  const { client, userId, authMs } = await authorizedClient();
  const start = performance.now();
  const { data, error } = await client.rpc("lab_snapshot_if_changed", {
    p_version: version,
  });
  if (error) rpcFailure(error);
  try {
    assertActiveProfile(
      data?.unchanged ? data.profile : data?.snapshot?.profile,
      userId,
    );
  } catch {
    throw new AccessError(403, "ACTIVE_PROFILE_REQUIRED");
  }
  return {
    client,
    userId,
    authMs,
    rpcMs: performance.now() - start,
    result: {
      ...data,
      ...(data.snapshot ? { snapshot: withCoverage(data.snapshot) } : {}),
    } as {
      unchanged: boolean;
      version: string | null;
      snapshot?: Snapshot;
    },
  };
}
export async function authorizedWorkspace() {
  return workspaceForActor(await authorizedClient());
}

export async function workspaceForActor({
  client,
  userId,
  authMs,
}: Awaited<ReturnType<typeof authorizedClient>>) {
  const start = performance.now();
  const { data, error: snapshotError } = await client.rpc("lab_snapshot");
  if (snapshotError) rpcFailure(snapshotError);
  try {
    assertActiveProfile(data?.profile, userId);
  } catch {
    throw new AccessError(403, "ACTIVE_PROFILE_REQUIRED");
  }
  return {
    client,
    snapshot: withCoverage(data as Snapshot),
    userId,
    authMs,
    rpcMs: performance.now() - start,
  };
}

// Request-scoped memoization, never a cross-user/data cache.
export const pageWorkspace = cache(async () => {
  try {
    const { client, userId, result } = await incrementalWorkspace(null);
    if (!result.snapshot) throw new AccessError(503, "WORKSPACE_UNAVAILABLE");
    return {
      client,
      userId,
      snapshot: { ...result.snapshot, refresh_version: result.version, accountSettings: administrationEnabled() },
    };
  } catch (error) {
    if (error instanceof AccessError) {
      if (error.status === 401) redirect("/sign-in");
      if (error.status === 403) redirect("/access-denied");
      // A snapshot outage is not evidence of an expired session. Preserve the URL
      // and let the route error boundary offer a retry instead of another login.
      throw error;
    }
    throw error;
  }
});
