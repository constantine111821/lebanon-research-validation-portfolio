import { pageWorkspace } from "@/lib/access";
import { ApprovedWorkspace } from "@/components/approved-workspace";
export default async function Work() {
  const { snapshot } = await pageWorkspace();
  return <ApprovedWorkspace snapshot={snapshot} />;
}
