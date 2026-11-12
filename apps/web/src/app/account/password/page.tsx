import { redirect } from "next/navigation";
import { AccessError } from "@/lib/access";
import { accountActor } from "@/lib/account-control";
import { designatedOwner } from "@/lib/account-mode";
import { ownRequest } from "@/lib/account-ledger";
import { AccountPassword } from "@/components/account-password";
import { AccountAction } from "@/components/account-action";

const messages: Record<string, string> = {
  unavailable:
    "The administrator is completing account setup. Check back here later.",
  pending:
    "Awaiting administrator approval. Refresh this page after your identity has been verified.",
  denied:
    "Your request was denied. Contact the account administrator if you need help.",
  expired: "Your request expired. You can request another change.",
  rejected:
    "The password service rejected this change. Request another approval if needed.",
  completed: "Your last password change was completed.",
  processing:
    "A password change was started. If its outcome is unclear, contact the administrator before trying again.",
  uncertain:
    "The password change could not be confirmed. Check sign-in privately and contact the administrator before retrying.",
};
export default async function Password() {
  let actor;
  try {
    actor = await accountActor();
  } catch (e) {
    if (e instanceof AccessError)
      redirect(e.status === 401 ? "/sign-in" : "/access-denied");
    throw e;
  }
  if (designatedOwner(actor.userId)) redirect("/account/administration");
  const req = await ownRequest(actor);
  if (req?.state === "approved") {
    const factors = await actor.client.auth.mfa.listFactors();
    if (factors.error) throw new Error("Authenticator status unavailable");
    if (
      factors.data.totp.length &&
      (await actor.client.auth.mfa.getAuthenticatorAssuranceLevel()).data
        ?.currentLevel !== "aal2"
    )
      return (
        <main className="container">
          <section className="panel">
            <h1>Verify your authenticator</h1>
            <AccountAction
              mode="verify"
              actor={actor.userId}
              verifyLabel="Verify authenticator"
            />
          </section>
        </main>
      );
    return <AccountPassword actorId={actor.userId} approval={req.id} />;
  }
  return (
    <main className="container" id="main">
      <section className="panel">
        <h1>My account</h1>
        <p>
          {req
            ? messages[req.state]
            : "Request approval before choosing a new password. Your administrator will never see your password."}
        </p>
        {!["pending", "processing", "uncertain", "unavailable"].includes(
          req?.state,
        ) && <AccountAction actor={actor.userId} mode="request" />}
        <a href="/work">Return to workspace</a>
      </section>
    </main>
  );
}
