"use client";
import { useState } from "react";
export function AccountAction({
  actor,
  id,
  mode,
  verifyLabel = "Verify administrator",
}: {
  actor: string;
  id?: string;
  verifyLabel?: string;
  mode: "request" | "decision" | "verify";
}) {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="login-form"
      method="post"
      action="/api/account/requests"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const form = e.currentTarget,
          data = new FormData(form),
          action =
            (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ||
            mode;
        const body =
          action === "approve"
            ? { action, id, method: data.get("method") }
            : action === "deny"
              ? { action, id }
              : action === "verify"
                ? { action, code: data.get("code") }
                : { action };
        if (action === "approve" && !data.get("method")) {
          setMessage("Select how you verified the researcher first.");
          return;
        }
        setBusy(true);
        setMessage("");
        try {
          const r = await fetch("/api/account/requests", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-rvw-actor": actor,
            },
            body: JSON.stringify(body),
          });
          if (r.ok) {
            form.reset();
            window.location.reload();
            return;
          }
          setMessage(
            r.status === 409
              ? "The request or signed-in account changed. Refresh this page."
              : r.status === 429
                ? "Too many requests. Try again later."
                : r.status === 403
                  ? "Access or verification was denied. Refresh and verify your identity."
                  : "The request was not confirmed. Refresh to see its status.",
          );
        } catch {
          setMessage(
            "The response was interrupted. Refresh before trying again.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      {mode === "decision" ? (
        <>
          <label>
            Identity verification
            <select name="method" defaultValue="">
              <option value="">Choose method</option>
              <option value="in-person">Verified in person</option>
              <option value="known-callback">
                Callback to number already on file
              </option>
            </select>
          </label>
          <div>
            <button className="primary" value="approve" disabled={busy}>
              Approve
            </button>{" "}
            <button value="deny" disabled={busy}>
              Deny
            </button>
          </div>
        </>
      ) : mode === "verify" ? (
        <>
          <label>
            Authenticator code
            <input
              type="password"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              required
            />
          </label>
          <button disabled={busy}>{verifyLabel}</button>
        </>
      ) : (
        <button className="primary" disabled={busy}>
          Request password change
        </button>
      )}
      {message && <p role="alert">{message}</p>}
    </form>
  );
}
