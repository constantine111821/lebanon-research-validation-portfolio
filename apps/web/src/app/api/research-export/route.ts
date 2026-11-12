import assets from "../../../../../../packages/domain/src/export-assets.json";
import {
  buildResearchPackage,
  ResearchPackageSizeError,
} from "../../../../../../packages/domain/src/research-export.mjs";
import { AccessError, authorizedActor, workspaceForActor } from "@/lib/access";
import { failure, json } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 30;

const workBudgetMs = 20_000;
const maxSnapshotBytes = 16 * 1024 * 1024;
// Leave room below the hosted function response size limit.
const maxArchiveBytes = 4 * 1024 * 1024;
const maxIncidents = 500;
const maxRecords = 10_000;
let exporting = false;

export async function GET(request: Request) {
  const deadline = performance.now() + workBudgetMs;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(workBudgetMs)]);
  const checkBudget = () => {
    if (signal.aborted || performance.now() >= deadline)
      throw new AccessError(503, "RESEARCH_EXPORT_UNAVAILABLE");
  };
  let admitted = false;
  let snapshotTooLarge = false;
  try {
    const actor = await authorizedActor({
      signal,
      snapshotByteLimit: {
        maxBytes: maxSnapshotBytes,
        onLimit: () => { snapshotTooLarge = true; },
      },
    });
    checkBudget();
    if (exporting) return json({ error: "RESEARCH_EXPORT_BUSY" }, 429);
    // This admission gate is local to each function instance.
    exporting = admitted = true;
    const { snapshot } = await workspaceForActor(actor);
    checkBudget();
    const records = Object.values(snapshot.records).reduce((count, rows) => count + rows.length, 0);
    if (snapshot.records.INCIDENT.length > maxIncidents || records > maxRecords)
      throw new ResearchPackageSizeError();
    const datasetContext =
      process.env.RVW_BACKEND_MODE === "hosted"
        ? "CURRENT_ELIGIBLE_HOSTED_WORKSPACE"
        : process.env.RVW_TEST_AUTH_LABEL === "simulated"
          ? "CURRENT_ELIGIBLE_LOCAL_WORKSPACE_SIMULATED_AUTH"
          : "CURRENT_ELIGIBLE_DISPOSABLE_LOCAL_SUPABASE";
    const result = buildResearchPackage(snapshot, {
      appCommit: process.env.RVW_BUILD_COMMIT,
      datasetContext,
      schema: assets.schema,
      consumer: assets.consumer,
      maxArchiveBytes,
      checkBudget,
    });
    return new Response(new Uint8Array(result.bytes), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (snapshotTooLarge || error instanceof ResearchPackageSizeError)
      return json({ error: "RESEARCH_EXPORT_TOO_LARGE" }, 413);
    if (signal.aborted) return json({ error: "RESEARCH_EXPORT_UNAVAILABLE" }, 503);
    return failure(error);
  } finally {
    if (admitted) exporting = false;
  }
}
