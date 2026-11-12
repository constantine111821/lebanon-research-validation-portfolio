import { notFound, redirect } from "next/navigation";
import { AccessError } from "@/lib/access";
import { authorizedCorrections } from "@/lib/corrections-access";
import { ScientificCorrections } from "@/components/scientific-corrections";
export default async function CorrectionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    fact?: string;
    package?: string;
    intent?: string;
    returnTo?: string;
  }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  let result: Awaited<ReturnType<typeof authorizedCorrections>> | null = null;
  try {
    result = await authorizedCorrections(id);
  } catch (error) {
    if (error instanceof AccessError && error.status === 401)
      redirect("/sign-in");
    if (error instanceof AccessError && error.status === 404) notFound();
  }
  if (!result)
    return (
      <main id="main" className="sc019">
        <h1>Scientific corrections unavailable</h1>
        <p>
          The case could not be opened with your current access. No changes were
          made. Return to the case or try again after checking your session.
        </p>
        <a href={`/cases/${encodeURIComponent(id)}`}>Return to case</a>
      </main>
    );
  return (
    <ScientificCorrections
      key={`${result.userId}:${id}`}
      initial={result.snapshot}
      actorId={result.userId}
      role={result.profile.role}
      selectedPackageId={
        typeof query.package === "string" ? query.package : undefined
      }
      selectedFactId={typeof query.fact === "string" ? query.fact : undefined}
      intent={typeof query.intent === "string" ? query.intent : undefined}
      returnTo={typeof query.returnTo === "string" ? query.returnTo : undefined}
    />
  );
}
