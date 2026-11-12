"use client";
import { useEffect, useState } from "react";
import type { FactCorrectionPackageQueue } from "@/lib/fact-correction-packages";
import { valueLabel } from "@/lib/corrections";
import { ActionButton } from "./scientific-correction-fields";
import "./fact-correction-packages.css";
const endpoint = "/api/fact-correction-packages";
function describeError(result: { message?: string; error?: string }) {
  return (
    result.message ||
    result.error ||
    "The correction queue could not be loaded."
  );
}
export function FactCorrectionQueue({ actorId }: { actorId: string }) {
  const [queue, setQueue] = useState<FactCorrectionPackageQueue | null>(null),
    [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    fetch(endpoint, {
      cache: "no-store",
      headers: { "x-rvw-actor": actorId },
      signal: abort.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw Error(describeError(data));
        if (!abort.signal.aborted) {
          setQueue(data);
          setError("");
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [actorId, refreshKey]);
  const pending = queue?.packages.filter((p) => p.status === "pending") || [];
  return (
    <section
      className="package-supervisor-queue panel"
      aria-labelledby="package-review-queue"
    >
      <div className="package-queue-heading">
        <div>
          <p className="eyebrow">Independent review</p>
          <h2 id="package-review-queue">
            Fact corrections awaiting review{" "}
            {queue ? `(${pending.length})` : ""}
          </h2>
        </div>
        <ActionButton
          type="button"
          hint="Refresh pending packages across the cases you are authorized to review."
          onClick={() => setRefreshKey((v) => v + 1)}
        >
          Refresh correction queue
        </ActionButton>
      </div>
      <p>
        Inspect complete researcher and Supervisor proposals, then decide
        whether to accept, approve, return or reject.
      </p>
      {error && <p role="alert">{error}</p>}
      {!queue && !error && (
        <p role="status">Loading authorized correction packages…</p>
      )}
      {queue && !pending.length && (
        <p>No pending fact correction packages in your authorized cases.</p>
      )}
      {pending.map((item) => (
        <article key={item.id} className="package-queue-item">
          <div>
            <span className="sc019-badge">Pending independent review</span>
            <h3>{item.incident_label}</h3>
            <p>
              <strong>Original:</strong> {valueLabel(item.before.subject)}
            </p>
            <p>
              <strong>Proposed:</strong> {valueLabel(item.proposed.subject)}
            </p>
            <p>
              Proposed by {item.proposed_by_name || item.proposed_by} ·{" "}
              {item.created_at}
            </p>
            {item.proposed_by === actorId && (
              <p>Your proposal requires another Supervisor.</p>
            )}
          </div>
          <a
            className="package-open-link"
            href={`/cases/${encodeURIComponent(item.incident_id)}/corrections?package=${encodeURIComponent(item.id)}&fact=${encodeURIComponent(item.fact_id)}#package-${encodeURIComponent(item.id)}`}
          >
            Inspect complete package
          </a>
        </article>
      ))}
    </section>
  );
}
