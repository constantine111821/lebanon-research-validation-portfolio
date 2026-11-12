import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseConfig, cookieSecurity } from "./config";

export type ServerClientOptions = {
  signal?: AbortSignal;
  deferCookies?: (write: () => void) => void;
  snapshotByteLimit?: { maxBytes: number; onLimit: () => void };
};

function limitSnapshotResponse(
  response: Response,
  { maxBytes, onLimit }: NonNullable<ServerClientOptions["snapshotByteLimit"]>,
) {
  if (!response.ok || !response.body) return response;
  if (Number(response.headers.get("content-length")) > maxBytes) {
    void response.body.cancel().catch(() => {});
    onLimit();
    throw new Error("WORKSPACE_SNAPSHOT_LIMIT");
  }
  let bytes = 0;
  const bounded = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        onLimit();
        controller.error(new Error("WORKSPACE_SNAPSHOT_LIMIT"));
        return;
      }
      controller.enqueue(chunk);
    },
  }));
  return new Response(bounded, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export async function serverClient(
  { signal, deferCookies, snapshotByteLimit }: ServerClientOptions = {},
) {
  const store = await cookies();
  const { url, key } = supabaseConfig();
  return createServerClient(url, key, {
    cookieOptions: cookieSecurity(),
    cookies: {
      getAll: () => store.getAll(),
      setAll(values) {
        const write = () => {
          // Server Components cannot write cookies. The proxy handles refreshes there.
          try {
            values.forEach(({ name, value, options }) =>
              store.set(name, value, { ...options, ...cookieSecurity() }),
            );
          } catch {
            /* Read-only Server Component context. */
          }
        };
        if (deferCookies) deferCookies(write);
        else write();
      },
    },
    global: {
      fetch: async (input, init) => {
        const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        const response = await fetch(input, {
          ...init,
          ...(signal && { signal: requestSignal ? AbortSignal.any([signal, requestSignal]) : signal }),
          cache: "no-store",
        });
        if (!snapshotByteLimit) return response;
        const requestUrl = input instanceof Request ? input.url : input;
        return new URL(requestUrl).pathname === "/rest/v1/rpc/lab_snapshot"
          ? limitSnapshotResponse(response, snapshotByteLimit)
          : response;
      },
    },
  });
}
