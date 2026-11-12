// EXPLICIT TEST DOUBLE: PostgreSQL is real PGlite; Auth and HTTP transport are simulated.
// Never imported by the web app, never a production authentication fallback.
import http from "node:http";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { createDatabase, users } from "./database.mjs";
if (process.env.RVW_ENABLE_TEST_FIXTURE !== "1")
  throw new Error(
    "Set RVW_ENABLE_TEST_FIXTURE=1 explicitly for the localhost test double.",
  );
const allowTestControls = process.env.RVW_ENABLE_FIXTURE_CONTROLS === "1";
let db = await createDatabase();
const secret = randomBytes(32),
  sessions = new Map(),
  refreshes = new Map();
const faults = {
  "auth-throttled": ["/auth/v1/token", 429, "over_request_rate_limit"],
  "auth-unavailable": ["/auth/v1/token", 503, "unexpected_failure"],
  "auth-gateway-timeout": ["/auth/v1/token", 504, "unexpected_failure"],
  "profile-unavailable": ["/rest/v1/rpc/lab_actor_profile", 503, "TEST_PROFILE_UNAVAILABLE"],
  "snapshot-unavailable": ["/rest/v1/rpc/lab_snapshot", 503, "TEST_SNAPSHOT_UNAVAILABLE"],
  "draft-unavailable": ["/rest/v1/rpc/lab_save_draft", 503, "TEST_DRAFT_UNAVAILABLE"],
};
let fault = null;
const snapshotPath = "/rest/v1/rpc/lab_snapshot";
const password = "Local-fixture-only-2026!";
const publicUser = (u) => ({
  id: u.id,
  aud: "authenticated",
  role: "authenticated",
  email: u.email,
  app_metadata: { provider: "email" },
  user_metadata: { role: u.role },
  created_at: "2026-01-01T00:00:00Z",
  is_anonymous: false,
});
const b64 = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
function issue(user) {
  const head = b64({ alg: "HS256", typ: "JWT" }),
    payload = b64({
      sub: user.id,
      aud: "authenticated",
      role: "authenticated",
      email: user.email,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      jti: randomBytes(12).toString("hex"),
    });
  const token =
    head +
    "." +
    payload +
    "." +
    createHmac("sha256", secret)
      .update(head + "." + payload)
      .digest("base64url");
  const refresh = randomBytes(32).toString("hex");
  sessions.set(token, user);
  refreshes.set(refresh, { user, token });
  return {
    access_token: token,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: refresh,
    user: publicUser(user),
  };
}
function current(request) {
  const token = request.headers.authorization?.replace(/^Bearer /i, "") || "";
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const signature = createHmac("sha256", secret)
    .update(parts[0] + "." + parts[1])
    .digest("base64url");
  if (
    signature.length !== parts[2].length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(parts[2]))
  )
    return null;
  return sessions.get(token) || null;
}
async function body(request) {
  let data = "";
  for await (const chunk of request) {
    data += chunk;
    if (data.length > 2_000_000) throw new Error("Body too large");
  }
  return data ? JSON.parse(data) : {};
}
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const send = (data, status = 200) => {
    response.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(data));
  };
  try {
    if (url.pathname === "/health")
      return send({
        mode: "SIMULATED_AUTH_PGLITE_SQL",
        human_preview: !allowTestControls,
        persistent: false,
        ready: true,
      });
    if (fault && faults[fault]?.[0] === url.pathname) {
      const [, status, code] = faults[fault];
      await body(request);
      return send({ code, message: "Synthetic provider fault" }, status);
    }
    if (fault && url.pathname === snapshotPath) {
      if (fault === "snapshot-delayed") await new Promise(resolve => setTimeout(resolve, 350));
      if (fault === "snapshot-oversized") {
        response.setHeader("Content-Length", 17 * 1024 * 1024);
        return send({});
      }
    }
    if (url.pathname === "/auth/v1/token" && request.method === "POST") {
      const data = await body(request);
      if (url.searchParams.get("grant_type") === "refresh_token") {
        const previous = refreshes.get(data.refresh_token);
        if (!previous) return send({ message: "Refresh denied" }, 401);
        refreshes.delete(data.refresh_token);
        sessions.delete(previous.token);
        return send(issue(previous.user));
      }
      const user = Object.values(users).find((u) => u.email === data.email);
      if (!user || data.password !== password)
        return send(
          {
            error: "invalid_grant",
            error_description: "Invalid login credentials",
          },
          400,
        );
      return send(issue(user));
    }
    if (url.pathname === "/auth/v1/.well-known/jwks.json")
      return send({ keys: [] });
    if (url.pathname === "/auth/v1/user")
      return current(request)
        ? send(publicUser(current(request)))
        : send({ message: "Invalid token" }, 401);
    if (url.pathname === "/auth/v1/logout") {
      const token = request.headers.authorization?.replace(/^Bearer /i, "");
      sessions.delete(token);
      for (const [key, session] of refreshes)
        if (session.token === token) refreshes.delete(key);
      return send({});
    }
    if (url.pathname === "/auth/v1/signup")
      return send({ message: "Signups not allowed" }, 403);
    if (allowTestControls && url.pathname === "/__control" && request.method === "POST") {
      if (request.headers["x-fixture-control"] !== "local-fixture-control")
        return send({ error: "Denied" }, 403);
      const data = await body(request);
      if (data.fault !== undefined) {
        if (
          data.fault !== null &&
          !Object.hasOwn(faults, data.fault) &&
          !["snapshot-delayed", "snapshot-oversized"].includes(data.fault)
        )
          return send({ error: "Invalid fixture fault" }, 400);
        fault = data.fault;
      }
      if (data.reset) {
        // Tests are serial. Reset the complete disposable fixture, including shared
        // submissions; no connected project or historical file is involved.
        await db.serial(() => db.close());
        fault = null;
        db = await createDatabase();
      }
      if (typeof data.active === "boolean")
        await db.serial(() =>
          db.database.query(
            "update public.lab_profiles set active=$1 where user_id=$2",
            [data.active, users.researcher.id],
          ),
        );
      if (["researcher", "supervisor"].includes(data.role))
        await db.serial(() =>
          db.database.query(
            "update public.lab_profiles set role=$1 where user_id=$2",
            [data.role, users.researcher.id],
          ),
        );
      return send({ ok: true });
    }
    if (
      request.method === "GET" &&
      /^\/rest\/v1\/(incident|claim|lab_private_drafts)$/.test(url.pathname)
    ) {
      const user = current(request);
      if (!user) return send({ code: "42501", message: "Sign in required" }, 401);
      const relation = url.pathname.split("/").at(-1);
      const filter = url.searchParams.get("id");
      const rows = await db.as(user.id, async (sql) => {
        if (relation === "incident" && filter?.startsWith("eq.")) {
          return (await sql.query("select id from public.incident where id = $1", [filter.slice(3)])).rows;
        }
        if (relation === "claim" && filter?.startsWith("in.(") && filter.endsWith(")")) {
          const ids = filter.slice(4, -1).split(",");
          return (await sql.query("select id, incident_id from public.claim where id = any($1::text[])", [ids])).rows;
        }
        if (relation === "lab_private_drafts" && url.searchParams.get("owner_id") === `eq.${user.id}`) {
          return (await sql.query(
            "select id, owner_id, revision, payload, updated_at from public.lab_private_drafts where owner_id = $1 and id not like 'note:%' order by updated_at desc",
            [user.id],
          )).rows;
        }
        return null;
      });
      return rows === null ? send({ message: "Fixture filter unavailable" }, 400) : send(rows);
    }
    if (url.pathname.startsWith("/rest/v1/rpc/") && request.method === "POST") {
      const user = current(request);
      if (!user)
        return send({ code: "42501", message: "Sign in required" }, 401);
      const name = url.pathname.split("/").at(-1),
        data = await body(request);
      const args =
        ["lab_snapshot", "lab_actor_profile"].includes(name)
          ? []
          : name === "lab_snapshot_if_changed"
            ? [data.p_version ?? null]
            : name === "lab_analytics_read"
              ? [data.p_week ?? null]
              : name === "lab_save_draft"
                ? [data.p_id, data.p_expected_revision, data.p_payload]
                : name === "lab_delete_draft"
                  ? [data.p_id, data.p_expected_revision]
                  : name === "lab_commit"
                    ? [data.request || data.p_request]
                    : null;
      if (!args) return send({ message: "RPC unavailable" }, 404);
      try {
        return send(await db.rpc(user.id, name, args));
      } catch (error) {
        return send(
          {
            code: error.code,
            message: error.message,
            details: error.detail || error.details,
          },
          ["PT409", "PT423"].includes(error.code)
            ? 409
            : error.code === "42501"
              ? 403
              : 400,
        );
      }
    }
    return send({ error: "Not found" }, 404);
  } catch {
    return send({ error: "Fixture error" }, 500);
  }
});
server.listen(Number(process.env.RVW_FIXTURE_PORT || 43139), "127.0.0.1", () =>
  console.log(
    `SIMULATED AUTH / real PGlite SQL fixture ready on 127.0.0.1:${process.env.RVW_FIXTURE_PORT || 43139}`,
  ),
);
async function stop() {
  server.close();
  await db.close();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
