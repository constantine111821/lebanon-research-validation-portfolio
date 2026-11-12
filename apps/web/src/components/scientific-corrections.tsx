"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { FactFlag, FactFlagResolution } from "@/lib/fact-flags";
import {
  changedFields,
  correctionFields,
  correctionStatus,
  fieldLabel,
  isWithdrawn,
  sourceHref,
  valueLabel,
  type CorrectionEvidence,
  type CorrectionFact,
  type CorrectionsSnapshot,
  type CorrectionTarget,
  type CorrectionVersion,
  type ScientificData,
} from "@/lib/corrections";
import {
  ActionButton,
  Choice,
  TextField,
  ProposalFields,
} from "./scientific-correction-fields";
import {
  FactCorrectionPackages,
  type PackageEditorRequest,
} from "./fact-correction-packages";
import "./scientific-corrections.css";

const actionHints = {
  flag: "Ask a Supervisor to investigate. The fact and its scientific status stay unchanged.",
  amend: "Propose a change for review by a different authorized Supervisor.",
  withdraw:
    "Propose removing this fact from current use. Independent review is required; history is retained.",
  history:
    "Inspect earlier correction proposals, decisions and their recorded reasons.",
};

type Base = {
  operationId: string;
  incidentRevision: number;
  reason: string;
  stage: "edit" | "compare";
  uncertain?: boolean;
};
type Proposal = Base & {
  kind: "proposal";
  target: CorrectionTarget;
  targetId: string;
  factId: string;
  targetRevision: number;
  action: "amend" | "withdraw";
  before: ScientificData;
  proposed: ScientificData;
  subject: string;
};
type Review = Base & {
  kind: "review";
  correctionId: string;
  decision: "accept" | "reject";
};
type Pending = Proposal | Review;
type FlagDraft = {
  operationId: string;
  factId: string;
  reason: string;
  suggestion: string;
  uncertain?: boolean;
} & (
  | { kind: "flag_fact" }
  | {
      kind: "resolve_fact_flag";
      flagId: string;
      revision: number;
      resolution: FactFlagResolution["resolution"];
    }
);
function correctionRestriction(fact: CorrectionFact) {
  if (fact.correction_restriction)
    return `${fact.correction_restriction.message} ${fact.correction_restriction.next_action}`;
  if (isWithdrawn(fact.data))
    return "This fact is withdrawn from current use. Inspect its history or flag a remaining concern for a Supervisor.";
  if (fact.lock?.locked)
    return `${fact.lock.reason || "The fact or case is locked by its review disposition."} A Supervisor must review and reopen the affected fact or case before a formal correction. You can still flag a concern.`;
  return "";
}
function caseReturnHref(incidentId: string, candidate?: string) {
  const fallback = `/work#workspace=${encodeURIComponent(JSON.stringify({ view: "incident", current: incidentId }))}`;
  if (!candidate) return fallback;
  try {
    const url = new URL(candidate, "https://workspace.invalid");
    if (
      url.origin !== "https://workspace.invalid" ||
      !["/work", `/cases/${encodeURIComponent(incidentId)}`].includes(
        url.pathname,
      ) ||
      url.search
    )
      return fallback;
    const context = JSON.parse(
      decodeURIComponent(url.hash.slice("#workspace=".length)),
    );
    if (
      !url.hash.startsWith("#workspace=") ||
      context.current !== incidentId ||
      !["incident", "supervisor-detail"].includes(context.view)
    )
      return fallback;
    return url.pathname + url.hash;
  } catch {
    return fallback;
  }
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function Comparison({
  target,
  before,
  proposed,
  withdrawal = false,
}: {
  target: CorrectionTarget;
  before: ScientificData;
  proposed: ScientificData;
  withdrawal?: boolean;
}) {
  const fields = changedFields(before, proposed, target);
  if (withdrawal)
    return (
      <div className="sc019-note">
        <strong>
          {target === "fact"
            ? "Withdraw this fact from current use"
            : "Remove this evidence relationship from this fact"}
        </strong>
        <p>
          The previous record and its history remain available. Withdrawal does
          not prove a negative finding. Other facts and source relationships are
          preserved.
        </p>
      </div>
    );
  return fields.length ? (
    <div className="sc019-comparison">
      <div className="sc019-comparison-head">
        <span>Recorded before correction</span>
        <span>Proposed revision</span>
      </div>
      {fields.map((key) => (
        <section key={key}>
          <h4>{fieldLabel(key)}</h4>
          <div>
            <p>{valueLabel(before[key])}</p>
            <p>{valueLabel(proposed[key])}</p>
          </div>
        </section>
      ))}
    </div>
  ) : (
    <p>No changed values yet.</p>
  );
}
function SourceSummary({ evidence }: { evidence: CorrectionEvidence }) {
  const source = evidence.source.data,
    href = sourceHref(source);
  const passages = Array.isArray(evidence.data.evidence_locator)
    ? evidence.data.evidence_locator.flatMap((v) =>
        v && typeof v === "object" && !Array.isArray(v)
          ? [v.locator, v.excerpt, v.description].filter(
              (x) => typeof x === "string" && x,
            )
          : [],
      )
    : [];
  return (
    <>
      <strong>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {valueLabel(source.title)}
          </a>
        ) : (
          valueLabel(source.title)
        )}
      </strong>
      <div className="sc019-meta">
        {valueLabel(source.source_type)} ·{" "}
        {valueLabel(evidence.data.support_direction)}
        {isWithdrawn(evidence.data) && " · Withdrawn relationship"}
      </div>
      {passages.map((text, i) => (
        <p key={i}>{valueLabel(text)}</p>
      ))}
      {evidence.data.limitations && (
        <p>
          <strong>Limitations:</strong> {valueLabel(evidence.data.limitations)}
        </p>
      )}
      <details>
        <summary>Complete recorded evidence and citation</summary>
        <dl>
          {[
            ...correctionFields.evidence.map(
              (k) => [k, evidence.data[k]] as const,
            ),
            ...correctionFields.source.map((k) => [k, source[k]] as const),
          ]
            .filter(([, v]) => v != null && v !== "")
            .map(([k, v], i) => (
              <div key={`${k}-${i}`}>
                <dt>{fieldLabel(k)}</dt>
                <dd>{valueLabel(v)}</dd>
              </div>
            ))}
        </dl>
      </details>
    </>
  );
}
function when(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
function ContextDetails({ context }: { context: ScientificData }) {
  return (
    <>
      {["workflow", "incident_workflow", "approval"].map((key) => {
        const row = context[key];
        if (!row || typeof row !== "object" || Array.isArray(row))
          return (
            <p key={key}>{fieldLabel(key)}: No state recorded at capture.</p>
          );
        const shown = Object.entries(row).filter(
          ([k]) =>
            /state|disposition|reason|approved_at|reviewed_at|completed_at/.test(
              k,
            ) && !/_id$/.test(k),
        );
        return (
          <details key={key}>
            <summary>{fieldLabel(key)}</summary>
            <dl>
              {shown.map(([k, v]) => (
                <div key={k}>
                  <dt>{fieldLabel(k)}</dt>
                  <dd>{valueLabel(v)}</dd>
                </div>
              ))}
            </dl>
          </details>
        );
      })}
    </>
  );
}
function PreservedVersion({
  version,
  actorId,
}: {
  version: CorrectionVersion;
  actorId: string;
}) {
  const nested = version.data.data;
  const data =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? nested
      : version.data;
  const fields = (
    correctionFields[version.entity_type as CorrectionTarget] ||
    correctionFields.fact
  ).filter((k) => data[k] !== undefined);
  const contextual = version.entity_type.endsWith("_context");
  if (!fields.length && !contextual) return null;
  return (
    <article className="sc019-card">
      <h3>
        {fieldLabel(version.stage)} · {fieldLabel(version.entity_type)}
      </h3>
      <p className="sc019-meta">
        {when(version.recorded_at)} ·{" "}
        {version.actor === actorId
          ? "You"
          : version.actor_name || "Recorded contributor"}{" "}
        · Revision {version.revision}
      </p>
      <dl>
        {fields.map((k) => (
          <div key={k}>
            <dt>{fieldLabel(k)}</dt>
            <dd>{valueLabel(data[k])}</dd>
          </div>
        ))}
      </dl>
      {data.is_current === false && (
        <p>Withdrawn from current use; preserved historically.</p>
      )}
      {contextual && <ContextDetails context={version.data} />}
    </article>
  );
}
function errorText(code: string, message?: string) {
  const known: Record<string, string> = {
    SHARED_CONFLICT:
      "This case or record changed while you were working. Your correction text is preserved. Load the latest records, compare them, then explicitly update your proposal before submitting again.",
    DISPOSITION_LOCKED:
      "This fact or case is locked by its review disposition. A supervisor must reopen it before a correction can be submitted. Your text is preserved.",
    WORKSPACE_ACTOR_CHANGED:
      "The signed-in account changed. Return to your own session before continuing. No correction was saved under the other account.",
    SIGN_IN_REQUIRED:
      "Your session needs sign-in. Keep this tab open and sign in with the same account before retrying.",
    COMMAND_DENIED:
      "Your current role, case authority or independent-review status does not permit this action.",
    COMMAND_REJECTED:
      "The correction was not accepted. Check the fields and recorded scientific constraints.",
    FACT_FLAGS_DENIED:
      "Your current account or case access does not permit this fact flag action. Your text is preserved.",
    FACT_FLAG_CONFLICT:
      "This flag has changed. Refresh fact flags and inspect the recorded response before starting another action. Your text is preserved.",
    FACT_FLAG_REJECTED:
      "The fact flag was not accepted. Check the concern and selected fact. Your text is preserved.",
    CASE_OR_FLAG_NOT_FOUND:
      "The case, fact or flag is unavailable with your current access. Your text is preserved.",
    FACT_FLAGS_UNAVAILABLE:
      "Fact flags are temporarily unavailable. Your text is preserved; retry the same request.",
  };
  return `${known[code] || "The request could not be confirmed. Your text is preserved; retry the same submission before starting another."}${message ? ` ${message}` : ""}`;
}
export function ScientificCorrections({
  initial,
  actorId,
  role,
  selectedFactId,
  selectedPackageId,
  intent,
  returnTo,
}: {
  initial: CorrectionsSnapshot;
  actorId: string;
  role: "researcher" | "supervisor";
  selectedFactId?: string;
  selectedPackageId?: string;
  intent?: string;
  returnTo?: string;
}) {
  const [packageRequest, setPackageRequest] = useState<
    PackageEditorRequest | undefined
  >(() =>
    selectedFactId && intent === "amend"
      ? { factId: selectedFactId, nonce: 0 }
      : undefined,
  );
  const [snapshot, setSnapshot] = useState(initial),
    [pending, setPending] = useState<Pending | null>(null);
  // Package captures are written atomically with their proposal. The legacy read
  // already includes them, so classification does not depend on a second fetch.
  const packageIds = new Set(
    (snapshot.versions || [])
      .filter((version) => version.entity_type === "fact_package")
      .map((version) => version.correction_id),
  );
  const legacyCorrections = snapshot.corrections.filter(
    (correction) => !packageIds.has(correction.id),
  );
  const legacyVersions = (snapshot.versions || []).filter(
    (version) => !packageIds.has(version.correction_id),
  );
  const recoveredPackageReview =
    pending?.kind === "review" && packageIds.has(pending.correctionId);
  const [flags, setFlags] = useState<FactFlag[]>([]),
    [flagsLoaded, setFlagsLoaded] = useState(false),
    [flagError, setFlagError] = useState(""),
    [flagPending, setFlagPending] = useState<FlagDraft | null>(null),
    [historyFactId, setHistoryFactId] = useState(
      intent === "history" ? selectedFactId : undefined,
    );
  const [ready, setReady] = useState(false),
    [storageOk, setStorageOk] = useState(true),
    [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false);
  const inFlight = useRef(false),
    editor = useRef<HTMLElement>(null),
    flagEditor = useRef<HTMLElement>(null),
    key = `rvw:correction019:${actorId}:${initial.incident_id}`;
  useEffect(() => {
    // Hydrate the browser-only recovery store after the server markup is attached.
    const frame = requestAnimationFrame(() => {
      try {
        const text = sessionStorage.getItem(key);
        let restoredCorrection = false,
          restoredFlag = false;
        if (text) {
          const saved = JSON.parse(text);
          if (
            saved.actorId === actorId &&
            saved.incidentId === initial.incident_id
          ) {
            if (
              saved.pending?.operationId &&
              ["proposal", "review"].includes(saved.pending.kind)
            ) {
              setPending(saved.pending);
              restoredCorrection = true;
            }
            if (
              saved.flagPending?.operationId &&
              ["flag_fact", "resolve_fact_flag"].includes(
                saved.flagPending.kind,
              )
            ) {
              setFlagPending(saved.flagPending);
              restoredFlag = true;
            }
            if (restoredCorrection || restoredFlag)
              setMessage(
                "Recovered your unfinished correction or fact flag from this browser tab. It has not been submitted.",
              );
          }
        }
        const fact = initial.facts.find((f) => f.id === selectedFactId);
        if (fact && intent === "flag" && !restoredFlag)
          setFlagPending({
            kind: "flag_fact",
            operationId: crypto.randomUUID(),
            factId: fact.id,
            reason: "",
            suggestion: "",
          });
        if (
          fact &&
          intent === "withdraw" &&
          role === "supervisor" &&
          !restoredCorrection
        ) {
          if (correctionRestriction(fact))
            setError(correctionRestriction(fact));
          else
            setPending({
              kind: "proposal",
              operationId: crypto.randomUUID(),
              incidentRevision: initial.revision,
              target: "fact",
              targetId: fact.id,
              factId: fact.id,
              targetRevision: fact.revision,
              action: intent === "withdraw" ? "withdraw" : "amend",
              before: clone(fact.data),
              proposed: clone(fact.data),
              subject: String(fact.data.subject || "Recorded fact"),
              reason: "",
              stage: "edit",
            });
        }
        if (selectedFactId && !fact)
          setError(
            "The selected fact is not available in this case. Choose an available fact below.",
          );
      } catch {
        setStorageOk(false);
      }
      setReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [key, actorId, initial, selectedFactId, intent, role]);
  useEffect(() => {
    if (!ready) return;
    let succeeded = true;
    try {
      if (pending || flagPending)
        sessionStorage.setItem(
          key,
          JSON.stringify({
            actorId,
            incidentId: initial.incident_id,
            pending,
            flagPending,
          }),
        );
      else sessionStorage.removeItem(key);
    } catch {
      succeeded = false;
    }
    const frame = requestAnimationFrame(() => setStorageOk(succeeded));
    return () => cancelAnimationFrame(frame);
  }, [pending, flagPending, ready, key, actorId, initial.incident_id]);
  useEffect(() => {
    if ((!pending && !flagPending) || storageOk) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [pending, flagPending, storageOk]);
  useEffect(() => {
    const abort = new AbortController();
    fetch(
      `/api/fact-flags?incident_id=${encodeURIComponent(initial.incident_id)}`,
      {
        cache: "no-store",
        headers: { "x-rvw-actor": actorId },
        signal: abort.signal,
      },
    )
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw Error(errorText(data.error, data.message));
        if (!abort.signal.aborted) {
          setFlags(data.flags);
          setFlagsLoaded(true);
          setFlagError("");
        }
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          setFlagError(
            error.message ||
              "Fact flags could not be loaded. Refresh to retry.",
          );
      });
    return () => abort.abort();
  }, [actorId, initial.incident_id]);
  useEffect(() => {
    if (!ready || !selectedFactId) return;
    const target = document.getElementById(
      intent === "history" ? "sc019-history" : `sc019-fact-${selectedFactId}`,
    );
    const node =
      intent === "flag"
        ? flagEditor.current
        : ["amend", "withdraw"].includes(intent || "")
          ? editor.current
          : target;
    node?.scrollIntoView({ block: "start" });
  }, [ready, selectedFactId, intent]);
  function begin(next: Pending) {
    if (pending?.uncertain) {
      setError(
        "Resolve the unconfirmed submission by retrying it before starting a new correction.",
      );
      return;
    }
    if (
      pending &&
      !window.confirm(
        "Replace the unsubmitted correction currently in the editor? Its text will be discarded.",
      )
    )
      return;
    setPending(next);
    setError("");
    setMessage("");
    setConflict(false);
    requestAnimationFrame(() => {
      editor.current?.focus();
      editor.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  function propose(
    fact: CorrectionFact,
    target: CorrectionTarget,
    evidence?: CorrectionEvidence,
    action: "amend" | "withdraw" = "amend",
  ) {
    if (target === "fact" && action === "amend") {
      setPackageRequest((current) => ({
        factId: fact.id,
        nonce: (current?.nonce ?? 0) + 1,
      }));
      return;
    }
    if (correctionRestriction(fact)) {
      setError(correctionRestriction(fact));
      return;
    }
    const before =
      target === "fact"
        ? fact.data
        : target === "source"
          ? evidence!.source.data
          : evidence!.data;
    begin({
      kind: "proposal",
      operationId: crypto.randomUUID(),
      incidentRevision: snapshot.revision,
      target,
      targetId: evidence?.id || fact.id,
      factId: fact.id,
      targetRevision: evidence?.revision ?? fact.revision,
      action,
      before: clone(before),
      proposed: clone(before),
      reason: "",
      subject: String(fact.data.subject || "Recorded fact"),
      stage: "edit",
    });
  }
  function amend(next: Pending) {
    setPending({ ...next, operationId: crypto.randomUUID(), uncertain: false });
    setError("");
  }
  function beginFlag(
    factId: string,
    flag?: FactFlag,
    resolution: FactFlagResolution["resolution"] = "research_follow_up",
  ) {
    if (flagPending?.uncertain) {
      setFlagError(
        "Retry the unconfirmed fact flag submission before starting another.",
      );
      return;
    }
    if (
      flagPending &&
      !window.confirm(
        "Replace the unfinished fact flag or response? Its text will be discarded.",
      )
    )
      return;
    const base = {
      operationId: crypto.randomUUID(),
      factId,
      reason: "",
      suggestion: "",
    };
    setFlagPending(
      flag
        ? {
            ...base,
            kind: "resolve_fact_flag",
            flagId: flag.id,
            revision: flag.revision,
            resolution,
          }
        : { ...base, kind: "flag_fact" },
    );
    setFlagError("");
    requestAnimationFrame(() => {
      flagEditor.current?.focus();
      flagEditor.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }
  function amendFlag(next: FlagDraft) {
    setFlagPending({
      ...next,
      operationId: crypto.randomUUID(),
      uncertain: false,
    });
    setFlagError("");
  }
  async function refreshFlags() {
    try {
      const response = await fetch(
        `/api/fact-flags?incident_id=${encodeURIComponent(initial.incident_id)}`,
        {
          cache: "no-store",
          headers: { "x-rvw-actor": actorId },
        },
      );
      const data = await response.json();
      if (!response.ok) throw Error(errorText(data.error, data.message));
      setFlags(data.flags);
      setFlagsLoaded(true);
      setFlagError("");
    } catch (error) {
      setFlagError(
        error instanceof Error
          ? error.message
          : "Fact flags could not be loaded. Your text is preserved.",
      );
    }
  }
  async function submitFlag(event?: FormEvent) {
    event?.preventDefault();
    if (!flagPending || inFlight.current) return;
    if (!flagPending.reason.trim()) {
      setFlagError(
        "Describe the concern or Supervisor response before submitting.",
      );
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setFlagError("");
    setMessage("");
    try {
      const response = await fetch("/api/fact-flags", {
        method: "POST",
        headers: { "content-type": "application/json", "x-rvw-actor": actorId },
        body: JSON.stringify({
          operation_id: flagPending.operationId,
          incident_id: initial.incident_id,
          kind: flagPending.kind,
          payload:
            flagPending.kind === "flag_fact"
              ? {
                  fact_id: flagPending.factId,
                  reason: flagPending.reason.trim(),
                  suggestion: flagPending.suggestion.trim() || undefined,
                }
              : {
                  flag_id: flagPending.flagId,
                  expected_revision: flagPending.revision,
                  resolution: flagPending.resolution,
                  reason: flagPending.reason.trim(),
                },
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFlagError(errorText(data.error, data.message));
        if (response.status >= 500)
          setFlagPending({ ...flagPending, uncertain: true });
        return;
      }
      setFlagPending(null);
      setMessage(
        flagPending.kind === "flag_fact"
          ? "Fact flagged for Supervisor review. The fact, evidence, scientific status and export eligibility are unchanged."
          : flagPending.resolution === "no_change"
            ? "Flag closed without change. Your reason is recorded; fact content, evidence, scientific status and export eligibility are unchanged."
            : "Follow-up decision recorded and flag closed. Carry out the chosen follow-up separately. Any formal correction or withdrawal requires independent Supervisor review; no scientific approval changed.",
      );
      await refreshFlags();
    } catch {
      setFlagPending({ ...flagPending, uncertain: true });
      setFlagError(
        "The response could not be confirmed. Retry this exact request to recover its result without creating a duplicate.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function viewHistory(factId: string) {
    setHistoryFactId(factId);
    requestAnimationFrame(() =>
      document
        .getElementById("sc019-history")
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }
  async function refresh(): Promise<CorrectionsSnapshot | null> {
    try {
      const response = await fetch(
        `/api/corrections?incident_id=${encodeURIComponent(initial.incident_id)}`,
        { cache: "no-store", headers: { "x-rvw-actor": actorId } },
      );
      if (!response.ok) {
        setError(
          "The latest case could not be loaded. Your pending correction is preserved.",
        );
        return null;
      }
      const next = (await response.json()) as CorrectionsSnapshot;
      setSnapshot(next);
      return next;
    } catch {
      setError(
        "The connection was interrupted while refreshing. Your pending correction is preserved.",
      );
      return null;
    }
  }
  async function reconcile() {
    if (!pending || pending.kind !== "proposal") return;
    const latest = await refresh();
    if (!latest) return;
    const fact = latest.facts.find((f) => f.id === pending.factId),
      evidence = fact?.evidence.find((e) => e.id === pending.targetId);
    if (!fact || (pending.target !== "fact" && !evidence)) {
      setError(
        "The selected record is unavailable. Your text remains in the editor; return to the case for review.",
      );
      return;
    }
    const before =
      pending.target === "fact"
        ? fact.data
        : pending.target === "source"
          ? evidence!.source.data
          : evidence!.data;
    if (
      !window.confirm(
        "Use the latest recorded values as the comparison baseline and retain only the fields you changed? Inspect the comparison again before submitting.",
      )
    )
      return;
    const changes = Object.fromEntries(
      changedFields(pending.before, pending.proposed, pending.target).map(
        (f) => [f, pending.proposed[f]],
      ),
    );
    setPending({
      ...pending,
      before: clone(before),
      proposed: { ...clone(before), ...changes },
      targetRevision: evidence?.revision ?? fact.revision,
      incidentRevision: latest.revision,
      operationId: crypto.randomUUID(),
      uncertain: false,
      stage: "compare",
    });
    setConflict(false);
    setError("");
  }
  function compare(event: FormEvent) {
    event.preventDefault();
    if (!pending) return;
    if (!pending.reason.trim()) {
      setError("Explain why this correction or review is necessary.");
      return;
    }
    if (
      pending.kind === "proposal" &&
      pending.action === "amend" &&
      !changedFields(pending.before, pending.proposed, pending.target).length
    ) {
      setError(
        "Change at least one recorded value before reviewing this proposal.",
      );
      return;
    }
    setPending({ ...pending, stage: "compare" });
    setError("");
  }
  async function submit() {
    if (!pending || inFlight.current) return;
    if (pending.kind === "review" && packageIds.has(pending.correctionId)) {
      setError(
        "This is a complete fact correction package. Open its package inspection to review all evidence and choose the explicit scientific decision. Your earlier review text is retained.",
      );
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const payload =
      pending.kind === "proposal"
        ? {
            target_type: pending.target,
            target_id: pending.targetId,
            fact_id: pending.factId,
            action: pending.action,
            expected_target_revision: pending.targetRevision,
            reason: pending.reason.trim(),
            changes:
              pending.action === "withdraw"
                ? {}
                : Object.fromEntries(
                    changedFields(
                      pending.before,
                      pending.proposed,
                      pending.target,
                    ).map((f) => [f, pending.proposed[f] ?? null]),
                  ),
          }
        : {
            correction_id: pending.correctionId,
            decision: pending.decision,
            reason: pending.reason.trim(),
          };
    try {
      const response = await fetch("/api/commands", {
        method: "POST",
        headers: { "content-type": "application/json", "x-rvw-actor": actorId },
        body: JSON.stringify({
          operation_id: pending.operationId,
          incident_id: initial.incident_id,
          expected_revision: pending.incidentRevision,
          kind:
            pending.kind === "proposal"
              ? "propose_correction"
              : "review_correction",
          payload,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(errorText(result.error, result.message));
        setConflict(result.error === "SHARED_CONFLICT");
        if (response.status >= 500) setPending({ ...pending, uncertain: true });
        return;
      }
      setPending(null);
      try {
        if (!flagPending) sessionStorage.removeItem(key);
      } catch {
        /* The acknowledged save remains successful. */
      }
      setMessage(
        pending.kind === "proposal"
          ? "Correction submitted once for independent supervisor review. This proposal is not scientific approval."
          : "Review decision saved. Accepted revisions still require scientific review and incident acceptance.",
      );
      await refresh();
    } catch {
      setPending({ ...pending, uncertain: true });
      setError(
        "The response could not be confirmed. Your exact submission is retained. Retry it to recover the existing result without creating a duplicate.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const selectedReview =
    pending?.kind === "review"
      ? legacyCorrections.find((c) => c.id === pending.correctionId)
      : undefined;
  return (
    <main
      className="sc019"
      id="main"
      aria-busy={!ready}
      data-corrections-ready={ready}
    >
      <header>
        <a href={caseReturnHref(initial.incident_id, returnTo)}>
          ← Return to case
        </a>
        <p className="sc019-eyebrow">Scientific record</p>
        <h1>Corrections and History</h1>
        {snapshot.incident_label && (
          <p>
            <strong>{snapshot.incident_label}</strong>
          </p>
        )}
        <p>
          Flag a fact for Supervisor attention, inspect correction history, or
          propose a correction to submitted findings and evidence.
        </p>
        <p className="sc019-muted">
          Every formal correction proposal requires a different authorized
          Supervisor to review it. Accepted changes do not inherit earlier
          scientific approval.{" "}
          {role === "researcher" &&
            "Researchers can propose complete fact corrections, flag concerns, and propose evidence or citation corrections. Fact withdrawal proposals remain reserved for Supervisors."}
        </p>
        <nav
          className="sc019-actions"
          aria-label="Corrections and review sections"
        >
          <a href="#fact-correction-packages">Fact correction packages</a>
          <a href="#sc019-records">Facts and evidence</a>
          <a href="#sc019-flags">Fact flags and Supervisor responses</a>
          <a href="#sc019-history">Correction history</a>
        </nav>
      </header>
      <FactCorrectionPackages
        actorId={actorId}
        role={role}
        incidentId={initial.incident_id}
        request={packageRequest}
        selectedPackageId={selectedPackageId}
        returnHref={caseReturnHref(initial.incident_id, returnTo)}
        onSaved={() => {
          void refresh();
          void refreshFlags();
        }}
      />
      {message && (
        <p className="sc019-success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="sc019-error" role="alert">
          {error}
        </p>
      )}
      {flagError && (
        <p className="sc019-error" role="alert">
          {flagError}
        </p>
      )}
      <section
        ref={flagEditor}
        className="sc019-editor"
        aria-label="Fact flag editor"
        tabIndex={-1}
      >
        {flagPending && (
          <>
            <h2>
              {flagPending.kind === "flag_fact"
                ? "Flag Fact for Review"
                : flagPending.resolution === "no_change"
                  ? "Close flag without change"
                  : "Act on flag"}
            </h2>
            <p>
              <strong>
                {valueLabel(
                  snapshot.facts.find((f) => f.id === flagPending.factId)?.data
                    .subject,
                )}
              </strong>
            </p>
            <p className="sc019-save" role="status">
              {storageOk
                ? "Saved in this browser tab for your account and this case · not submitted"
                : "Browser recovery is unavailable. Preserve your text before leaving or refreshing."}
            </p>
            <p className="sc019-note">
              A fact flag requests attention. It does not amend a fact, change
              its evidence, approve a scientific finding, or change export
              eligibility.
            </p>
            {flagPending.kind === "resolve_fact_flag" && (
              <blockquote>
                <strong>Recorded concern:</strong>{" "}
                {flags.find((flag) => flag.id === flagPending.flagId)?.reason}
              </blockquote>
            )}
            <form onSubmit={submitFlag}>
              <fieldset
                className="sc019-form-fields"
                disabled={busy || flagPending.uncertain}
              >
                {flagPending.kind === "resolve_fact_flag" && (
                  <Choice
                    label="Supervisor next action"
                    value={flagPending.resolution}
                    choices={[
                      ["correction", "Prepare formal correction"],
                      ["withdrawal", "Prepare formal withdrawal"],
                      ["research_follow_up", "Research follow-up"],
                      ["no_change", "Close without change"],
                    ]}
                    onChange={(resolution) =>
                      amendFlag({
                        ...flagPending,
                        resolution:
                          resolution as FactFlagResolution["resolution"],
                      })
                    }
                  />
                )}
                <label htmlFor="sc019-flag-reason">
                  {flagPending.kind === "flag_fact"
                    ? "Concern"
                    : "Supervisor response and reason"}
                </label>
                <textarea
                  id="sc019-flag-reason"
                  name="flag_reason"
                  required
                  maxLength={4000}
                  rows={4}
                  value={flagPending.reason}
                  onChange={(event) =>
                    amendFlag({ ...flagPending, reason: event.target.value })
                  }
                />
                {flagPending.kind === "flag_fact" && (
                  <>
                    <label htmlFor="sc019-flag-suggestion">
                      Suggested investigation (optional)
                    </label>
                    <textarea
                      id="sc019-flag-suggestion"
                      name="flag_suggestion"
                      maxLength={4000}
                      rows={3}
                      value={flagPending.suggestion}
                      onChange={(event) =>
                        amendFlag({
                          ...flagPending,
                          suggestion: event.target.value,
                        })
                      }
                    />
                  </>
                )}
                {flagPending.kind === "resolve_fact_flag" && (
                  <p className="sc019-note" role="status">
                    {flagPending.resolution === "no_change"
                      ? "Closes this concern with your required reason. Fact content, evidence, scientific status and export eligibility remain unchanged."
                      : "Records your chosen follow-up and required reason, then closes this flag. It does not create a task or proposal. Carry out the follow-up separately; any formal correction or withdrawal requires review by a different authorized Supervisor. The scientific record is unchanged by this decision."}
                  </p>
                )}
                <div className="sc019-actions">
                  <ActionButton
                    type="submit"
                    className="primary"
                    hint={
                      flagPending.kind === "flag_fact"
                        ? "Send your concern to Supervisors. This does not change the scientific record."
                        : flagPending.resolution === "no_change"
                          ? "Close the concern with your reason. The scientific record stays unchanged."
                          : "Record the selected follow-up and close this flag. Carry out that follow-up separately."
                    }
                  >
                    {busy
                      ? "Saving…"
                      : flagPending.kind === "flag_fact"
                        ? "Submit fact flag"
                        : flagPending.resolution === "no_change"
                          ? "Close flag without change"
                          : "Record follow-up and close flag"}
                  </ActionButton>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Discard this unfinished fact flag or response?",
                        )
                      ) {
                        setFlagPending(null);
                        setFlagError("");
                      }
                    }}
                  >
                    Discard unfinished flag
                  </button>
                </div>
              </fieldset>
            </form>
            {flagPending.uncertain && (
              <button disabled={busy} onClick={() => submitFlag()}>
                Retry the same fact flag submission
              </button>
            )}
          </>
        )}
      </section>
      {recoveredPackageReview && pending?.kind === "review" && (
        <p className="sc019-note">
          An unfinished review of a complete package was recovered. Its
          explanation is preserved: {pending.reason || "No explanation entered"}
          .{" "}
          <a href="#fact-correction-packages">
            Open the complete package to choose its review decision
          </a>
          .
        </p>
      )}
      <section
        ref={editor}
        className="sc019-editor"
        aria-label="Correction editor"
        tabIndex={-1}
      >
        {pending && !recoveredPackageReview && (
          <>
            <h2>
              {pending.kind === "review"
                ? `${pending.decision === "accept" ? "Accept" : "Reject"} correction`
                : pending.action === "withdraw"
                  ? pending.target === "fact"
                    ? "Propose fact withdrawal"
                    : "Remove evidence from this fact"
                  : pending.target === "source"
                    ? "Correct this fact’s citation"
                    : `Correct ${pending.target}`}
            </h2>
            <p className="sc019-save" role="status">
              {storageOk
                ? "Saved in this browser tab only · not submitted"
                : "Browser recovery is unavailable. Preserve your text before leaving or refreshing."}
            </p>
            {pending.kind === "proposal" && (
              <p>
                <strong>{pending.subject}</strong>
              </p>
            )}
            {pending.kind === "proposal" && pending.target === "source" && (
              <p className="sc019-note">
                Only this fact’s citation is changed. The source identity and
                citations used by other facts are preserved.
              </p>
            )}
            <form onSubmit={compare}>
              <fieldset
                disabled={busy || !!pending.uncertain}
                className="sc019-form-fields"
              >
                {pending.stage === "edit" &&
                  pending.kind === "proposal" &&
                  pending.action === "amend" && (
                    <ProposalFields
                      draft={pending}
                      update={(proposed) => amend({ ...pending, proposed })}
                    />
                  )}
                {pending.kind === "proposal" &&
                  (pending.stage === "compare" ||
                    pending.action === "withdraw") && (
                    <Comparison
                      target={pending.target}
                      before={pending.before}
                      proposed={pending.proposed}
                      withdrawal={pending.action === "withdraw"}
                    />
                  )}
                {selectedReview && (
                  <>
                    <p>
                      <strong>Proposer’s reason:</strong>{" "}
                      {selectedReview.reason}
                    </p>
                    <Comparison
                      target={selectedReview.target_type}
                      before={selectedReview.before}
                      proposed={selectedReview.proposed}
                      withdrawal={selectedReview.action === "withdraw"}
                    />
                  </>
                )}
                {pending.stage === "edit" ? (
                  <TextField
                    name="reason"
                    value={pending.reason}
                    required
                    onChange={(reason) =>
                      amend({ ...pending, reason: String(reason || "") })
                    }
                  />
                ) : (
                  <p>
                    <strong>
                      {pending.kind === "review"
                        ? "Review reason"
                        : "Correction reason"}
                      :
                    </strong>{" "}
                    {pending.reason}
                  </p>
                )}
                <div className="sc019-actions">
                  {pending.stage === "edit" ? (
                    <ActionButton
                      type="submit"
                      className="primary"
                      hint="Check the existing record, proposed change and reason before submitting."
                    >
                      Review proposed changes
                    </ActionButton>
                  ) : (
                    <>
                      <ActionButton
                        type="button"
                        className="primary"
                        onClick={submit}
                        hint={
                          pending.kind === "proposal"
                            ? "Send this proposal for independent Supervisor review. Scientific approval is not automatic."
                            : "Record your independent decision. Accepted text still needs scientific review."
                        }
                      >
                        {busy
                          ? "Saving…"
                          : pending.kind === "proposal"
                            ? "Submit correction for review"
                            : "Save review decision"}
                      </ActionButton>
                      <button
                        type="button"
                        onClick={() =>
                          setPending({ ...pending, stage: "edit" })
                        }
                      >
                        Back to edit
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm("Discard this unsubmitted correction?")
                      ) {
                        setPending(null);
                        setError("");
                        setConflict(false);
                      }
                    }}
                  >
                    Discard unsubmitted correction
                  </button>
                </div>
              </fieldset>
            </form>
            {pending.uncertain && (
              <button disabled={busy} onClick={submit}>
                Retry the same submission safely
              </button>
            )}
            {conflict && pending.kind === "proposal" && (
              <button disabled={busy} onClick={reconcile}>
                Compare with latest record, keeping my edits
              </button>
            )}
            {conflict && pending.kind === "review" && (
              <button
                disabled={busy}
                onClick={async () => {
                  const next = await refresh();
                  if (next) {
                    setPending({
                      ...pending,
                      operationId: crypto.randomUUID(),
                      incidentRevision: next.revision,
                      stage: "edit",
                    });
                    setConflict(false);
                  }
                }}
              >
                Load latest case before reviewing again
              </button>
            )}
          </>
        )}
      </section>
      <section aria-labelledby="sc019-records">
        <div className="sc019-section-head">
          <h2 id="sc019-records">Submitted facts and evidence</h2>
          <button
            disabled={busy}
            onClick={() => Promise.all([refresh(), refreshFlags()])}
          >
            Refresh records
          </button>
        </div>
        {snapshot.facts.map((fact) => (
          <article
            key={fact.id}
            id={`sc019-fact-${fact.id}`}
            className={`sc019-card${fact.id === selectedFactId ? " sc019-selected" : ""}`}
          >
            <div className="sc019-card-head">
              <div>
                <p className="sc019-eyebrow">
                  {fieldLabel(
                    String(fact.data.claim_family || "Recorded fact"),
                  ).toLowerCase()}
                  {isWithdrawn(fact.data) && " · Withdrawn fact"}
                </p>
                <h3>{valueLabel(fact.data.subject)}</h3>
                <p className="sc019-value">
                  {valueLabel(fact.data.current_verified_value)}
                  {fact.data.date_precision &&
                    ` · ${valueLabel(fact.data.date_precision)}`}
                  {fact.data.quantitative_unit &&
                    ` ${valueLabel(fact.data.quantitative_unit)}`}
                </p>
              </div>
              <div className="sc019-actions">
                <ActionButton
                  hint={actionHints.flag}
                  disabled={busy || !ready}
                  onClick={() => beginFlag(fact.id)}
                >
                  Flag Fact for Review
                </ActionButton>
                <ActionButton
                  className="primary"
                  hint={correctionRestriction(fact) || actionHints.amend}
                  disabled={busy || !ready || !!correctionRestriction(fact)}
                  onClick={() => propose(fact, "fact")}
                >
                  Propose Fact Correction
                </ActionButton>
                {role === "supervisor" && (
                  <>
                    <ActionButton
                      className="scientific-danger"
                      hint={correctionRestriction(fact) || actionHints.withdraw}
                      disabled={busy || !ready || !!correctionRestriction(fact)}
                      onClick={() =>
                        propose(fact, "fact", undefined, "withdraw")
                      }
                    >
                      Withdraw Fact
                    </ActionButton>
                  </>
                )}
                <ActionButton
                  className="scientific-history"
                  hint={actionHints.history}
                  onClick={() => viewHistory(fact.id)}
                >
                  View Correction History
                </ActionButton>
                <a href="#sc019-flags">
                  {flagsLoaded
                    ? `${flags.filter((flag) => flag.fact_id === fact.id && flag.status === "pending").length} pending flags`
                    : "View fact flags"}
                </a>
              </div>
            </div>
            {correctionRestriction(fact) && (
              <p className="sc019-note">{correctionRestriction(fact)}</p>
            )}
            {fact.correction_state && (
              <p
                className={
                  fact.correction_state === "review_required"
                    ? "sc019-note"
                    : "sc019-meta"
                }
              >
                {fact.correction_state === "review_required" ? (
                  <strong>{correctionStatus(fact.correction_state)}</strong>
                ) : fact.correction_state === "pending" &&
                  snapshot.corrections.some(
                    (correction) =>
                      correction.fact_id === fact.id &&
                      correction.status === "pending" &&
                      packageIds.has(correction.id),
                  ) &&
                  !legacyCorrections.some(
                    (correction) =>
                      correction.fact_id === fact.id &&
                      correction.status === "pending",
                  ) ? (
                  "Correction package awaiting independent review — the current fact and scientific status remain unchanged."
                ) : (
                  correctionStatus(fact.correction_state)
                )}
              </p>
            )}
            {fact.data.review_notes && (
              <p>
                <strong>Review limitations:</strong>{" "}
                {valueLabel(fact.data.review_notes)}
              </p>
            )}
            <div className="sc019-evidence-list">
              {fact.evidence.map((e) => (
                <section
                  key={e.id}
                  className={`sc019-evidence${isWithdrawn(e.data) ? " sc019-withdrawn" : ""}`}
                >
                  <SourceSummary evidence={e} />
                  {!isWithdrawn(e.data) && !isWithdrawn(fact.data) && (
                    <div className="sc019-actions">
                      <button
                        disabled={
                          busy || !ready || !!correctionRestriction(fact)
                        }
                        onClick={() => propose(fact, "evidence", e)}
                      >
                        Edit submitted evidence
                      </button>
                      <button
                        disabled={
                          busy || !ready || !!correctionRestriction(fact)
                        }
                        onClick={() => propose(fact, "source", e)}
                      >
                        Correct citation for this fact
                      </button>
                      <button
                        disabled={
                          busy || !ready || !!correctionRestriction(fact)
                        }
                        onClick={() => propose(fact, "evidence", e, "withdraw")}
                      >
                        Remove evidence from this fact
                      </button>
                    </div>
                  )}
                </section>
              ))}
            </div>
            {!fact.evidence.length && (
              <p>
                No evidence relationships recorded. Missing support does not
                establish a negative finding.
              </p>
            )}
          </article>
        ))}
        {!snapshot.facts.length && (
          <p>No submitted facts are available for this case.</p>
        )}
      </section>
      <section aria-labelledby="sc019-flags">
        <div className="sc019-section-head">
          <h2 id="sc019-flags">Fact flags and Supervisor responses</h2>
          <button disabled={busy} onClick={refreshFlags}>
            Refresh fact flags
          </button>
        </div>
        <p>
          Flags preserve the recorded fact and its scientific status. A
          Supervisor reviews the concern and records a response; any formal
          change follows its own review process.
        </p>
        {!flagsLoaded && !flagError && <p role="status">Loading fact flags…</p>}
        {flagsLoaded && !flags.length && (
          <p>No fact flags have been submitted for this case.</p>
        )}
        {flags.map((flag) => {
          const fact = snapshot.facts.find((f) => f.id === flag.fact_id);
          return (
            <article
              className="sc019-card"
              key={flag.id}
              data-fact-flag={flag.id}
            >
              <div className="sc019-card-head">
                <h3>
                  {valueLabel(flag.fact_snapshot.subject || fact?.data.subject)}
                </h3>
                <span className="sc019-badge">
                  {flag.status === "pending"
                    ? "Pending Supervisor review"
                    : flag.resolution?.resolution === "no_change"
                      ? "Resolved · closed without change"
                      : "Resolved · follow-up recorded"}
                </span>
              </div>
              <p>
                <strong>Concern:</strong> {flag.reason}
              </p>
              {flag.suggestion && (
                <p>
                  <strong>Suggested investigation:</strong> {flag.suggestion}
                </p>
              )}
              <p className="sc019-meta">
                Flagged by{" "}
                {flag.actor_id === actorId
                  ? "you"
                  : flag.actor_name || "Case contributor"}{" "}
                · {when(flag.created_at)} · Fact revision {flag.fact_revision} ·
                Flag revision {flag.revision}
              </p>
              <details>
                <summary>Fact recorded when flagged</summary>
                <p>{valueLabel(flag.fact_snapshot.current_verified_value)}</p>
                <p>{valueLabel(flag.fact_snapshot.review_notes)}</p>
              </details>
              {flag.resolution && (
                <>
                  <p>
                    <strong>Supervisor decision:</strong>{" "}
                    {
                      {
                        correction: "Act on flag — prepare formal correction",
                        withdrawal: "Act on flag — prepare formal withdrawal",
                        research_follow_up: "Act on flag — research follow-up",
                        no_change: "Close without change",
                      }[flag.resolution.resolution]
                    }
                  </p>
                  <p>
                    <strong>Response:</strong> {flag.resolution.reason}
                  </p>
                  <p className="sc019-meta">
                    {flag.resolution.actor_id === actorId
                      ? "You"
                      : flag.resolution.actor_name || "Supervisor"}{" "}
                    · {when(flag.resolution.created_at)}
                  </p>
                  <p className="sc019-muted">
                    {flag.resolution.resolution === "no_change"
                      ? "This concern was closed with the reason above. The fact and its scientific status are unchanged."
                      : "The chosen follow-up is recorded, not automatically carried out. Any formal correction or withdrawal needs its own independent review; this decision does not approve the fact."}
                  </p>
                </>
              )}
              {role === "supervisor" && flag.status === "pending" && (
                <section
                  className="sc019-flag-decision"
                  aria-label="Supervisor flag decision"
                >
                  <p>
                    <strong>How should this concern be handled?</strong>
                  </p>
                  <div className="sc019-actions">
                    <ActionButton
                      className="primary"
                      hint="Choose a follow-up and explain why. The decision alone does not change or approve the fact."
                      disabled={busy || !ready}
                      onClick={() => beginFlag(flag.fact_id, flag)}
                    >
                      Act on flag
                    </ActionButton>
                    <ActionButton
                      hint="Close this concern with a reason, leaving the scientific record unchanged."
                      disabled={busy || !ready}
                      onClick={() => beginFlag(flag.fact_id, flag, "no_change")}
                    >
                      Close without change
                    </ActionButton>
                  </div>
                  <p className="sc019-muted">
                    Act on flag records a chosen follow-up. Close without change
                    closes the concern. Both require a reason; neither changes
                    or approves the scientific finding.
                  </p>
                </section>
              )}
              <div className="sc019-actions">
                <a href={`#sc019-fact-${flag.fact_id}`}>
                  Inspect fact and evidence
                </a>
                {fact && (
                  <ActionButton
                    hint={
                      correctionRestriction(fact) ||
                      "Prepare a complete correction linked to this flag. Explain the follow-up; no acceptance is implied."
                    }
                    disabled={busy || !ready || !!correctionRestriction(fact)}
                    onClick={() =>
                      setPackageRequest((current) => ({
                        factId: fact.id,
                        flagId: flag.id,
                        nonce: (current?.nonce ?? 0) + 1,
                      }))
                    }
                  >
                    Propose Fact Correction from this flag
                  </ActionButton>
                )}
                {role === "supervisor" && fact && (
                  <>
                    <ActionButton
                      className="scientific-danger"
                      hint={correctionRestriction(fact) || actionHints.withdraw}
                      disabled={busy || !ready || !!correctionRestriction(fact)}
                      onClick={() =>
                        propose(fact, "fact", undefined, "withdraw")
                      }
                    >
                      Withdraw Fact
                    </ActionButton>
                  </>
                )}
              </div>
              {fact && correctionRestriction(fact) && (
                <p className="sc019-note">{correctionRestriction(fact)}</p>
              )}
            </article>
          );
        })}
      </section>
      <section aria-labelledby="sc019-history">
        <h2 id="sc019-history">
          Evidence, citation and earlier correction decisions
        </h2>
        {packageIds.size > 0 && (
          <p>
            Complete fact correction packages and their scientific decisions are
            recorded above.{" "}
            <a href="#fact-correction-packages">
              Inspect package history and approval decisions
            </a>
            .
          </p>
        )}
        {historyFactId && (
          <div className="sc019-actions">
            <p>
              History for{" "}
              {valueLabel(
                snapshot.facts.find((f) => f.id === historyFactId)?.data
                  .subject,
              )}
            </p>
            <button onClick={() => setHistoryFactId(undefined)}>
              Show all case corrections
            </button>
          </div>
        )}
        {!legacyCorrections.some(
          (c) => !historyFactId || c.fact_id === historyFactId,
        ) && <p>No correction proposals recorded.</p>}
        {legacyCorrections
          .filter((c) => !historyFactId || c.fact_id === historyFactId)
          .map((c) => (
            <article className="sc019-card" key={c.id}>
              <div className="sc019-card-head">
                <h3>
                  {c.action === "withdraw" ? "Withdrawal" : "Correction"} ·{" "}
                  {c.target_type === "source"
                    ? "Selected citation"
                    : c.target_type === "fact"
                      ? "Fact"
                      : "Evidence relationship"}
                </h3>
                <span className="sc019-badge">
                  {c.status === "accepted"
                    ? "Correction accepted · scientific review still required"
                    : c.status === "rejected"
                      ? "Correction rejected · history retained"
                      : "Awaiting independent review"}
                </span>
              </div>
              <p>
                {valueLabel(
                  snapshot.facts.find((f) => f.id === c.fact_id)?.data.subject,
                )}
              </p>
              <p>
                <strong>Reason:</strong> {c.reason}
              </p>
              <p className="sc019-meta">
                Proposed {when(c.created_at)} ·{" "}
                {c.proposed_by === actorId
                  ? "You"
                  : c.proposed_by_name || "Another case contributor"}
                {c.reviewed_at &&
                  ` · Reviewed ${when(c.reviewed_at)} by ${c.reviewed_by === actorId ? "you" : c.reviewed_by_name || "an independent supervisor"}`}
              </p>
              {c.review_reason && (
                <p>
                  <strong>Review reason:</strong> {c.review_reason}
                </p>
              )}
              <details>
                <summary>Original and proposed record</summary>
                <Comparison
                  target={c.target_type}
                  before={c.before}
                  proposed={c.proposed}
                  withdrawal={c.action === "withdraw"}
                />
                <details>
                  <summary>
                    Complete recorded values before this correction
                  </summary>
                  <dl>
                    {correctionFields[c.target_type].map((k) => (
                      <div key={k}>
                        <dt>{fieldLabel(k)}</dt>
                        <dd>{valueLabel(c.before[k])}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </details>
              {c.status === "pending" &&
                role === "supervisor" &&
                (c.proposed_by === actorId ? (
                  <p className="sc019-muted">
                    Another eligible supervisor must review your proposal.
                  </p>
                ) : (
                  <div className="sc019-actions">
                    {(["accept", "reject"] as const).map((decision) => (
                      <button
                        key={decision}
                        disabled={busy || !ready}
                        onClick={() =>
                          begin({
                            kind: "review",
                            operationId: crypto.randomUUID(),
                            incidentRevision: snapshot.revision,
                            correctionId: c.id,
                            decision,
                            reason: "",
                            stage: "edit",
                          })
                        }
                      >
                        {decision === "accept"
                          ? "Review for acceptance"
                          : "Review for rejection"}
                      </button>
                    ))}
                  </div>
                ))}
            </article>
          ))}
      </section>
      {snapshot.opportunities.length > 0 && (
        <section>
          <h2>Research follow-up</h2>
          <p>
            These questions arise from corrections. They do not establish that
            an event or effect did not occur.
          </p>
          {snapshot.opportunities.map(({ id, data: op }) => (
            <article className="sc019-card" key={id}>
              <h3>{correctionStatus(op.opportunity_kind)}</h3>
              <p>{valueLabel(op.factual_question)}</p>
              <p>
                <strong>Reason:</strong> {valueLabel(op.reason)}
              </p>
              <p>
                <strong>Next action:</strong> {valueLabel(op.next_action)}
              </p>
              <p className="sc019-meta">
                {valueLabel(op.status)} ·{" "}
                {op.support_gap === true
                  ? "Support gap remains"
                  : "Reassess recorded support"}
              </p>
            </article>
          ))}
        </section>
      )}
      {!!legacyVersions.length && (
        <section>
          <h2>Preserved scientific history</h2>
          <p className="sc019-muted">
            These versions begin with the recorded state captured by this
            correction workflow. Earlier unrecorded versions have not been
            reconstructed. Correction acceptance is distinct from scientific
            certification.
          </p>
          <details>
            <summary>
              Inspect preserved versions and prior review context
            </summary>
            {legacyVersions.map((version) => (
              <PreservedVersion
                key={version.id}
                version={version}
                actorId={actorId}
              />
            ))}
            {legacyCorrections
              .filter((c) => c.before_context)
              .map((c) => (
                <article key={c.id} className="sc019-card">
                  <h3>Prior review context captured {when(c.created_at)}</h3>
                  <p>{valueLabel(c.before_context?.capture_basis)}</p>
                  <ContextDetails context={c.before_context!} />
                </article>
              ))}
          </details>
        </section>
      )}
    </main>
  );
}
