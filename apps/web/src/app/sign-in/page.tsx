import { LoginForm } from "@/components/session-controls";
export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ unavailable?: string }>;
}) {
  const query = await searchParams;
  const configured = Boolean(
    process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY,
  );
  return (
    <main id="main" className="sign-in">
      <div className="login-story">
        <span className="eyebrow">LEBANON / RESEARCH VALIDATION</span>
        <h1>
          Research together.
          <br />Keep the evidence clear.
        </h1>
        <p>
          Check facts against their sources and keep uncertainty visible.
        </p>
        <ol>
          <li>Find the case and confirm the facility.</li>
          <li>Check the facts against their sources.</li>
          <li>Keep unfinished work in your private draft.</li>
        </ol>
        <span className="story-foot">PRIVATE PILOT · INDIVIDUAL ACCOUNTS</span>
      </div>
      <section className="login-card">
        <span className="eyebrow">WELCOME BACK</span>
        <h2>Sign in to your workspace</h2>
        <p className="muted">
          Use the account provided by the project owner.
        </p>
        {(!configured || query.unavailable) && (
          <p role="status" className="callout">
            The workspace connection is not available yet. Contact the project
            owner.
          </p>
        )}
        <LoginForm configured={configured} />
        <p className="small muted">
          Your private drafts are visible only to you.
        </p>
      </section>
    </main>
  );
}
