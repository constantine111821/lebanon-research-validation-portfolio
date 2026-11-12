import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceStore } from "../../apps/web/src/approved/transport.js";
test("conditional navigation uses same-origin active checks and refuses unmatched acknowledgements", async () => {
  const previous = globalThis.fetch,
    version = "a".repeat(64),
    snapshot = {
      refresh_version: version,
      profile: { user_id: "synthetic-owner" },
      drafts: [{ id: "synthetic-private" }],
    };
  try {
    let allowed = true;
    globalThis.fetch = async (url, options) => {
      assert(String(url).includes("?version=" + version));
      assert.equal(options?.credentials, "same-origin");
      assert.equal(options?.cache, "no-store");
      assert(!("Authorization" in (options?.headers || {})));
      return new Response(
        JSON.stringify(
          allowed
            ? { unchanged: true, version }
            : { error: "ACTIVE_PROFILE_REQUIRED" },
        ),
        { status: allowed ? 200 : 403 },
      );
    };
    const store = new WorkspaceStore(snapshot);
    assert.equal(await store.snapshot(), snapshot);
    allowed = false;
    await assert.rejects(
      store.snapshot(),
      (e: { labAccessDenied?: boolean }) => e.labAccessDenied === true,
    );
    store.saveSession();
    assert.equal(store.currentSnapshot, null);
    const mismatch = new WorkspaceStore(snapshot);
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ unchanged: true, version: "b".repeat(64) }),
      );
    await assert.rejects(mismatch.snapshot(), /version mismatch/);
  } finally {
    globalThis.fetch = previous;
  }
});
test("post-write refresh follows an older in-flight read and adopts current revisions", async () => {
  const previous = globalThis.fetch;
  try {
    let release: (value: Response) => void = () => {},
      n = 0;
    globalThis.fetch = async () => {
      if (n++ === 0)
        return new Promise<Response>((resolve) => (release = resolve));
      return new Response(
        JSON.stringify({
          unchanged: false,
          version: "b".repeat(64),
          snapshot: { revisions: { INCIDENT: { fixture: 2 } }, drafts: [] },
        }),
      );
    };
    const store = new WorkspaceStore({
      refresh_version: "a".repeat(64),
      revisions: { INCIDENT: { fixture: 1 } },
      drafts: [],
    });
    const old = store.snapshot();
    await Promise.resolve();
    const next = store.snapshot();
    release(
      new Response(
        JSON.stringify({ unchanged: true, version: "a".repeat(64) }),
      ),
    );
    assert.equal((await old).revisions.INCIDENT.fixture, 1);
    assert.equal((await next).revisions.INCIDENT.fixture, 2);
    assert.equal(n, 2);
  } finally {
    globalThis.fetch = previous;
  }
});
