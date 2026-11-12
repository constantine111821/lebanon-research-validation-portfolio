import { AccessError, authorizedActor } from "@/lib/access";
import { json, failure } from "@/lib/http";
import {
  currentReportingWeek,
  shiftWeek,
  readSnapshot,
  type AnalyticsSeries,
} from "@/lib/analytics-contract";
export async function GET(request: Request) {
  try {
    const { client, profile } = await authorizedActor();
    if (profile.role !== "supervisor")
      throw new AccessError(403, "SUPERVISOR_REQUIRED");
    const now = new Date(),
      currentWeek = currentReportingWeek(now);
    const url = new URL(request.url),
      end = url.searchParams.get("end") || currentWeek;
    try {
      shiftWeek(end, 0);
    } catch {
      throw new AccessError(400, "INVALID_REPORTING_WEEK");
    }
    if (
      end > currentWeek ||
      end < "2000-01-01" ||
      [...url.searchParams.keys()].some((k) => k !== "end") ||
      url.searchParams.getAll("end").length > 1
    )
      throw new AccessError(400, "INVALID_REPORTING_WEEK");
    const read = async (week: string | null) => {
      const { data, error } = await client
        .rpc("lab_analytics_read", { p_week: week })
        .abortSignal(AbortSignal.timeout(10000));
      if (error)
        throw new AccessError(
          error.code === "42501" ? 403 : 503,
          error.code === "42501"
            ? "SUPERVISOR_REQUIRED"
            : "ANALYTICS_UNAVAILABLE",
        );
      return readSnapshot(data, week ?? undefined);
    };
    const latest = await read(null);
    const labels = Array.from({ length: 8 }, (_, i) => shiftWeek(end, i - 7));
    // Empty foundation needs one aggregate read, not eight empty queries.
    const weeks = await Promise.all(
      labels.map(async (week) => ({
        week,
        snapshot: latest.status === "NOT_CAPTURED" ? latest : await read(week),
      })),
    );
    const current =
      weeks.find((v) => v.week === currentWeek)?.snapshot ??
      (latest.status === "NOT_CAPTURED" ? latest : await read(currentWeek));
    return json({
      reporting_week: currentWeek,
      read_at_utc: now.toISOString(),
      window_end_week: end,
      current,
      latest,
      weeks,
    } satisfies AnalyticsSeries);
  } catch (error) {
    return failure(error);
  }
}
