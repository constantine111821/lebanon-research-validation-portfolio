import { AccessError, authorizedWorkspace } from "@/lib/access";
import { failure, json } from "@/lib/http";
export async function GET() {
  try {
    const { snapshot } = await authorizedWorkspace();
    if (snapshot.profile.role !== "supervisor")
      throw new AccessError(403, "SUPERVISOR_REQUIRED");
    return json({
      incidents: snapshot.workflow.incidents,
      facilityReadiness: snapshot.workflow.facilities || {},
      phase2: snapshot.workflow.phase2 || {},
    });
  } catch (error) {
    return failure(error);
  }
}
