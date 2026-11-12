"use client";
import { useState } from "react";
export function SignOut() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function logout() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/session", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error();
      window.location.assign("/sign-in");
    } catch {
      setError("Sign-out could not be confirmed. Please try again.");
      setBusy(false);
    }
  }
  return (
    <>
      <button className="quiet" onClick={logout} disabled={busy}>
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
export function LoginForm({ configured }: { configured: boolean }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.get("email"),
          password: data.get("password"),
        }),
      });
      if (response.status === 403) {
        setError(
          "This account cannot open the workspace. Ask the project owner to check your access.",
        );
        return;
      }
      if (!response.ok) {
        setError(response.status === 429
          ? "Sign-in is temporarily limited. Wait a moment and try again."
          : response.status >= 500
            ? "Sign-in is temporarily unavailable. Please try again shortly."
            : "Sign-in failed. Check your email and password.");
        return;
      }
      window.location.replace("/work");
    } catch {
      setError("The workspace could not be reached. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="login-form" method="post" action="/api/session">
      <noscript>Enable JavaScript in this browser to use this form.</noscript>
      <label>
        Email
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={254}
        />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
        />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="primary" disabled={!configured || busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
