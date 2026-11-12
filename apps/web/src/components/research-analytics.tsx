"use client";
import "../approved/analytics.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  comparisonNote,
  ORIGINS,
  shiftWeek,
  type AnalyticsSeries,
  type AnalyticsSnapshot,
} from "@/lib/analytics-contract";

const number = (v: number) => v.toLocaleString("en-US");
const date = (v: string) =>
  new Date(v + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
const period = (v: string) => `${date(v)} – ${date(shiftWeek(v, 1))}`;
const instant = (v: string) =>
  new Date(v).toLocaleString("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "short",
    dateStyle: undefined,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
const duration = (v: number | null) =>
  v === null
    ? "Not measured"
    : v < 60
      ? `${number(v)} seconds`
      : v < 3600
        ? `${(v / 60).toFixed(1)} minutes`
        : v < 86400
          ? `${(v / 3600).toFixed(1)} hours`
          : `${(v / 86400).toFixed(1)} days`;
type Origin = "RESEARCH" | "UNKNOWN";
type Measure = "reviews" | "incidents" | "sources" | "acceptances" | "tasks";
const measures: Record<Measure, string> = {
  reviews: "Fact reviews",
  incidents: "Incidents worked on",
  sources: "New sources",
  acceptances: "Incident approvals",
  tasks: "Tasks resolved",
};
function measure(
  s: AnalyticsSnapshot,
  origin: Origin,
  key: Measure,
  cumulative = false,
) {
  const f = s.aggregate[cumulative ? "cumulative" : "weekly"][origin];
  return key === "reviews"
    ? f.by_type.fact_reviewed.episodes
    : key === "incidents"
      ? f.incidents_touched
      : key === "sources"
        ? f.by_type.source_created.episodes
        : key === "acceptances"
          ? f.incident_decisions.APPROVE
          : f.task_outcomes.RESOLVED;
}
function Help({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="ra-help">
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  );
}
const reportStatus = (status: string) =>
  (
    ({
      NOT_CAPTURED: "Not captured",
      PARTIAL: "Partial coverage",
      RESTATED: "Updated report",
    }) as Record<string, string>
  )[status] || status;
function Panel({
  id,
  title,
  subtitle,
  children,
  wide = false,
  secondary = false,
}: {
  id: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  wide?: boolean;
  secondary?: boolean;
}) {
  if (secondary)
    return (
      <details id={id} className="ra-panel ra-secondary ra-wide">
        <summary>
          <h2 id={`${id}-title`}>{title}</h2>
        </summary>
        <p className="ra-secondary-intro">{subtitle}</p>
        {children}
      </details>
    );
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={`ra-panel${wide ? " ra-wide" : ""}`}
    >
      <header>
        <h2 id={`${id}-title`}>{title}</h2>
        <p>{subtitle}</p>
      </header>
      {children}
    </section>
  );
}
function Missing({
  children = "No report for this week. Missing data does not mean no activity.",
}: {
  children?: ReactNode;
}) {
  return (
    <div className="ra-empty">
      <span className="ra-tag" title="NOT_CAPTURED">
        Not captured
      </span>
      <p>{children}</p>
    </div>
  );
}
function Kpi({
  label,
  value,
  unknown,
  note,
}: {
  label: string;
  value?: number;
  unknown?: number;
  note: string;
}) {
  return (
    <article className="ra-kpi">
      <h3>{label}</h3>
      <strong aria-label={value === undefined ? "Not captured" : undefined}>
        {value === undefined ? "—" : number(value)}
      </strong>
      {unknown !== undefined && (
        <div className="ra-unknown">
          Origin unknown: <b>{number(unknown)}</b>
        </div>
      )}
      <details className="ra-help">
        <summary>About this count</summary>
        <p>{note}</p>
      </details>
    </article>
  );
}
function Rows({ values }: { values: [string, ReactNode][] }) {
  return (
    <dl className="ra-rows">
      {values.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
function CountsChart({
  points,
  label,
  cumulative = false,
}: {
  points: {
    week: string;
    research: number | null;
    unknown: number | null;
    breakNote: string | null;
  }[];
  label: string;
  cumulative?: boolean;
}) {
  const maximum = Math.max(
    1,
    ...points.flatMap((v) => [v.research ?? 0, v.unknown ?? 0]),
  );
  const x = (i: number) => 65 + i * 88,
    y = (n: number) => 165 - (n / maximum) * 125;
  return (
    <>
      <div className="ra-legend">
        <span>
          <i className="ra-dot ra-research" />
          Research activity
        </span>
        <span>
          <i className="ra-dot ra-unknown-color" />
          Origin unknown
        </span>
      </div>
      <div
        className="ra-chart-scroll"
        tabIndex={0}
        aria-label={`${label} chart; scroll horizontally on small screens`}
      >
        <svg
          viewBox="0 0 750 220"
          role="img"
          aria-label={`${label}. ${cumulative ? "Separate snapshot points; cumulative distinct counts are not summed." : "Weekly grouped counts."} Missing weeks are marked NC. Exact values follow in the expandable table.`}
          className="ra-chart"
        >
          <text x="15" y="42">
            {number(maximum)}
          </text>
          <text x="25" y="169">
            0
          </text>
          <path d="M48 40V165H738" fill="none" stroke="#b6c5c0" />
          {points.map((p, i) => (
            <g key={p.week}>
              {p.breakNote && (
                <path
                  d={`M${x(i) - 40} 40V165`}
                  stroke="#8a5b18"
                  strokeDasharray="4 4"
                >
                  <title>{p.breakNote}</title>
                </path>
              )}
              {p.research === null ? (
                <text x={x(i)} y="130" textAnchor="middle">
                  NC
                </text>
              ) : cumulative ? (
                <>
                  <circle cx={x(i) - 9} cy={y(p.research)} r="5" fill="#17675b">
                    <title>
                      {date(p.week)}: RESEARCH {p.research}
                    </title>
                  </circle>
                  <rect
                    x={x(i) + 3}
                    y={y(p.unknown ?? 0) - 5}
                    width="10"
                    height="10"
                    fill="#8a5b18"
                  >
                    <title>
                      {date(p.week)}: UNKNOWN {p.unknown}
                    </title>
                  </rect>
                </>
              ) : (
                <>
                  <rect
                    x={x(i) - 23}
                    y={y(p.research)}
                    width="21"
                    height={Math.max(1, 165 - y(p.research))}
                    rx="2"
                    fill="#17675b"
                  >
                    <title>
                      {date(p.week)}: RESEARCH {p.research}
                    </title>
                  </rect>
                  <rect
                    x={x(i) + 2}
                    y={y(p.unknown ?? 0)}
                    width="21"
                    height={Math.max(1, 165 - y(p.unknown ?? 0))}
                    rx="2"
                    fill="#8a5b18"
                  >
                    <title>
                      {date(p.week)}: UNKNOWN {p.unknown}
                    </title>
                  </rect>
                </>
              )}
              <text x={x(i)} y="191" textAnchor="middle">
                {new Date(p.week + "T12:00:00Z").toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                })}
              </text>
              {p.breakNote && (
                <text x={x(i)} y="209" textAnchor="middle">
                  {p.breakNote === "COMPARISON_BREAK" ? "Break" : "Scope ?"}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
      <Help title={`Exact values: ${label}`}>
        <div
          className="ra-table-wrap"
          tabIndex={0}
          aria-label={`${label} data table`}
        >
          <table>
            <caption>{label} · week starting Friday</caption>
            <thead>
              <tr>
                <th scope="col">Week</th>
                <th scope="col">RESEARCH</th>
                <th scope="col">UNKNOWN</th>
                <th scope="col">Comparison</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.week}>
                  <th scope="row">{date(p.week)}</th>
                  <td>
                    {p.research === null ? "NOT_CAPTURED" : number(p.research)}
                  </td>
                  <td>
                    {p.unknown === null ? "NOT_CAPTURED" : number(p.unknown)}
                  </td>
                  <td>{p.breakNote || "No adjacent comparable capture"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Help>
    </>
  );
}
function StockChart({
  data,
  kind,
}: {
  data: AnalyticsSeries;
  kind: "INCIDENT" | "FACILITY" | "SOURCE" | "CLAIM" | "CLAIM_SOURCE";
}) {
  const points = data.weeks.map((w, i, all) => {
    const s = w.snapshot.status === "AVAILABLE" ? w.snapshot : null,
      prior = all[i - 1]?.snapshot;
    return {
      week: w.week,
      n: s?.aggregate.current_stock[kind] ?? null,
      asOf: s?.manifest.state_as_of_utc ?? null,
      comparison:
        s && prior?.status === "AVAILABLE" ? comparisonNote(prior, s) : null,
    };
  });
  const max = Math.max(1, ...points.map((p) => p.n ?? 0));
  return (
    <>
      <div
        className="ra-chart-scroll"
        tabIndex={0}
        aria-label={`${kind} captured stock chart; scroll horizontally on small screens`}
      >
        <svg
          className="ra-chart"
          viewBox="0 0 750 220"
          role="img"
          aria-label={`${kind} recorded totals at actual as-of times. Separate points, not inferred net growth. NC marks missing captures; table values follow.`}
        >
          <text x="15" y="42">
            {number(max)}
          </text>
          <text x="25" y="169">
            0
          </text>
          <path d="M48 40V165H738" fill="none" stroke="#b6c5c0" />
          {points.map((p, i) => (
            <g key={p.week}>
              {p.comparison && (
                <path
                  d={`M${25 + i * 88} 40V165`}
                  stroke="#8a5b18"
                  strokeDasharray="4 4"
                />
              )}
              {p.n === null ? (
                <text x={65 + i * 88} y="130" textAnchor="middle">
                  NC
                </text>
              ) : (
                <circle
                  cx={65 + i * 88}
                  cy={165 - (p.n / max) * 125}
                  r="5"
                  fill="#17675b"
                >
                  <title>
                    {date(p.week)}: {kind} stock {p.n}; actual as of {p.asOf}
                  </title>
                </circle>
              )}
              <text x={65 + i * 88} y="191" textAnchor="middle">
                {new Date(p.week + "T12:00:00Z").toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                })}
              </text>
              {p.comparison && (
                <text x={65 + i * 88} y="209" textAnchor="middle">
                  {p.comparison === "COMPARISON_BREAK" ? "Break" : "Scope ?"}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
      <Help title={`Exact values: ${kind} captured stock`}>
        <div
          className="ra-table-wrap"
          tabIndex={0}
          aria-label={`${kind} stock data`}
        >
          <table>
            <caption>{kind} · captured Core subset</caption>
            <thead>
              <tr>
                <th scope="col">Reporting week</th>
                <th scope="col">Stock</th>
                <th scope="col">Actual as of</th>
                <th scope="col">Comparison</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.week}>
                  <th scope="row">{date(p.week)}</th>
                  <td>{p.n === null ? "NOT_CAPTURED" : number(p.n)}</td>
                  <td>{p.asOf ? instant(p.asOf) : "—"}</td>
                  <td>{p.comparison || "No adjacent comparable capture"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Help>
    </>
  );
}
function Context({ snapshot: s }: { snapshot: AnalyticsSnapshot }) {
  const m = s.manifest;
  return (
    <div className="ra-context">
      <Rows
        values={[
          [
            "Recorded application binding",
            <code key="application">{m.bindings.application_commit}</code>,
          ],
          [
            "Corpus binding",
            <code key="corpus">{m.bindings.corpus_sha256}</code>,
          ],
          [
            "Methodology",
            <code key="method">{m.bindings.methodology_sha256}</code>,
          ],
          ["Scope", <code key="scope">{m.bindings.scope_sha256}</code>],
          ["Study dates", "UNKNOWN"],
          ["Acceptance policy", "Owner amendment 008"],
        ]}
      />
      <Help title="Snapshot integrity and version details">
        <Rows
          values={[
            ["Recorded status", m.status],
            [
              "Snapshot content SHA-256",
              <code key="content">{s.content_sha256}</code>,
            ],
            ["Version", number(m.report_revision)],
            [
              "Supersedes",
              <code key="supersedes">
                {m.supersedes_sha256 || "First revision"}
              </code>,
            ],
            [
              "Metric definitions SHA-256",
              <code key="metrics">{m.metric_definition_sha256}</code>,
            ],
            ["Query SHA-256", <code key="query">{m.query_sha256}</code>],
            [
              "Extractor commit",
              <code key="extractor">{m.extractor_commit}</code>,
            ],
            [
              "Extractor SHA-256",
              <code key="extractor-hash">{m.extractor_sha256}</code>,
            ],
            [
              "Normalization / schema",
              `${m.normalization_version} / ${m.schema_version}`,
            ],
            [
              "UTC interval [start, end)",
              `${m.window_start_utc} → ${m.window_end_utc}`,
            ],
            [
              "Corpus import digests",
              s.aggregate.corpus_import_digests.length
                ? s.aggregate.corpus_import_digests.map((h) => (
                    <code key={h}>{h}</code>
                  ))
                : "No recorded digest",
            ],
          ]}
        />
        <p>
          Bindings are recorded metadata, not automatic deployment tracking.
          UNKNOWN versions are not retrospectively assigned. The hash identifies
          the immutable full snapshot. This dashboard receives only its
          restricted aggregates and manifest, never the recomputation inputs.
        </p>
      </Help>
    </div>
  );
}

export default function ResearchAnalytics({
  refreshKey = 0,
  onReturn,
}: {
  refreshKey?: number;
  onReturn: () => void;
}) {
  const [result, setResult] = useState<{
    key: string;
    data: AnalyticsSeries | null;
    error: string | null;
  } | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [chartMeasure, setChartMeasure] = useState<Measure>("reviews");
  const [trend, setTrend] = useState<"entities" | "episodes">("entities");
  const [stockMeasure, setStockMeasure] = useState<
    "INCIDENT" | "FACILITY" | "SOURCE" | "CLAIM" | "CLAIM_SOURCE"
  >("SOURCE");
  const requestKey = `${end ?? "current"}:${reload}:${refreshKey}`;
  const data = result?.key === requestKey ? result.data : null;
  const error = result?.key === requestKey ? result.error : null;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15000);
    let active = true;
    fetch(`/api/analytics${end ? `?end=${end}` : ""}`, {
      cache: "no-store",
      signal: abort.signal,
    })
      .then(async (r) => {
        if (!r.ok)
          throw Error(
            r.status === 401
              ? "SIGN_IN_REQUIRED"
              : r.status === 403
                ? "SUPERVISOR_REQUIRED"
                : "UNAVAILABLE",
          );
        return (await r.json()) as AnalyticsSeries;
      })
      .then((next) => {
        if (!active) return;
        setResult({ key: requestKey, data: next, error: null });
        setSelected((previous) =>
          next.weeks.some((w) => w.week === previous)
            ? previous
            : (next.weeks
                .filter((w) => w.snapshot.status === "AVAILABLE")
                .at(-1)?.week ?? next.window_end_week),
        );
      })
      .catch((e) => {
        if (active)
          setResult({
            key: requestKey,
            data: null,
            error:
              e.message === "SIGN_IN_REQUIRED" ||
              e.message === "SUPERVISOR_REQUIRED"
                ? e.message
                : "UNAVAILABLE",
          });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      active = false;
      abort.abort();
      clearTimeout(timer);
    };
  }, [end, requestKey]);
  const read = data?.weeks.find((w) => w.week === selected)?.snapshot;
  const s = read?.status === "AVAILABLE" ? read : null;
  const stock = s?.aggregate.current_stock,
    timing = s?.aggregate.request_to_decision,
    coverage = s?.aggregate.coverage;
  const weekly = s?.aggregate.weekly;
  const available = data?.weeks.some((w) => w.snapshot.status === "AVAILABLE");
  const points = (cumulative: boolean) =>
    (data?.weeks || []).map((w, i, all) => {
      const a = w.snapshot.status === "AVAILABLE" ? w.snapshot : null,
        prev = all[i - 1]?.snapshot;
      return {
        week: w.week,
        research: a
          ? cumulative
            ? a.aggregate.cumulative.RESEARCH.by_type.fact_reviewed[trend]
            : measure(a, "RESEARCH", chartMeasure)
          : null,
        unknown: a
          ? cumulative
            ? a.aggregate.cumulative.UNKNOWN.by_type.fact_reviewed[trend]
            : measure(a, "UNKNOWN", chartMeasure)
          : null,
        breakNote:
          a && prev?.status === "AVAILABLE" ? comparisonNote(prev, a) : null,
      };
    });
  return (
    <main
      id="main"
      className="container research-analytics"
      aria-busy={!data && !error}
    >
      <div className="ra-heading">
        <div>
          <div className="eyebrow">Supervisor reports</div>
          <h1 ref={heading} tabIndex={-1}>
            Research Analytics
          </h1>
          <p>Weekly progress and research still needing attention.</p>
        </div>
        <div className="ra-heading-actions">
          <button onClick={onReturn}>Return to research</button>
          <button
            onClick={() => setReload((v) => v + 1)}
            disabled={!data && !error}
          >
            Refresh reports
          </button>
        </div>
      </div>
      <div className="ra-method-strip">
        <b>Friday → Friday</b>
        <span>Weekly reports · no individual rankings</span>
        <Help title="Reporting details">
          <p>
            Each week runs from Friday 00:00 to the next Friday 00:00 in
            America/New_York, including the start and excluding the end. Reports
            are saved snapshots, not live activity. Missing weeks are
            NOT_CAPTURED, never zero activity. RESEARCH and UNKNOWN origins are
            counted separately. Historical coverage is partial; unknown
            methodology or scope stays UNKNOWN. Viewing this page does not
            create a report or approve research.
          </p>
        </Help>
      </div>
      {error ? (
        <section className="ra-state-error" role="alert">
          <h2>
            {error === "SUPERVISOR_REQUIRED"
              ? "Supervisor access required"
              : error === "SIGN_IN_REQUIRED"
                ? "Please sign in again"
                : "Reports could not be loaded"}
          </h2>
          <p>
            {error === "UNAVAILABLE"
              ? "Your research is unchanged. Try again in a moment."
              : "Return to research, or ask the project owner to check your access."}
          </p>
          <button onClick={() => setReload((v) => v + 1)}>Try again</button>
        </section>
      ) : !data ? (
        <section className="ra-loading" role="status">
          <span className="ra-tag">Loading</span>
          <h2>Loading weekly reports…</h2>
          <p>Your research and drafts are unchanged.</p>
          <div className="ra-skeletons" aria-hidden="true">
            {[1, 2, 3, 4].map((v) => (
              <div key={v} />
            ))}
          </div>
        </section>
      ) : (
        <>
          <section
            className="ra-report-status"
            aria-labelledby="ra-current-title"
          >
            <div>
              <h2 id="ra-current-title">This Week</h2>
              <p>{period(data.reporting_week)}</p>
            </div>
            <div>
              <span
                className={`ra-tag${data.current.status === "NOT_CAPTURED" ? "" : " ra-tag-green"}`}
              >
                {reportStatus(
                  data.current.status === "NOT_CAPTURED"
                    ? "NOT_CAPTURED"
                    : data.current.manifest.status,
                )}
              </span>
              <p>
                {data.current.status === "NOT_CAPTURED"
                  ? "This week's report has not been saved yet."
                  : `Saved ${instant(data.current.manifest.captured_at_utc)}`}
              </p>
            </div>
          </section>
          <div className="ra-controls">
            <label>
              Reporting week
              <select
                aria-label="Reporting week"
                value={selected || data.window_end_week}
                onChange={(e) => setSelected(e.target.value)}
              >
                {[...data.weeks].reverse().map((w) => (
                  <option key={w.week} value={w.week}>
                    {period(w.week)} ·{" "}
                    {w.snapshot.status === "AVAILABLE"
                      ? `${reportStatus(w.snapshot.manifest.status)} · v${w.snapshot.manifest.report_revision}`
                      : "Not captured"}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <button
                onClick={() => {
                  setEnd(shiftWeek(data.window_end_week, -8));
                  setSelected(null);
                }}
              >
                Earlier weeks
              </button>
              <button
                disabled={data.window_end_week >= data.reporting_week}
                onClick={() => {
                  setEnd(
                    shiftWeek(data.window_end_week, 8) > data.reporting_week
                      ? data.reporting_week
                      : shiftWeek(data.window_end_week, 8),
                  );
                  setSelected(null);
                }}
              >
                Later weeks
              </button>
            </div>
          </div>
          <div className="ra-snapshot-caption" role="status">
            {s ? (
              <>
                <b>{period(s.manifest.week_start_local)}</b>
                <span className="ra-tag ra-tag-green">
                  {reportStatus(s.manifest.status)} · v
                  {s.manifest.report_revision}
                </span>
                <details className="ra-inline-details">
                  <summary>Report timing</summary>
                  <span>
                    Actual stock as of {instant(s.manifest.state_as_of_utc)}.{" "}
                    {coverage?.exact_friday_stock
                      ? "Saved at the Friday boundary."
                      : "Saved away from the Friday boundary; not exact Friday stock."}
                  </span>
                </details>
              </>
            ) : (
              <>
                <b>{period(selected || data.window_end_week)}</b>
                <span>No report · counts unavailable.</span>
              </>
            )}
          </div>
          {!s && (
            <Missing>
              {data.latest.status === "NOT_CAPTURED" ? (
                <>
                  Weekly reports begin with the first Friday capture. Missing
                  data does not mean no activity.
                </>
              ) : (
                <>
                  No capture for the selected week. The latest recorded snapshot
                  covers {period(data.latest.manifest.week_start_local)}.{" "}
                  <button
                    className="text-button"
                    onClick={() => {
                      setEnd(
                        data.latest.status === "AVAILABLE"
                          ? data.latest.manifest.week_start_local
                          : null,
                      );
                      setSelected(null);
                    }}
                  >
                    Open latest captured week
                  </button>
                </>
              )}
            </Missing>
          )}
          <p className="ra-count-context">
            Main totals show recorded research activity. Counts with unknown
            origin stay separate.
          </p>
          <div className="ra-kpis">
            <Kpi
              label="Incidents worked on"
              value={s ? measure(s, "RESEARCH", "incidents") : undefined}
              unknown={s ? measure(s, "UNKNOWN", "incidents") : undefined}
              note="Distinct incidents with recorded research actions. Viewing an incident does not count."
            />
            <Kpi
              label="Fact reviews"
              value={s ? measure(s, "RESEARCH", "reviews") : undefined}
              unknown={s ? measure(s, "UNKNOWN", "reviews") : undefined}
              note="Each review counts once. A later review of the same fact counts separately."
            />
            <Kpi
              label="Incident approvals"
              value={s ? measure(s, "RESEARCH", "acceptances") : undefined}
              unknown={s ? measure(s, "UNKNOWN", "acceptances") : undefined}
              note="Approval decisions made this week. The number currently approved for export is shown separately."
            />
            <Kpi
              label="New sources"
              value={s ? measure(s, "RESEARCH", "sources") : undefined}
              unknown={s ? measure(s, "UNKNOWN", "sources") : undefined}
              note="Newly saved sources only. Reusing or linking a source does not count. Older source records may be missing."
            />
          </div>
          <nav className="ra-section-nav" aria-label="Analytics sections">
            {[
              ["ra-throughput", "Throughput"],
              ["ra-review", "Review states"],
              ["ra-quality", "Quality & rework"],
              ["ra-timing", "Timing"],
              ["ra-corpus", "Corpus"],
              ["ra-origin", "Origin"],
              ["ra-trends", "Trends"],
              ["ra-coverage", "Coverage"],
              ["ra-versions", "Versions"],
            ].map(([id, text]) => (
              <a key={id} href={`#${id}`}>
                {text}
              </a>
            ))}
          </nav>
          <div className="ra-grid">
            <Panel
              id="ra-throughput"
              title="Weekly throughput"
              subtitle="Separate units and origins. Each column represents one captured reporting week."
            >
              <label className="ra-select">
                Measure
                <select
                  aria-label="Measure"
                  value={chartMeasure}
                  onChange={(e) => setChartMeasure(e.target.value as Measure)}
                >
                  {Object.entries(measures).map(([key, name]) => (
                    <option key={key} value={key}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              {available ? (
                <CountsChart
                  points={points(false)}
                  label={measures[chartMeasure]}
                />
              ) : (
                <Missing>
                  No captured weeks in this window. The chart will begin with
                  real Friday captures.
                </Missing>
              )}
              <Help title="How to read throughput">
                <p>
                  Counts cover canonical events with supported occurrence
                  timestamps in [Friday, next Friday). RESEARCH and UNKNOWN are
                  separate origin strata; the same incident can appear in both,
                  so do not add distinct counts. Imports, preserved history,
                  smoke and system propagation are excluded from research
                  throughput. Source reuse is not source creation.
                </p>
              </Help>
            </Panel>
            <Panel
              id="ra-review"
              title="Review progress"
              subtitle="Review, waiver and approval are separate; these counts can overlap."
            >
              {stock ? (
                <>
                  <div className="ra-state-matrix">
                    <div>
                      <strong>
                        {number(stock.valid_reviewed_facts)} /{" "}
                        {number(stock.current_facts)}
                      </strong>
                      <span>Facts reviewed</span>
                      <small>
                        {stock.factual_review_coverage === null
                          ? "Rate undefined: no current facts"
                          : `${(stock.factual_review_coverage * 100).toFixed(1)}% of current facts`}
                      </small>
                    </div>
                    <div>
                      <strong>{number(stock.waived_facts)}</strong>
                      <span>Facts waived</span>
                      <small>Waived does not mean the fact is certified</small>
                    </div>
                    <div>
                      <strong>
                        {number(stock.eligible_incidents)} /{" "}
                        {number(stock.INCIDENT)}
                      </strong>
                      <span>Incidents approved for export</span>
                      <small>
                        {stock.eligibility_rate === null
                          ? "Rate undefined: no incidents"
                          : `${(stock.eligibility_rate * 100).toFixed(1)}% of captured incidents`}
                      </small>
                    </div>
                    <div>
                      <strong>{number(stock.needs_reapproval)}</strong>
                      <span>Incidents needing reapproval</span>
                      <small>Earlier approval needs a new decision</small>
                    </div>
                  </div>
                  <Rows
                    values={[
                      [
                        "Awaiting supervisor acceptance",
                        number(stock.active_pending_acceptance),
                      ],
                      ["Deferred incidents", number(stock.deferred_incidents)],
                      ["Complete incidents", number(stock.complete_incidents)],
                    ]}
                  />
                </>
              ) : (
                <Missing />
              )}
              <Help title="Acceptance is not certification">
                <p>
                  Policy 008 allows supervisor acceptance with documented
                  limitations. Review, factual support, waiver, completion and
                  output eligibility remain independent. Neither these counts
                  nor link quantity establish truth or a complete campaign
                  population. Required-fact backlog and acceptance-time
                  limitations are not available as separate aggregates.
                </p>
              </Help>
            </Panel>
            <Panel
              id="ra-quality"
              secondary={!s}
              title="Quality and rework"
              subtitle="Recorded limitations and genuine reopening, not an accuracy or error score."
            >
              {stock && weekly ? (
                <>
                  <Rows
                    values={[
                      [
                        "Facts with unknown values",
                        number(stock.unknown_values),
                      ],
                      [
                        "Facts with conflicting evidence",
                        number(stock.conflicting_facts),
                      ],
                      ["Fact waivers", number(stock.waived_facts)],
                    ]}
                  />
                  <div
                    className="ra-table-wrap"
                    tabIndex={0}
                    aria-label="Rework counts"
                  >
                    <table>
                      <caption>Actions in the selected week</caption>
                      <thead>
                        <tr>
                          <th scope="col">Action</th>
                          <th scope="col">RESEARCH</th>
                          <th scope="col">UNKNOWN</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ["Fact review reopened", "fact_review_reopened"],
                          [
                            "Facility identity reopened",
                            "facility_identity_reopened",
                          ],
                        ].map(([name, key]) => (
                          <tr key={key}>
                            <th scope="row">{name}</th>
                            <td>
                              {number(
                                weekly.RESEARCH.by_type[
                                  key as "fact_review_reopened"
                                ].episodes,
                              )}
                            </td>
                            <td>
                              {number(
                                weekly.UNKNOWN.by_type[
                                  key as "fact_review_reopened"
                                ].episodes,
                              )}
                            </td>
                          </tr>
                        ))}
                        <tr>
                          <th scope="row">Incident reopened</th>
                          <td>
                            {number(weekly.RESEARCH.incident_decisions.REOPEN)}
                          </td>
                          <td>
                            {number(weekly.UNKNOWN.incident_decisions.REOPEN)}
                          </td>
                        </tr>
                        <tr>
                          <th scope="row">Fact approval reopened</th>
                          <td>
                            {number(weekly.RESEARCH.fact_decisions.REOPEN)}
                          </td>
                          <td>
                            {number(weekly.UNKNOWN.fact_decisions.REOPEN)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="ra-footnote">
                    System-propagated dependent invalidation records:{" "}
                    <b>
                      {number(
                        weekly.SYSTEM_PROPAGATION.by_type.dependency_invalidated
                          .episodes,
                      )}
                    </b>
                    . Affected records are separate from initiating research
                    actions.
                  </p>
                </>
              ) : (
                <Missing />
              )}
              <Help title="Rework and quality limits">
                <p>
                  DEFER’s supporting internal reopen receipt is not a genuine
                  reopening KPI. Reopen counts are not error rates; no
                  comparable follow-up denominator is supplied. Waivers and
                  UNKNOWN findings are retained limitations. Citation-field gap
                  counts and coded reason categories are not measured by this
                  aggregate contract.
                </p>
              </Help>
            </Panel>
            <Panel
              id="ra-timing"
              secondary={!s}
              title="Time to decision"
              subtitle="Time from approval request to supervisor decision, for requests decided this week."
            >
              {timing ? (
                <>
                  <div className="ra-timing-value">
                    <strong>{duration(timing.median_seconds)}</strong>
                    <span>
                      Median · n = {number(timing.n)} valid paired requests
                    </span>
                  </div>
                  <Rows
                    values={[
                      [
                        "Observed range",
                        timing.n
                          ? `${duration(timing.min_seconds)} – ${duration(timing.max_seconds)}`
                          : "Not measured: no valid paired endpoints",
                      ],
                      [
                        "Approval requests still pending",
                        number(timing.pending),
                      ],
                      ["Approval requests declined", number(timing.declined)],
                      ["Outdated requests (all actions)", number(timing.stale)],
                      [
                        "Requests with unusable timing",
                        number(timing.invalid_duration),
                      ],
                    ]}
                  />
                </>
              ) : (
                <Missing />
              )}
              <Help title="What timing can establish">
                <p>
                  This is not researcher-completion time, labor time or hours
                  saved. The resolved cohort includes recorded declines; pending
                  requests have no completed duration. Historical endpoint
                  coverage may be incomplete. No researcher-ready milestone or
                  unstable tail percentile is introduced.
                </p>
              </Help>
            </Panel>
            <Panel
              id="ra-corpus"
              secondary={!s}
              title="Research collection"
              subtitle="Recorded additions and collection size at each report."
            >
              {stock && weekly ? (
                <>
                  <Rows
                    values={[
                      ["Captured incidents", number(stock.INCIDENT)],
                      ["Captured facilities", number(stock.FACILITY)],
                      ["Preserved Core facts (CLAIM)", number(stock.CLAIM)],
                      ["Captured sources", number(stock.SOURCE)],
                      ["Fact–source relationships", number(stock.CLAIM_SOURCE)],
                    ]}
                  />
                  <div
                    className="ra-table-wrap"
                    tabIndex={0}
                    aria-label="Corpus additions"
                  >
                    <table>
                      <caption>Selected-week insert / link episodes</caption>
                      <thead>
                        <tr>
                          <th scope="col">Type</th>
                          <th scope="col">RESEARCH</th>
                          <th scope="col">UNKNOWN</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ["Incidents created", "incident_created"],
                          ["Facilities created", "facility_created"],
                          ["Facts created", "fact_created"],
                          ["Sources inserted", "source_created"],
                          ["Fact–source links added", "fact_source_linked"],
                        ].map(([label, key]) => (
                          <tr key={key}>
                            <th scope="row">{label}</th>
                            <td>
                              {number(
                                weekly.RESEARCH.by_type[key as "fact_created"]
                                  .episodes,
                              )}
                            </td>
                            <td>
                              {number(
                                weekly.UNKNOWN.by_type[key as "fact_created"]
                                  .episodes,
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Help title="Historical source status and relationship authority">
                    <h3>Recovered source-record status</h3>
                    <Rows
                      values={Object.entries(
                        s!.aggregate.historical_source_states,
                      ).map(([k, v]) => [k.replaceAll("_", " "), number(v)])}
                    />
                    <p>
                      {!Object.keys(s!.aggregate.historical_source_states)
                        .length &&
                        "No historical source-state counts recorded."}{" "}
                      Historical completion, identity-blocked and deferred
                      states do not imply current certification.
                    </p>
                    <h3>Mapping authority by relationship</h3>
                    <div
                      className="ra-table-wrap"
                      tabIndex={0}
                      aria-label="Mapping authority"
                    >
                      <table>
                        <caption>
                          Authority to map/import, not supervisor approval
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">Relationship</th>
                            <th scope="col">Authority</th>
                            <th scope="col">Count</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s!.aggregate.mapping_authority.map((m) => (
                            <tr key={`${m.target_type}-${m.authority}`}>
                              <th scope="row">{m.target_type}</th>
                              <td>{m.authority}</td>
                              <td>{number(m.n)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Help>
                </>
              ) : (
                <Missing />
              )}
              {available && (
                <>
                  <label className="ra-select">
                    Collection size across reports
                    <select
                      aria-label="Collection size across reports"
                      value={stockMeasure}
                      onChange={(e) =>
                        setStockMeasure(e.target.value as typeof stockMeasure)
                      }
                    >
                      <option value="SOURCE">Sources</option>
                      <option value="INCIDENT">Incidents</option>
                      <option value="FACILITY">Facilities</option>
                      <option value="CLAIM">Preserved Core facts</option>
                      <option value="CLAIM_SOURCE">
                        Fact–source relationships
                      </option>
                    </select>
                  </label>
                  <StockChart data={data} kind={stockMeasure} />
                </>
              )}
              <Help title="Growth and population limits">
                <p>
                  Different units are never summed. Net growth, removals and
                  scope transfers require ID-set reconciliation unavailable to
                  this aggregate page; net growth remains UNKNOWN. The imported
                  subset does not establish full A–L campaign coverage. Source
                  insertions before migration 011 have partial coverage.
                </p>
              </Help>
            </Panel>
            <Panel
              id="ra-trends"
              secondary={!available}
              title="Progress over time"
              subtitle="Totals across recorded history. Missing weeks remain gaps."
              wide
            >
              <label className="ra-select">
                Fact reviews across captured history
                <select
                  aria-label="Fact reviews across captured history"
                  value={trend}
                  onChange={(e) =>
                    setTrend(e.target.value as "entities" | "episodes")
                  }
                >
                  <option value="entities">
                    Distinct facts with observed review
                  </option>
                  <option value="episodes">Cumulative review episodes</option>
                </select>
              </label>
              {available ? (
                <CountsChart
                  points={points(true)}
                  label={
                    trend === "entities"
                      ? "Cumulative distinct reviewed facts"
                      : "Cumulative fact-review episodes"
                  }
                  cumulative
                />
              ) : (
                <Missing>
                  No cumulative trend exists before the first actual snapshot.
                </Missing>
              )}
              <Help title="Comparability and restatements">
                <p>
                  Separate points avoid implying uninterrupted or fully
                  comparable history. Known corpus/methodology/scope/metric
                  changes mark a comparison break. UNKNOWN bindings leave
                  comparison uncertain. Application versions are context, not a
                  causal explanation. Each week shows its latest immutable
                  revision; RESTATED names its predecessor hash. No past mutable
                  stock is reconstructed.
                </p>
              </Help>
            </Panel>
            <Panel
              secondary
              id="ra-origin"
              title="Human / engine contribution · unknown"
              subtitle="Provenance supports event-origin strata, not a complete human-versus-engine split."
            >
              <div className="ra-origin-limits">
                <span className="ra-tag">UNKNOWN</span>
                <h3>Assistance and engine attribution</h3>
                <p>
                  Documented human / engine lineage counts are not available in
                  this snapshot contract. Human entry does not establish
                  unassisted work. No contribution percentage or AI-causal claim
                  is shown.
                </p>
              </div>
              {weekly ? (
                <div
                  className="ra-table-wrap"
                  tabIndex={0}
                  aria-label="Evidenced origin strata"
                >
                  <table>
                    <caption>
                      Selected-week fact-review episodes by evidenced origin
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Recorded origin</th>
                        <th scope="col">Episodes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ORIGINS.map((o) => (
                        <tr key={o}>
                          <th scope="row">{o.replaceAll("_", " ")}</th>
                          <td>
                            {number(weekly[o].by_type.fact_reviewed.episodes)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Missing />
              )}
              <Help title="Origin is a separate axis">
                <p>
                  RESEARCH origin means evidenced research activity. It does not
                  mean human-only or AI-assisted. UNKNOWN stays visible.
                  Historical field names and current manual entry do not prove
                  lineage. Import, preserved history, smoke and system
                  propagation remain separate and excluded from research
                  throughput.
                </p>
              </Help>
            </Panel>
            <Panel
              secondary
              id="ra-coverage"
              title="Coverage and limitations"
              subtitle="Every captured report has partial historical coverage. Missing evidence is retained."
            >
              {coverage ? (
                <Rows
                  values={[
                    [
                      "Supporting representations not counted as actions",
                      number(coverage.supporting_records),
                    ],
                    [
                      "Semantic duplicate receipts removed",
                      number(coverage.semantic_duplicates),
                    ],
                    [
                      "Missing / uncertain occurrence times",
                      number(coverage.missing_or_uncertain_time),
                    ],
                    [
                      "Future events excluded at capture",
                      number(coverage.future_events),
                    ],
                    [
                      "Exclusion-ledger records",
                      number(coverage.excluded_records),
                    ],
                    ["Historical source-creation coverage", "PARTIAL"],
                    ["Historical origin coverage", "PARTIAL / UNKNOWN"],
                    ["Historical roster", "UNKNOWN"],
                    [
                      "Methodology / scope comparison",
                      "UNKNOWN unless explicitly bound",
                    ],
                    ["Assistance", "UNKNOWN"],
                  ]}
                />
              ) : (
                <Missing />
              )}
              <Help title="Measurement and claim boundaries">
                <p>
                  No logins, sessions, views, labor time, researcher completion,
                  learning or AI-causal gain is measured. Uncertain timestamps
                  remain cumulative only. These aggregates describe observed
                  workflow within the captured subset, not all work performed,
                  factual truth, prevalence, campaign completeness or individual
                  productivity. No private drafts, person-level history or
                  restricted research text is returned.
                </p>
              </Help>
            </Panel>
            <Panel
              secondary
              id="ra-versions"
              title="Versions and study context"
              subtitle="Version bindings describe the selected capture; they are not retrospectively assigned."
            >
              <div className="ra-context">
                <Rows
                  values={[
                    [
                      "Dashboard build",
                      <code key="build">
                        {process.env.RVW_BUILD_COMMIT || "UNKNOWN"}
                      </code>,
                    ],
                  ]}
                />
              </div>
              {s ? (
                <Context snapshot={s} />
              ) : (
                <Missing>
                  No captured application/corpus binding is available.
                  Methodology, scope and authoritative study dates remain
                  UNKNOWN.
                </Missing>
              )}
            </Panel>
            <Panel
              secondary
              id="ra-index"
              title="Report history"
              subtitle="Latest report for each week, including updated and late reports."
              wide
            >
              <div
                className="ra-table-wrap"
                tabIndex={0}
                aria-label="Report history"
              >
                <table>
                  <caption>Friday weekly series · America/New_York</caption>
                  <thead>
                    <tr>
                      <th scope="col">Reporting week</th>
                      <th scope="col">Status</th>
                      <th scope="col">Report saved</th>
                      <th scope="col">Timing</th>
                      <th scope="col">Version</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.weeks].reverse().map((w) => (
                      <tr key={w.week}>
                        <th scope="row">
                          <button
                            className="text-button"
                            onClick={() => {
                              setSelected(w.week);
                              document.getElementById("main")?.scrollIntoView();
                            }}
                          >
                            {period(w.week)}
                          </button>
                        </th>
                        <td>
                          {w.snapshot.status === "AVAILABLE"
                            ? reportStatus(w.snapshot.manifest.status)
                            : "Not captured"}
                        </td>
                        <td>
                          {w.snapshot.status === "AVAILABLE"
                            ? instant(w.snapshot.manifest.captured_at_utc)
                            : "—"}
                        </td>
                        <td>
                          {w.snapshot.status === "AVAILABLE"
                            ? w.snapshot.aggregate.coverage.exact_friday_stock
                              ? "Exact boundary"
                              : `Actual as-of; lag ${duration(Math.abs(w.snapshot.manifest.boundary_lag_seconds))}${w.snapshot.manifest.boundary_lag_seconds < 0 ? " before close" : " after close"}`
                            : "Unavailable"}
                        </td>
                        <td>
                          {w.snapshot.status === "AVAILABLE"
                            ? w.snapshot.manifest.report_revision
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
          <footer className="ra-footer">
            Refreshed {instant(data.read_at_utc)} · read-only reports.
          </footer>
        </>
      )}
    </main>
  );
}
