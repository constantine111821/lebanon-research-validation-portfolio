import "server-only";
import https from "node:https";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { AccessError } from "./access";
import { supabaseConfig } from "./config";

function isolatedClient() {
  const { url, key } = supabaseConfig();
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(12000),
        }),
    },
  });
}

export function checkPassword(password: string) {
  if ([...password].length < 15 || Buffer.byteLength(password, "utf8") > 72)
    throw new AccessError(400, "PASSWORD_LENGTH");
}

// The framework's instrumented fetch records its URL, which would include the hash prefix.
function readRange(prefix: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const unavailable = () => reject(new AccessError(503, "SCREEN_UNAVAILABLE"));
    const request = https.get({
      hostname: "api.pwnedpasswords.com",
      path: "/range/" + prefix,
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(8000),
    }, response => {
      if (response.statusCode !== 200) {
        response.destroy();
        unavailable();
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("error", unavailable);
      response.on("aborted", unavailable);
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 512 * 1024) {
          response.destroy();
          unavailable();
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    request.on("error", unavailable);
  });
}

export async function screenPassword(password: string) {
  const hash = createHash("sha1")
    .update(password, "utf8")
    .digest("hex")
    .toUpperCase();
  const body = await readRange(hash.slice(0, 5));
  const lines = body.trim().split(/\r?\n/);
  if (!lines.length || !lines.every((line) => /^[0-9A-F]{35}:\d+$/i.test(line)))
    throw new AccessError(503, "SCREEN_UNAVAILABLE");
  if (
    lines.some(
      (line) =>
        line.slice(0, 35).toUpperCase() === hash.slice(5) &&
        Number(line.slice(36)) > 0,
    )
  )
    throw new AccessError(400, "COMPROMISED_PASSWORD");
}

export async function verifyCurrentPassword(
  email: string,
  userId: string,
  password: string,
) {
  const proof = isolatedClient();
  const { data, error } = await proof.auth.signInWithPassword({
    email,
    password,
  });
  if (error?.status === 429) throw new AccessError(429, "SLOW_DOWN");
  if (error)
    throw new AccessError(
      error.status && error.status >= 500 ? 503 : 403,
      "CURRENT_PASSWORD_CHECK_FAILED",
    );
  try {
    if (data.user?.id !== userId)
      throw new AccessError(403, "CURRENT_PASSWORD_CHECK_FAILED");
  } finally {
    await proof.auth.signOut({ scope: "local" }).catch(() => {});
  }
}
