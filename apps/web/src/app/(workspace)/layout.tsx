import { pageWorkspace } from "@/lib/access";
export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await pageWorkspace();
  return (
    <>
      {process.env.RVW_TEST_AUTH_LABEL === "simulated" && (
        <div className="test-banner" role="status">
          Local test workspace · Sign-in is simulated. No connected research is
          changed.
        </div>
      )}
      {process.env.RVW_DISPOSABLE_ANALYTICS === "1" && (
        <div className="test-banner" role="status">Disposable analytics verification · synthetic snapshots · real Supabase/Auth</div>
      )}
      {children}
    </>
  );
}
