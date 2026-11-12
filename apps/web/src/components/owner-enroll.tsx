"use client";
import { useState } from "react";
export function OwnerEnroll({ actor }: { actor: string }) {
  const [pair, setPair] = useState<{ id: string; setupKey: string } | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <form
      method="post"
      action="/api/account/factor"
      className="login-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const form = e.currentTarget,
          data = new FormData(form);
        setBusy(true);
        setMessage("");
        try {
          const r = await fetch("/api/account/factor", {
            method: "POST",
            cache: "no-store",
            headers: {
              "Content-Type": "application/json",
              "x-rvw-actor": actor,
            },
            body: JSON.stringify(
              pair
                ? { action: "confirm", id: pair.id, code: data.get("code") }
                : { action: "enroll", current: data.get("current") },
            ),
          });
          if (!r.ok) {
            setMessage(
              "Setup could not be verified. Check your entry and try again.",
            );
            return;
          }
          form.reset();
          if (pair) {
            setPair(null);
            window.location.reload();
          } else {
            const { id, setupKey } = await r.json();
            setPair({ id, setupKey });
          }
        } catch {
          setMessage(
            "Check the connection and refresh to see your enrollment status.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      {pair ? (
        <>
          <p>
            Add an account in your authenticator using this private setup key.
            Keep it on your device.
          </p>
          <code aria-label="Private setup key">{pair.setupKey}</code>
          <label>
            Authenticator code
            <input
              name="code"
              type="password"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              required
            />
          </label>
        </>
      ) : (
        <label>
          Current password
          <input
            name="current"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
      )}
      <button disabled={busy}>
        {pair ? "Confirm authenticator" : "Set up authenticator"}
      </button>
      {message && <p role="alert">{message}</p>}
    </form>
  );
}
