import { redirect } from "next/navigation";
import { AccessError } from "@/lib/access";
import { accountActor, freshOwner } from "@/lib/account-control";
import { OwnerEnroll } from "@/components/owner-enroll";
import { dashboard, command } from "@/lib/account-ledger";
import { AccountAction } from "@/components/account-action";
const time = (v: string | null) =>
  v
    ? new Date(v).toISOString().replace("T", " ").slice(0, 16) + " UTC"
    : "Unavailable";
export default async function Administration() {
  let actor, verified, binding;
  try {
    actor = await accountActor();
    verified = await freshOwner(actor);
    binding = await command(actor, "owner");
  } catch (e) {
    if (e instanceof AccessError)
      redirect(e.status === 401 ? "/sign-in" : "/access-denied");
    throw e;
  }
  if (binding.factor === null) {
    const { data, error } = await actor.client.auth.mfa.listFactors();
    if (error) throw new Error("Authenticator status unavailable");
    const factors = data.totp.filter((f) => f.status === "verified");
    return (
      <main className="container">
        <section className="panel">
          <h1>Administrator authenticator setup</h1>
          {factors.length ? (
            <>
              <p>
                Complete the one-time administrator binding with your verified
                factor reference.
              </p>
              <ul>
                {factors.map((f) => (
                  <li key={f.id}>
                    {f.friendly_name} · <code>{f.id}</code>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <OwnerEnroll actor={actor.userId} />
          )}
          <a href="/work">Return to workspace</a>
        </section>
      </main>
    );
  }
  if (!verified || !binding.bound_session)
    return (
      <main className="container">
        <section className="panel">
          <h1>Account administration</h1>
          <p>
            Use your enrolled authenticator to open account records.
            Verification lasts ten minutes.
          </p>
          <AccountAction mode="verify" actor={actor.userId} />
          <a href="/work">Return to workspace</a>
        </section>
      </main>
    );
  const { roster, requests, history, activity } = await dashboard(actor);
  return (
    <main className="container" id="main">
      <section className="panel">
        <h1>Account administration</h1>
        <a href="/work">Return to workspace</a>
        <h2>Pending requests ({requests.length})</h2>
        {!requests.length && <p>No requests awaiting review.</p>}
        {requests.map(
          (r: {
            id: string;
            holder: string;
            name: string;
            masked_email: string | null;
            expires: string;
          }) => (
            <fieldset key={r.id}>
              <legend>
                {r.name} · {r.masked_email ?? "No sign-in address"}
              </legend>
              <small>Account reference: {r.holder}</small>
              <p>
                Verify this person independently before approving. Request
                expires {time(r.expires)}.
              </p>
              <AccountAction mode="decision" actor={actor.userId} id={r.id} />
            </fieldset>
          ),
        )}
        <h2>Accounts ({roster.length})</h2>
        <table>
          <thead>
            <tr>
              {[
                "Name",
                "Research role",
                "Workspace access",
                "Sign-in status",
                "Last sign-in",
              ].map((t) => (
                <th key={t}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roster.map(
              (r: {
                id: string;
                name: string;
                masked_email: string | null;
                role: string | null;
                active: boolean | null;
                confirmed: boolean;
                banned: boolean;
                last_sign_in: string | null;
              }) => (
                <tr key={r.id}>
                  <td>
                    {r.name}
                    <br />
                    <small>
                      {r.masked_email ?? "No sign-in address"} ·{" "}
                      {r.id.slice(-6)}
                    </small>
                  </td>
                  <td>{r.role ?? "No mapping"}</td>
                  <td>
                    {r.active === null
                      ? "No profile"
                      : r.active
                        ? "Active"
                        : "Inactive"}
                  </td>
                  <td>
                    {r.banned
                      ? "Suspended"
                      : r.confirmed
                        ? "Confirmed"
                        : "Unconfirmed"}
                  </td>
                  <td>{time(r.last_sign_in)}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
        <p>
          For a sign-in problem, check the account status and workspace mapping
          separately. A past successful sign-in does not explain a later
          failure. Individual failed attempts are not available here.
        </p>
        <h2>Recent authentication activity</h2>
        <p>Available provider events from the past seven days (up to 30).</p>
        {activity.length === 0 ? (
          <p>No matching events available.</p>
        ) : (
          <ol>
            {activity.map(
              (e: { at: string; name: string; event: string }, i: number) => (
                <li key={i}>
                  {time(e.at)} · {e.name} · {e.event.replaceAll("_", " ")}
                </li>
              ),
            )}
          </ol>
        )}
        <h2>Account action history</h2>
        <p>Latest 100 website events. Times are UTC.</p>
        <ol>
          {history.map(
            (
              e: {
                at: string;
                action: string;
                actor: string;
                holder: string;
                basis: string | null;
                request_id: string;
              },
              i: number,
            ) => (
              <li key={i}>
                {time(e.at)} · {e.actor} · {e.action} · {e.holder}
                {e.basis ? " · " + e.basis : ""} · Reference {e.request_id}
              </li>
            ),
          )}
        </ol>
      </section>
    </main>
  );
}
