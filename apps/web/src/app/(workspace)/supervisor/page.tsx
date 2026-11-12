import { redirect } from "next/navigation";
import { pageWorkspace } from "@/lib/access";
import { ApprovedWorkspace } from "@/components/approved-workspace";
export default async function Supervisor() {
  const { snapshot } = await pageWorkspace();
  if (snapshot.profile.role !== "supervisor") redirect("/access-denied");
  return <ApprovedWorkspace snapshot={snapshot} view="supervisor" />;
}
