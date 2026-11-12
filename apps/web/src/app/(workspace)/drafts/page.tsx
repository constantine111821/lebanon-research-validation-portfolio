import { pageWorkspace } from "@/lib/access";
import { ApprovedWorkspace } from "@/components/approved-workspace";
export default async function Drafts() {
  const { snapshot } = await pageWorkspace();
  return <ApprovedWorkspace snapshot={snapshot} />;
}
