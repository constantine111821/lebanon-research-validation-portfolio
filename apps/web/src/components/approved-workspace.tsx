"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import type { Snapshot } from "@rvw/domain";
import { mountWorkspace } from "@/approved/controller.js";
import "../approved/polish.css";
const FactCorrectionQueue = dynamic(
  () =>
    import("./fact-correction-queue").then(
      (module) => module.FactCorrectionQueue,
    ),
  {
    ssr: false,
    loading: () => <p role="status">Loading correction review queue…</p>,
  },
);
const ResearchAnalytics = dynamic(() => import("./research-analytics"), {
  ssr: false,
  loading: () => (
    <main id="main" className="container research-analytics" role="status">
      Loading Research Analytics…
    </main>
  ),
});
export function ApprovedWorkspace({
  snapshot,
  view = "queue",
  incidentId = null,
}: {
  snapshot: Snapshot;
  view?: string;
  incidentId?: string | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const mounted = useRef<{ key: string; dispose: () => void } | null>(null);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [correctionQueueHost, setCorrectionQueueHost] =
    useState<HTMLElement | null>(null);
  const correctionQueue = useCallback(
    (target: HTMLElement | null) => setCorrectionQueueHost(target),
    [],
  );
  const [analyticsRefresh, setAnalyticsRefresh] = useState(0);
  const analytics = useCallback((action: "open" | "close" | "refresh") => {
    if (action === "refresh") setAnalyticsRefresh((v) => v + 1);
    else setAnalyticsOpen(action === "open");
  }, []);
  const returnToResearch = useCallback(() => {
    host.current
      ?.querySelector<HTMLButtonElement>('[data-action="analytics"]')
      ?.click();
  }, []);
  useEffect(() => {
    // History restoration can supply a new snapshot object for the same route.
    // The mounted controller owns its refresh/draft state; don't erase that state
    // merely because React received an equivalent server snapshot.
    const key = JSON.stringify([snapshot.profile.user_id, view, incidentId]);
    if (mounted.current?.key === key) return;
    mounted.current?.dispose();
    if (host.current)
      mounted.current = {
        key,
        dispose: mountWorkspace(
          host.current,
          snapshot,
          view,
          incidentId,
          analytics,
          correctionQueue,
        ),
      };
  }, [snapshot, view, incidentId, analytics, correctionQueue]);
  useEffect(
    () => () => {
      mounted.current?.dispose();
      mounted.current = null;
    },
    [],
  );
  return (
    <>
      <div ref={host}>
        <div id="app" />
        <dialog id="dialog" aria-labelledby="dialog-title" />
      </div>
      {correctionQueueHost &&
        snapshot.profile.role === "supervisor" &&
        createPortal(
          <FactCorrectionQueue actorId={snapshot.profile.user_id} />,
          correctionQueueHost,
        )}
      {analyticsOpen && snapshot.profile.role === "supervisor" && (
        <ResearchAnalytics
          refreshKey={analyticsRefresh}
          onReturn={returnToResearch}
        />
      )}
    </>
  );
}
