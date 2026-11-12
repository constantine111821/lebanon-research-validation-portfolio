import { pageWorkspace } from "@/lib/access";
import { PrivateResearchNotes } from "@/components/private-research-notes";

export default async function Notes({
  searchParams,
}: {
  searchParams: Promise<{ incident?: string }>;
}) {
  const [{ userId, snapshot }, { incident }] = await Promise.all([
    pageWorkspace(),
    searchParams,
  ]);
  const cases = snapshot.records.INCIDENT.map(record => ({
    id: record.incident_id,
    label: String(record.incident_label || record.incident_id),
  }));
  return <PrivateResearchNotes actor={userId} cases={cases} incident={incident} />;
}
