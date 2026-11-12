// Same-origin cookie transport. No browser Supabase credentials or session tokens.
const canonical = (x) =>
  JSON.stringify(x, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
export class WorkspaceStore {
  constructor(initialSnapshot = null) {
    this.mode = "supabase";
    this.session = true;
    this.identity = "server-cookie";
    this.actor = initialSnapshot?.profile?.user_id;
    this.currentSnapshot = initialSnapshot;
    this.version = initialSnapshot?.refresh_version || null;
    this.readQueue = Promise.resolve();
  }
  saveSession() {
    this.session = false;
    this.currentSnapshot = null;
    this.version = null;
  }
  async request(path, method = "GET", body) {
    let r;
    try {
      r = await fetch(path, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", ...(this.actor ? {"X-RVW-Actor": this.actor} : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw Error(
        "The connection was interrupted. Your private changes are retained. Retry the same operation to recover its saved result.",
      );
    }
    const d = await r.json();
    if (!r.ok) {
      const e = Error(
        d.message ||
          (d.error === "WORKSPACE_ACTOR_CHANGED"
            ? "The signed-in account changed. Keep this tab's work private; sign in as its original researcher before retrying."
            : d.error === "DRAFT_CONFLICT"
            ? "This private draft changed. Your working proposal is retained; reload the saved draft before replacing it."
            : d.error) ||
          "Workspace request failed.",
      );
      e.code = d.error;
      e.details = d.details;
      e.status = r.status;
      e.sessionExpired = r.status === 401;
      e.labAccessDenied = d.error === "ACTIVE_PROFILE_REQUIRED";
      throw e;
    }
    return d;
  }
  snapshot() {
    // The server checks verified identity/active membership on EVERY read. Reuse
    // only this mounted user's data after an exact backing-state version match.
    // Queue overlapping refreshes so a post-commit read cannot adopt an older
    // in-flight acknowledgement. There is no browser-persistent/shared cache.
    const next = this.readQueue.then(async () => {
      const result = await this.request(
        "/api/workspace?version=" + encodeURIComponent(this.version || ""),
      );
      if (result.unchanged) {
        if (!this.currentSnapshot || result.version !== this.version)
          throw Error("Workspace refresh version mismatch.");
      } else {
        if (!result.snapshot)
          throw Error("Workspace refresh returned no findings.");
        this.currentSnapshot = result.snapshot;
        this.version = result.version;
        this.currentSnapshot.refresh_version = result.version;
      }
      return this.currentSnapshot;
    });
    this.readQueue = next.catch(() => {});
    return next;
  }
  commit(request) {
    return this.request("/api/commands", "POST", request);
  }
  async saveDraft(id, revision, payload) {
    // Serialize this actor's private writes across tabs of this origin/profile.
    // Other devices still rely on the authoritative server revision check.
    if (globalThis.navigator?.locks && this.actor)
      return navigator.locks.request('rvw-private-draft:' + this.actor,
        {mode:'exclusive', signal:AbortSignal.timeout(10000)},
        () => this.saveDraftRequest(id, revision, payload));
    return this.saveDraftRequest(id, revision, payload);
  }
  async saveDraftRequest(id, revision, payload) {
    try {
      return await this.request("/api/drafts", "POST", {
        id,
        expected_revision: revision,
        payload,
      });
    } catch (error) {
      // Read-only lost-ack recovery accepts only the exact save at the next revision.
      // Different concurrent work is never overwritten or silently adopted.
      try {
        const rows = await this.request("/api/drafts");
        const d = rows.find((d) => d.id === id || d.draft_id === id);
        if (
          d?.revision === revision + 1 &&
          canonical(d.payload) === canonical(payload)
        )
          return d;
      } catch {}
      throw error;
    }
  }
  deleteDraft(id, revision) {
    return this.request("/api/drafts", "DELETE", {
      id,
      expected_revision: revision,
    });
  }
  logout() {
    return this.request("/api/session", "DELETE", {});
  }
}
