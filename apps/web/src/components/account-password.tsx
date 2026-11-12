"use client";
import { useState } from "react";

const errors: Record<string, string> = {
  APPROVAL_REQUIRED:
    "This approval is no longer available. Refresh your account page.",
  REQUEST_CHANGED:
    "This approval expired or was already used. Refresh your account page.",
  OUTCOME_UNCERTAIN:
    "The change could not be confirmed. Check sign-in privately and contact the administrator before trying again.",
  COMPROMISED_PASSWORD:
    "This passphrase appears in known breaches. Choose another.",
  SCREEN_UNAVAILABLE: "Password screening is unavailable. Try later.",
  PASSWORD_LENGTH: "Use at least 15 characters and at most 72 UTF-8 bytes.",
  CURRENT_PASSWORD_CHECK_FAILED: "Could not verify the current password.",
  ACCOUNT_ACCESS_REQUIRED: "Contact the project owner about workspace access.",
  SECOND_FACTOR_REQUIRED:
    "Complete your enrolled second factor or contact the project owner for account recovery.",
  PASSWORD_REJECTED:
    "Auth rejected this password change. Check your current password and choose a new passphrase.",
  WORKSPACE_ACTOR_CHANGED:
    "The signed-in account changed. Close this tab and reopen Change password.",
  SLOW_DOWN: "Please wait before trying again.",
  SIGN_IN_REQUIRED: "Sign in to the workspace and try again.",
  FRESH_SIGN_IN_REQUIRED:
    "Secure your unfinished work, sign in again, then reopen Change password.",
};

export function AccountPassword({
  actorId,
  approval,
}: {
  actorId: string;
  approval: string;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [done, setDone] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget,
      data = new FormData(form);
    if (data.get("password") !== data.get("repeat")) {
      setMessage("The new passwords do not match.");
      return;
    }
    const body = {
      action: "change",
      approval,
      currentPassword: data.get("current"),
      password: data.get("password"),
    };
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/account/password", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "x-rvw-actor": actorId },
        body: JSON.stringify(body),
      });
      const result = await r.json();
      if (!r.ok) {
        setMessage(
          errors[result.error] ||
            "The account service could not complete the request. Try again shortly.",
        );
        return;
      }
      form.reset();
      setDone(true);
      setMessage(
        "Password changed. Use the new password the next time you sign in.",
      );
    } catch {
      setMessage(
        "The response could not be confirmed. If you submitted a password change, check sign-in before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="main" className="container">
      <section className="panel">
        <h1>Change password</h1>
        {!done && (
          <form
            className="login-form"
            onSubmit={submit}
            method="post"
            action="/api/account/password"
          >
            <noscript>
              Enable JavaScript in this browser to use this form.
            </noscript>
            <label>
              Current password
              <input
                required
                name="current"
                type="password"
                autoComplete="current-password"
              />
            </label>
            <label>
              New passphrase
              <input
                required
                name="password"
                type="password"
                autoComplete="new-password"
              />
            </label>
            <label>
              Confirm new passphrase
              <input
                required
                name="repeat"
                type="password"
                autoComplete="new-password"
              />
            </label>
            <p>
              Use a unique passphrase of at least 15 characters and at most 72
              UTF-8 bytes.
            </p>
            <button className="primary" disabled={busy}>
              {busy ? "Working..." : "Change password"}
            </button>
          </form>
        )}
        {message && <p role="status">{message}</p>}
        <a href="/work">Return to workspace</a>
      </section>
    </main>
  );
}
