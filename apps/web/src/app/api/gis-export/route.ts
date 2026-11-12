import authorities from "../../../../../../packages/domain/src/gis-geography-authority.json";
import {
  buildGISExport,
  GISIntegrityError,
} from "../../../../../../packages/domain/src/gis-export.mjs";
import { incrementalWorkspace, authorizedActor, AccessError } from "@/lib/access";
import { acquireGISProjection, gisCSVStream } from "@/lib/gis-delivery.mjs";
import { failure, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request) {
  let release: (() => void) | null = null;
  let streamed = false;
  try {
    const deadline = Date.now() + 270000;
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") || "full";
    const format = url.searchParams.get("format") || "summary";
    if (
      !["full", "simplified"].includes(mode) ||
      !["summary", "csv", "receipt", "verify", "package-summary", "package"].includes(format) ||
      (format.startsWith("package") && mode !== "full")
    )
      throw new AccessError(400, "GIS_INVALID_REQUEST");
    const expected = url.searchParams.get("version");
    if (format === "verify") {
      if (!expected || !/^[a-f0-9]{64}$/.test(url.searchParams.get("checksum") || ""))
        throw new AccessError(400, "GIS_INVALID_REQUEST");
      const { result } = await incrementalWorkspace(expected);
      if (!result.unchanged || result.version !== expected)
        throw new AccessError(409, "GIS_DATA_CHANGED_REVIEW_AGAIN");
      return json({ status: "UNCHANGED", snapshot_version: result.version });
    }
    // Authenticate before admission; only then load a potentially large snapshot.
    await authorizedActor();
    // Defer the unverified buffered ZIP transport; CSV eligibility is unchanged.
    if (format.startsWith("package"))
      throw new AccessError(503, "GIS_PRESENTATION_DEFERRED_FOR_LAUNCH");
    release = acquireGISProjection();
    if (!release) throw new AccessError(429, "GIS_EXPORT_BUSY");
    const { client, result } = await incrementalWorkspace(null);
    if (!result.snapshot || !result.version)
      throw new AccessError(503, "GIS_SNAPSHOT_UNAVAILABLE");
    if (expected && expected !== result.version)
      throw new AccessError(409, "GIS_DATA_CHANGED_REVIEW_AGAIN");
    const output = buildGISExport(result.snapshot, {
      mode,
      origin: process.env.APP_ORIGIN,
      appCommit: process.env.RVW_BUILD_COMMIT,
      snapshotVersion: result.version,
      authorities,
      deadline,
    });
    // The canonical snapshot was transactionally consistent. Recheck only after
    // the complete CSV has been generated, so intervening approval/data changes
    // fail closed. This check is the export's documented linearization point.
    const { data: latest, error } = await client.rpc(
      "lab_snapshot_if_changed",
      { p_version: result.version },
    );
    if (error || !latest?.unchanged || latest.version !== result.version)
      throw new AccessError(409, "GIS_DATA_CHANGED_REVIEW_AGAIN");
    if (
      url.searchParams.has("checksum") &&
      url.searchParams.get("checksum") !== output.receipt.content_sha256
    )
      throw new AccessError(409, "GIS_DATA_CHANGED_REVIEW_AGAIN");
    if (format === "summary")
      return json({
        ...output.summary,
        receipt: output.receipt,
        filename: output.filename,
      });
    if (!output.csv) throw new AccessError(409, "GIS_NO_ELIGIBLE_FEATURES");
    if (format === "receipt")
      return new Response(JSON.stringify(output.receipt, null, 2) + "\n", {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "private, no-store",
          "Content-Disposition": `attachment; filename="${output.filename.replace(".csv", ".receipt.json")}"`,
        },
      });
    if (Date.now() >= deadline) throw new AccessError(503, "GIS_EXPORT_TIME_BUDGET");
    const stream = gisCSVStream(output.csv, output.receipt, release);
    streamed = true;
    return new Response(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "private, no-store",
        Pragma: "no-cache",
        "Content-Disposition": `attachment; filename="${output.filename}"`,
        "X-Content-SHA256": output.receipt.content_sha256!,
        "X-GIS-Schema": output.receipt.schema_version,
        "X-GIS-Content-Length": String(output.receipt.content_length_bytes),
        "X-GIS-Snapshot-Version": result.version,
        "Content-Length": String(output.receipt.content_length_bytes),
      },
    });
  } catch (error) {
    if (error instanceof GISIntegrityError)
      return json({ error: error.code }, 422);
    return failure(error);
  } finally {
    if (!streamed) release?.();
  }
}
