import { createHash } from "node:crypto";
import { authorizedWorkspace } from "@/lib/access";
import { failure, json } from "@/lib/http";
import { arcgisHeaders, periodicalArcgisRows, periodicalArcgisSchema, periodicalArcgisTable } from "@/lib/periodical-arcgis.mjs";
import { periodicalReport, periodicalScope } from "@/lib/periodical-data.mjs";
import { selectPeriodicalScope } from "@/lib/periodical-scope.mjs";
import { periodicalArcgisZip, periodicalXlsx, PeriodicalSpreadsheetLimitError } from "@/lib/periodical-serialization.mjs";
import { periodicalWorkbook } from "@/lib/periodical-workbook.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const mediaTypes = {
  arcgis: "application/zip",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const snapshotCalendar = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});
function snapshotId(
  snapshot: Awaited<ReturnType<typeof authorizedWorkspace>>["snapshot"],
  date: string,
  report: string,
  scope: string,
) {
  const { records, revisions, workflow, source_excerpts } = snapshot;
  const { dispositions, phase2_approvals, team } = snapshot as typeof snapshot & {
    dispositions?: unknown;
    phase2_approvals?: unknown;
    team?: { user_id: string; display_name: string }[];
  };
  return createHash("sha256").update(JSON.stringify([
    date, report, scope, records, revisions, workflow, source_excerpts, dispositions, phase2_approvals,
    team?.map(({ user_id, display_name }) => [user_id, display_name]),
  ])).digest("hex");
}

export async function GET(request: Request) {
  try {
    const { snapshot } = await authorizedWorkspace();
    const params = new URL(request.url).searchParams;
    const requestedFormat = params.get("format");
    const format = requestedFormat === "csv" ? "arcgis" : requestedFormat;
    const report = params.get("report") ?? "full";
    const scope = params.get("scope") ?? "all";
    const date = snapshotCalendar.format(new Date());
    if (format !== "summary" && format !== "xlsx" && format !== "arcgis")
      return json({ error: "INVALID_EXPORT_FORMAT", message: "Choose the Excel report or Verified event table." }, 400);
    if ((report !== "simplified" && report !== "full") || (scope !== "verified" && scope !== "all"))
      return json({ error: "INVALID_EXPORT_SCOPE", message: "Choose a report and what to include before downloading." }, 400);
    if (format === "arcgis" && scope !== "verified")
      return json({ error: "VERIFIED_SCOPE_REQUIRED", message: "Choose Verified Only to download the event table." }, 400);
    const id = snapshotId(snapshot, date, report, scope);
    if (params.has("snapshot") && params.get("snapshot") !== id)
      return json({ error: "SNAPSHOT_CHANGED", message: "Shared research changed. Refresh snapshot details to export the same snapshot in both formats." }, 409);
    const deadline = performance.now() + 8_000;
    function checkBudget() {
      if (performance.now() > deadline)
        throw new PeriodicalSpreadsheetLimitError("Preparing this snapshot exceeded the download time limit. The export stopped with no partial file.");
    }
    const options = { maxBytes: 24 * 1024 * 1024, checkBudget };
    const selected = selectPeriodicalScope(snapshot, { report, scope });
    const scopeLabel = scope === "verified" ? "Verified Only" : "Verified and Unverified";
    const reportLabel = report === "simplified" ? "Simplified Periodical Export" : "Full Fact Periodical Export";
    const projected = periodicalReport(selected, { snapshotDate: date, scope: scope === "verified" ? scopeLabel : periodicalScope, checkBudget });
    const { facts, evidenceLinks, aiOrigin, evidenceBindingMissing } = projected.progress;
    const gisRows = periodicalArcgisRows(selected, checkBudget);
    const longitudeIndex = arcgisHeaders.indexOf("Longitude");
    if (format === "summary") return json({
      snapshot_id: id, snapshot_date: date, captured_at: null, report, scope,
      event_count: gisRows.length, mappable_event_count: gisRows.filter(row => typeof row[longitudeIndex] === "number").length,
      fact_count: facts, evidence_binding_missing_count: evidenceBindingMissing ?? 0,
      saved_fixture: false,
    });
    const fileScope = scope === "verified" ? "verified-only" : "verified-and-unverified";
    const arcgisBasename = `periodical-${report}-${fileScope}-arcgis-${date}`;
    const filename = format === "arcgis" ? arcgisBasename + ".zip" : `periodical-${report}-${fileScope}-${date}.xlsx`;
    let body: Uint8Array<ArrayBuffer>;
    if (format === "arcgis") {
      const { headers, rows } = periodicalArcgisTable(projected, gisRows, checkBudget);
      const csvFilename = arcgisBasename + ".csv";
      const schema = periodicalArcgisSchema(csvFilename, headers);
      body = new Uint8Array(periodicalArcgisZip(headers, rows, { ...options, csvFilename, schema }));
    } else {
      const { headers, rows, outlineGroups } = periodicalWorkbook(projected, arcgisHeaders, gisRows);
      body = new Uint8Array(periodicalXlsx(headers, rows, {
        ...options, outlineGroups,
        columnWidths: {
          Facility: 25, "Event ID": 24, "Evidence at a glance": 25, "Documented findings": 56, "Featured source": 43,
          "Incident date citations": 43, "Facility identity citations": 43, "Closure duration citations": 43,
          "Facility coordinates citations": 43, "Casualties citations": 43,
        },
        metadata: {
          title: "Lebanon healthcare incident research",
          scope: [reportLabel, scopeLabel, scope === "all" && "Shared research in progress"].filter(Boolean).join(" · "),
          exportedOn: date,
          summary: [
            `${projected.progress.events} event records · ${facts} fact records · ${evidenceLinks} evidence links`,
            `${projected.progress.reviewed} findings with a current human review`,
            `AI origin recorded for ${aiOrigin} facts`,
            evidenceBindingMissing > 0 && `${evidenceBindingMissing} supported findings lack a usable citation binding for the current review`,
          ].filter(Boolean).join("\n"),
          instructions: "Green marks a validated cell. In orange cells, read the status beside each finding. Click a blue source title, or select + above a heading for details.",
        },
      }));
    }
    return new Response(body, {
      headers: {
        "Content-Type": mediaTypes[format],
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Periodical-Snapshot-Id": id,
        "X-Periodical-Snapshot-Date": date,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof PeriodicalSpreadsheetLimitError)
      return json({ error: error.code, message: error.message }, 422);
    return failure(error);
  }
}
