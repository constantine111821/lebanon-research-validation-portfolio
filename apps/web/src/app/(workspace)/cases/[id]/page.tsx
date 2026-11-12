import { notFound } from "next/navigation";
import { pageWorkspace } from "@/lib/access";
import { ApprovedWorkspace } from "@/components/approved-workspace";
export default async function Case({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { snapshot } = await pageWorkspace();
  if (!snapshot.records.INCIDENT.some((i) => i.incident_id === id)) notFound();
  return (
    <ApprovedWorkspace snapshot={snapshot} view="incident" incidentId={id} />
  );
}
