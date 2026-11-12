import { SignOut } from "@/components/session-controls";
export default function AccessDenied() {
  return (
    <main id="main" className="narrow empty-state">
      <span className="eyebrow">ACCESS REQUIRED</span>
      <h1>Your account cannot open this workspace</h1>
      <p>
        Ask the project owner to check your access. Your research and saved
        drafts are unchanged.
      </p>
      <SignOut />
    </main>
  );
}
