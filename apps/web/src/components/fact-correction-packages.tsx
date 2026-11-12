"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  changedFields,
  correctionFields,
  fieldLabel,
  isWithdrawn,
  sourceHref,
  valueLabel,
  type CorrectionFact,
  type ScientificData,
} from "@/lib/corrections";
import type {
  FactCorrectionPackage,
  FactCorrectionPackageCommand,
  FactCorrectionPackagesSnapshot,
  PackageDecision,
  PackageEvidence,
  PackageEvidenceInput,
  PackageSource,
} from "@/lib/fact-correction-packages";
import {
  ActionButton,
  Choice,
  DateFields,
  ProposalFields,
  StructuredField,
} from "./scientific-correction-fields";
import "./fact-correction-packages.css";

const endpoint = "/api/fact-correction-packages";
const directions: [string, string][] = [
  ["SUPPORTS", "Supports"],
  ["CONTRADICTS", "Challenges"],
  ["LIMITS", "Qualifies"],
  ["CONTEXT_ONLY", "Context"],
];
const decisionLabels: Record<PackageDecision, string> = {
  accept: "Accept Correction",
  accept_and_approve: "Accept Correction & Approve Fact",
  return: "Return for Revision",
  reject: "Reject Correction",
};
const decisionHints: Record<PackageDecision, string> = {
  accept:
    "Adopt the proposed wording and evidence. Scientific acceptance remains pending; previous approval does not carry forward.",
  accept_and_approve:
    "Adopt this exact package and record your independent scientific approval if all current eligibility checks pass.",
  return:
    "Keep the current fact unchanged and explain the revisions needed. The proposer can prepare a linked replacement package.",
  reject:
    "Keep the current fact unchanged and record why this proposed correction should not be adopted.",
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function restriction(fact: CorrectionFact) {
  if (fact.correction_restriction)
    return `${fact.correction_restriction.message} ${fact.correction_restriction.next_action}`;
  if (fact.lock?.locked)
    return (
      fact.lock.reason ||
      "This fact or case must be reopened by an authorized Supervisor before correction."
    );
  if (isWithdrawn(fact.data))
    return "This fact is withdrawn. Its history remains available.";
  return "";
}
function initialEvidence(fact: CorrectionFact): PackageEvidence[] {
  return fact.evidence
    .filter((e) => !isWithdrawn(e.data))
    .map((e) => ({
      relationship_id: e.id,
      source_id: e.source.id,
      expected_relationship_revision: e.revision,
      expected_source_revision: e.source.revision,
      action: "retain",
      changes: {},
      reason: "",
      before: clone(e.data),
      proposed: clone(e.data),
      source: clone(e.source),
    }));
}
function evidenceInput(item: PackageEvidence): PackageEvidenceInput {
  const changes =
    item.action === "add"
      ? item.proposed || {}
      : item.action === "change"
        ? Object.fromEntries(
            changedFields(
              item.before || {},
              item.proposed || {},
              "evidence",
            ).map((k) => [k, item.proposed?.[k] ?? null]),
          )
        : {};
  return {
    relationship_id: item.relationship_id,
    source_id: item.source_id,
    expected_relationship_revision: item.expected_relationship_revision,
    expected_source_revision: item.expected_source_revision,
    action: item.action,
    changes,
    reason: item.reason.trim(),
    ...(item.new_source ? { new_source: item.new_source } : {}),
  };
}
function sourceData(item: PackageEvidence) {
  return item.new_source || item.source?.data || {};
}
function describeError(result: { message?: string; error?: string }) {
  return (
    result.message ||
    result.error ||
    "The package could not be saved. Your input is preserved."
  );
}
type Intake = {
  source: ScientificData;
  relation: ScientificData;
  reason: string;
};
type Draft = {
  operationId: string;
  factId: string;
  incidentRevision: number;
  factRevision: number;
  before: ScientificData;
  proposed: ScientificData;
  evidence: PackageEvidence[];
  reason: string;
  identity: "" | "same" | "new";
  stage: "edit" | "preview";
  previousId?: string;
  flagId?: string;
  flagReason: string;
  intake?: Intake;
};
type ReviewDraft = {
  operationId: string;
  packageId: string;
  incidentRevision: number;
  decision: PackageDecision;
  reason: string;
  basis: string;
  evidenceIndices: number[];
  attestation: boolean;
  confirmed: boolean;
};
export type PackageEditorRequest = {
  factId: string;
  flagId?: string;
  nonce: number;
};

function Citation({ data }: { data: ScientificData }) {
  const href = sourceHref(data);
  return (
    <div className="package-citation">
      <strong>{valueLabel(data.title)}</strong>
      <p>
        {valueLabel(data.publisher_platform)} · {valueLabel(data.source_type)} ·{" "}
        {valueLabel(data.publication_date)}
      </p>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer">
          Open recorded source ↗
        </a>
      ) : (
        <p>{valueLabel(data.original_url)}</p>
      )}
      <dl>
        <div>
          <dt>Access</dt>
          <dd>{valueLabel(data.retrieval_body_status)}</dd>
        </div>
        <div>
          <dt>Preservation</dt>
          <dd>{valueLabel(data.content_preservation_status)}</dd>
        </div>
        <div>
          <dt>Source limitations</dt>
          <dd>{valueLabel(data.limitations)}</dd>
        </div>
        {data.social_fields && (
          <div>
            <dt>Social source details</dt>
            <dd>{valueLabel(data.social_fields)}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
function EvidenceCard({
  item,
  index,
  update,
  discard,
}: {
  item: PackageEvidence;
  index: number;
  update?: (item: PackageEvidence) => void;
  discard?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const data = item.proposed || item.before || {};
  const source = sourceData(item);
  const state = {
    retain: "Retained",
    add: "Newly attached",
    change: "Changed relationship",
    remove: "Proposed removal",
  }[item.action];
  function edit(next: ScientificData) {
    update?.({
      ...item,
      proposed: next,
      action:
        item.action === "add"
          ? "add"
          : changedFields(item.before || {}, next, "evidence").length
            ? "change"
            : "retain",
    });
  }
  return (
    <article
      className="package-evidence-card"
      data-direction={
        item.action === "remove" ? "REMOVED" : String(data.support_direction)
      }
      data-evidence-action={item.action}
    >
      <button
        type="button"
        className="package-card-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span>
          <strong>{valueLabel(source.title)}</strong>
          <small>
            {valueLabel(source.publisher_platform)} ·{" "}
            {valueLabel(source.publication_date)}
          </small>
        </span>
        <span className="package-evidence-state">
          {state} ·{" "}
          {item.action === "remove"
            ? "No longer applies"
            : valueLabel(data.support_direction)}
          <small>
            {expanded
              ? "Hide citation and relationship details"
              : "Inspect citation and relationship details"}
          </small>
        </span>
      </button>
      {update && (
        <div className="package-evidence-controls">
          <Choice
            label={`Relationship for ${valueLabel(source.title)}`}
            value={String(data.support_direction || "")}
            choices={[["", "Choose relationship…"], ...directions]}
            onChange={(v) => edit({ ...data, support_direction: v })}
          />
          {item.action === "add" ? (
            <ActionButton
              type="button"
              hint="Remove only this unsent attachment from your proposal."
              onClick={discard}
            >
              Remove unsent attachment
            </ActionButton>
          ) : (
            <ActionButton
              type="button"
              hint={
                item.action === "remove"
                  ? "Restore this relationship in the proposal. No current relationship has been changed."
                  : "Propose ending only this fact’s relationship to the source. Explain why; the original evidence remains in history."
              }
              onClick={() =>
                update({
                  ...item,
                  action:
                    item.action === "remove"
                      ? changedFields(item.before || {}, data, "evidence")
                          .length
                        ? "change"
                        : "retain"
                      : "remove",
                  proposed: clone(data),
                })
              }
            >
              {item.action === "remove"
                ? "Keep relationship"
                : "Propose removal"}
            </ActionButton>
          )}
        </div>
      )}
      {(item.action !== "retain" || item.reason) && (
        <div className="package-relationship-reason">
          {update ? (
            <label>
              Reason for{" "}
              {item.action === "add"
                ? "adding this evidence"
                : item.action === "remove"
                  ? "removing this relationship"
                  : "changing this relationship"}
              <textarea
                required
                maxLength={4000}
                value={item.reason}
                onChange={(e) => update({ ...item, reason: e.target.value })}
                placeholder="Explain how this source applies to the revised proposition, including any conflict being reconciled."
              />
            </label>
          ) : (
            <p>
              <strong>Relationship reason:</strong>{" "}
              {item.reason || "Not recorded"}
            </p>
          )}
        </div>
      )}
      {expanded && (
        <div className="package-evidence-detail">
          <Citation data={source} />
          <p>
            <strong>Original relationship:</strong>{" "}
            {item.before
              ? valueLabel(item.before.support_direction)
              : "Not previously attached to this fact"}
          </p>
          <p>
            <strong>Resulting relationship:</strong>{" "}
            {item.action === "remove"
              ? "Proposed removal — earlier evidence is preserved"
              : valueLabel(data.support_direction)}
          </p>
          {!update && item.before && item.action !== "retain" && (
            <details>
              <summary>
                Complete original relationship before this proposal
              </summary>
              <dl>
                {Object.entries(item.before).map(([name, value]) => (
                  <div key={name}>
                    <dt>{fieldLabel(name)}</dt>
                    <dd>{valueLabel(value)}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          {update && item.action !== "remove" ? (
            <>
              <StructuredField
                name="evidence_locator"
                value={data.evidence_locator}
                onChange={(v) => edit({ ...data, evidence_locator: v })}
              />
              <StructuredField
                name="limitations"
                value={data.limitations}
                onChange={(v) => edit({ ...data, limitations: v })}
              />
              <details>
                <summary>
                  Directness, originality and reporting dependencies
                </summary>
                {[
                  "directness",
                  "originality",
                  "evidence_role",
                  "dependency_group_id",
                  "dependency_provenance",
                ].map((name) => (
                  <StructuredField
                    key={name}
                    name={name}
                    value={data[name]}
                    onChange={(v) => edit({ ...data, [name]: v })}
                  />
                ))}
              </details>
            </>
          ) : (
            <dl>
              {correctionFields.evidence
                .filter((k) => k !== "support_direction")
                .map((k) => (
                  <div key={k}>
                    <dt>{fieldLabel(k)}</dt>
                    <dd>{valueLabel(data[k])}</dd>
                  </div>
                ))}
            </dl>
          )}
          <small>
            Evidence item {index + 1}. Selecting or editing this relationship
            does not edit the shared source record.
          </small>
        </div>
      )}
    </article>
  );
}
function FactComparison({
  before,
  proposed,
}: {
  before: ScientificData;
  proposed: ScientificData;
}) {
  return (
    <div className="package-comparison">
      <div className="package-comparison-heading">
        <strong>Original fact</strong>
        <strong>Proposed fact</strong>
      </div>
      {correctionFields.fact
        .filter((k) => before[k] != null || proposed[k] != null)
        .map((k) => (
          <section key={k}>
            <h4>
              {fieldLabel(k)}
              {JSON.stringify(before[k] ?? null) ===
              JSON.stringify(proposed[k] ?? null)
                ? " · unchanged"
                : " · proposed change"}
            </h4>
            <div>
              <p>{valueLabel(before[k])}</p>
              <p>{valueLabel(proposed[k])}</p>
            </div>
          </section>
        ))}
    </div>
  );
}
function PackageComparison({
  before,
  proposed,
  evidence,
  reason,
}: {
  before: ScientificData;
  proposed: ScientificData;
  evidence: PackageEvidence[];
  reason: string;
}) {
  const challenges = evidence.filter(
    (e) =>
      e.action !== "remove" && e.proposed?.support_direction === "CONTRADICTS",
  );
  return (
    <>
      <FactComparison before={before} proposed={proposed} />
      <p>
        <strong>Correction explanation:</strong> {reason}
      </p>
      <h3>Complete evidence package</h3>
      <p>
        {evidence.filter((e) => e.action === "retain").length} retained ·{" "}
        {evidence.filter((e) => e.action === "add").length} added ·{" "}
        {evidence.filter((e) => e.action === "change").length} changed ·{" "}
        {evidence.filter((e) => e.action === "remove").length} proposed removals
      </p>
      {evidence.map((item, index) => (
        <EvidenceCard
          key={item.relationship_id || item.source_id || `new-${index}`}
          item={item}
          index={index}
        />
      ))}
      <p className="sc019-note">
        <strong>Remaining challenges:</strong>{" "}
        {challenges.length
          ? `${challenges.length} relationship${challenges.length === 1 ? " continues" : "s continue"} to challenge the proposed fact. Scientific uncertainty remains; combined approval is unavailable while material challenges remain.`
          : "No proposed relationship is labeled Challenges. This alone does not establish scientific eligibility."}{" "}
        Removed or reclassified evidence remains recorded with its reason and
        requires independent review.
      </p>
    </>
  );
}
function NewSourceIntake({
  intake,
  update,
  attach,
  cancel,
}: {
  intake: Intake;
  update: (intake: Intake) => void;
  attach: () => void;
  cancel: () => void;
}) {
  const setSource = (name: string, value: ScientificData[string]) =>
    update({ ...intake, source: { ...intake.source, [name]: value } });
  const setRelation = (name: string, value: ScientificData[string]) =>
    update({ ...intake, relation: { ...intake.relation, [name]: value } });
  const publication = intake.source.publication_date as ScientificData | null;
  return (
    <section className="package-intake" aria-label="New evidence source" data-required-text-scope>
      <h3>Newly gathered evidence</h3>
      <p>
        Record what you checked. Unknown source details remain unknown. This
        source and its relationship are proposed until review.
      </p>
      {["title", "original_url", "publisher_platform"].map((name) => (
        <label key={name}>
          {fieldLabel(name)}
          <input
            required
            value={String(intake.source[name] || "")}
            onChange={(e) => setSource(name, e.target.value)}
            maxLength={20000}
          />
        </label>
      ))}
      <StructuredField
        name="source_type"
        value={intake.source.source_type}
        onChange={(v) => setSource("source_type", v)}
      />
      <DateFields
        value={publication?.value}
        precision={String(publication?.precision || "UNKNOWN")}
        onChange={(value, precision) =>
          setSource("publication_date", { value, precision })
        }
      />
      <p className="sc019-muted">
        Publication date describes the source, not the incident date.
      </p>
      <Choice
        label="New evidence relationship"
        value={String(intake.relation.support_direction || "")}
        choices={[["", "Choose relationship…"], ...directions]}
        onChange={(v) => setRelation("support_direction", v)}
      />
      <StructuredField
        name="evidence_locator"
        completionRequired
        value={intake.relation.evidence_locator}
        onChange={(v) => setRelation("evidence_locator", v)}
      />
      <StructuredField
        name="limitations"
        completionRequired
        value={intake.relation.limitations}
        onChange={(v) => setRelation("limitations", v)}
      />
      <details>
        <summary>
          Access, directness, reporting dependencies and preservation
        </summary>
        {["retrieval_body_status", "content_preservation_status"].map(
          (name) => (
            <StructuredField
              key={name}
              name={name}
              value={intake.source[name]}
              onChange={(v) => setSource(name, v)}
            />
          ),
        )}
        {["directness", "originality", "dependency_provenance"].map((name) => (
          <StructuredField
            key={name}
            name={name}
            value={intake.relation[name]}
            onChange={(v) => setRelation(name, v)}
          />
        ))}
      </details>
      {intake.source.source_type === "social" && (
        <StructuredField
          name="social_fields"
          value={intake.source.social_fields}
          onChange={(v) => setSource("social_fields", v)}
        />
      )}
      <label>
        Reason for adding this evidence
        <textarea
          required
          maxLength={4000}
          value={intake.reason}
          onChange={(e) => update({ ...intake, reason: e.target.value })}
        />
      </label>
      <div className="sc019-actions">
        <ActionButton
          type="button"
          data-required-text-submit
          hint="Add this source and relationship to your unsent package. Inspect the package before submission."
          onClick={attach}
        >
          Attach new evidence to proposal
        </ActionButton>
        <ActionButton
          type="button"
          hint="Discard only the unfinished new-source form."
          onClick={cancel}
        >
          Cancel new source
        </ActionButton>
      </div>
    </section>
  );
}

export function FactCorrectionPackages({
  actorId,
  role,
  incidentId,
  request,
  selectedPackageId,
  returnHref,
  onSaved,
}: {
  actorId: string;
  role: "researcher" | "supervisor";
  incidentId: string;
  request?: PackageEditorRequest;
  selectedPackageId?: string;
  returnHref: string;
  onSaved?: () => void;
}) {
  const [snapshot, setSnapshot] =
    useState<FactCorrectionPackagesSnapshot | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [review, setReview] = useState<ReviewDraft | null>(null);
  const [uncertain, setUncertain] =
    useState<FactCorrectionPackageCommand | null>(null);
  const [ready, setReady] = useState(false),
    [storageOk, setStorageOk] = useState(true),
    [busy, setBusy] = useState(false),
    [conflict, setConflict] = useState(false);
  const [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [opened, setOpened] = useState<string | undefined>(selectedPackageId);
  const editorRef = useRef<HTMLElement>(null),
    inFlight = useRef(false),
    handled = useRef<number | undefined>(undefined);
  const key = `rvw:fact-package019:v1:${actorId}:${incidentId}`;
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(
        `${endpoint}?incident_id=${encodeURIComponent(incidentId)}`,
        { cache: "no-store", headers: { "x-rvw-actor": actorId }, signal },
      );
      const data = await response.json();
      if (!response.ok) throw Error(describeError(data));
      if (!signal?.aborted) setSnapshot(data);
      return data as FactCorrectionPackagesSnapshot;
    },
    [incidentId, actorId],
  );
  useEffect(() => {
    const abort = new AbortController();
    const frame = requestAnimationFrame(() => {
      refresh(abort.signal).catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
      try {
        const saved = JSON.parse(sessionStorage.getItem(key) || "null");
        if (
          saved?.actorId === actorId &&
          saved.incidentId === incidentId &&
          saved.version === 1
        ) {
          setDraft(saved.draft || null);
          setReview(saved.review || null);
          setUncertain(saved.uncertain || null);
          if (saved.draft || saved.review)
            setMessage(
              "Recovered your unfinished package in this browser tab. It has not been submitted unless the saved response is awaiting confirmation.",
            );
        }
      } catch {
        setStorageOk(false);
      }
      setReady(true);
    });
    return () => {
      abort.abort();
      cancelAnimationFrame(frame);
    };
  }, [refresh, key, actorId, incidentId]);
  useEffect(() => {
    if (!ready) return;
    let success = true;
    try {
      if (draft || review || uncertain)
        sessionStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            actorId,
            incidentId,
            draft,
            review,
            uncertain,
          }),
        );
      else sessionStorage.removeItem(key);
    } catch {
      success = false;
    }
    const frame = requestAnimationFrame(() => setStorageOk(success));
    return () => cancelAnimationFrame(frame);
  }, [ready, draft, review, uncertain, key, actorId, incidentId]);
  useEffect(() => {
    if (storageOk || (!draft && !review && !uncertain)) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [storageOk, draft, review, uncertain]);
  const begin = useCallback(
    (
      fact: CorrectionFact,
      flagId?: string,
      previous?: FactCorrectionPackage,
    ) => {
      if (!snapshot) return;
      if (uncertain) {
        setError(
          "Retry the unconfirmed submission before replacing this package.",
        );
        return;
      }
      if (
        draft &&
        !window.confirm(
          "Replace the unsent package currently in this editor? Its input will be discarded.",
        )
      )
        return;
      const blocked = restriction(fact);
      if (blocked) {
        setError(blocked);
        return;
      }
      setDraft({
        operationId: crypto.randomUUID(),
        factId: fact.id,
        incidentRevision: snapshot.revision,
        factRevision: fact.revision,
        before: clone(fact.data),
        proposed: clone(previous?.proposed || fact.data),
        evidence: previous ? clone(previous.evidence) : initialEvidence(fact),
        reason: previous?.reason || "",
        identity: "",
        stage: "edit",
        flagId,
        flagReason: "",
        previousId: previous?.id,
      });
      setConflict(false);
      setError("");
      setMessage("");
      requestAnimationFrame(() => {
        editorRef.current?.focus();
        editorRef.current?.scrollIntoView({ block: "start" });
      });
    },
    [snapshot, draft, uncertain],
  );
  useEffect(() => {
    if (!ready || !snapshot || !request || handled.current === request.nonce)
      return;
    const frame = requestAnimationFrame(() => {
      handled.current = request.nonce;
      if (draft?.factId === request.factId) {
        editorRef.current?.scrollIntoView({ block: "start" });
        return;
      }
      const fact = snapshot.facts.find((f) => f.id === request.factId);
      if (fact) begin(fact, request.flagId);
      else setError("The selected fact is not available in this case.");
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, snapshot, request, draft, begin]);
  function change(next: Draft) {
    setDraft({ ...next, operationId: crypto.randomUUID() });
    setError("");
  }
  function updateEvidence(index: number, item: PackageEvidence) {
    if (draft)
      change({
        ...draft,
        evidence: draft.evidence.map((e, i) => (i === index ? item : e)),
      });
  }
  function attachSource(source: PackageSource) {
    if (!draft) return;
    change({
      ...draft,
      evidence: [
        ...draft.evidence,
        {
          relationship_id: null,
          source_id: source.id,
          expected_relationship_revision: null,
          expected_source_revision: source.revision,
          action: "add",
          changes: {},
          reason: "",
          before: null,
          proposed: {
            support_direction: "",
            directness: null,
            originality: "unknown",
            dependency_provenance: {
              relies_on: "unknown",
              underlying: null,
              independence: null,
            },
            evidence_locator: clone(
              source.data.evidence_locator || [{ locator: "", excerpt: "" }],
            ),
            limitations: source.data.limitations || "",
          },
          source: clone(source),
        },
      ],
    });
  }
  function attachNewSource() {
    if (!draft?.intake) return;
    const { source, relation, reason } = draft.intake;
    const locators = relation.evidence_locator;
    if (
      !["title", "original_url", "publisher_platform"].every(
        (k) => typeof source[k] === "string" && String(source[k]).trim(),
      ) ||
      !directions.some(([d]) => d === relation.support_direction) ||
      !reason.trim() ||
      !String(relation.limitations || "").trim() ||
      !Array.isArray(locators) ||
      !locators.some(
        (l) =>
          l &&
          typeof l === "object" &&
          !Array.isArray(l) &&
          l.locator &&
          l.excerpt,
      )
    ) {
      setError(
        "Complete the source title, URL or identifier, publisher, relationship, exact passage, limitations and reason before attaching it.",
      );
      return;
    }
    const preservation =
      source.content_preservation_status &&
      typeof source.content_preservation_status === "object" &&
      !Array.isArray(source.content_preservation_status)
        ? source.content_preservation_status
        : {};
    const recordedPassages = Array.isArray(locators)
      ? locators.filter(
          (entry): entry is ScientificData =>
            !!entry && typeof entry === "object" && !Array.isArray(entry),
        )
      : [];
    const newSource = {
      ...source,
      content_preservation_status: {
        ...preservation,
        excerpt:
          preservation.excerpt ||
          recordedPassages
            .map((entry) => String(entry.excerpt || ""))
            .filter(Boolean)
            .join("\n\n") ||
          null,
      },
      evidence_locator: clone(relation.evidence_locator || []),
      limitations: source.limitations || relation.limitations,
    };
    change({
      ...draft,
      intake: undefined,
      evidence: [
        ...draft.evidence,
        {
          relationship_id: null,
          source_id: null,
          expected_relationship_revision: null,
          expected_source_revision: null,
          action: "add",
          changes: {},
          reason,
          new_source: newSource,
          before: null,
          proposed: clone(relation),
          source: null,
        },
      ],
    });
  }
  function validateDraft() {
    if (!draft) return false;
    if (draft.identity !== "same") {
      setError(
        "Confirm that this corrects the same underlying fact. A new proposition needs a new fact identity.",
      );
      return false;
    }
    if (!String(draft.proposed.subject || "").trim() || !draft.reason.trim()) {
      setError("Provide the proposed statement and a correction explanation.");
      return false;
    }
    if (draft.flagId && !draft.flagReason.trim()) {
      setError("Explain how this proposal follows up the linked fact flag.");
      return false;
    }
    if (draft.intake) {
      setError(
        "Attach or cancel the unfinished new-source form before previewing the package.",
      );
      return false;
    }
    if (draft.evidence.some((e) => e.action !== "retain" && !e.reason.trim())) {
      setError(
        "Explain every added, changed or removed evidence relationship, including why any conflict is being reconciled.",
      );
      return false;
    }
    if (
      draft.evidence.some(
        (e) =>
          e.action !== "remove" &&
          !directions.some(([d]) => d === e.proposed?.support_direction),
      )
    ) {
      setError(
        "Assign Supports, Challenges, Qualifies or Context to every retained or added relationship.",
      );
      return false;
    }
    if (
      !changedFields(draft.before, draft.proposed, "fact").length &&
      draft.evidence.every((e) => e.action === "retain")
    ) {
      setError(
        "The package has no proposed change. Edit the fact or its evidence relationships.",
      );
      return false;
    }
    return true;
  }
  async function submit(command: FactCorrectionPackageCommand) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "x-rvw-actor": actorId },
        body: JSON.stringify(command),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(describeError(result));
        setConflict(response.status === 409);
        if (response.status >= 500) setUncertain(command);
        return;
      }
      if (command.kind === "propose_fact_correction_package") {
        setDraft(null);
        // The action was fulfilled. Reloading this history entry should inspect
        // the saved package, rather than open another unsent correction.
        const location = new URL(window.location.href);
        if (location.searchParams.get("intent") === "amend") {
          location.searchParams.delete("intent");
          window.history.replaceState(
            window.history.state,
            "",
            location.pathname + location.search + location.hash,
          );
        }
      } else setReview(null);
      setUncertain(null);
      const otherInput =
        command.kind === "propose_fact_correction_package" ? !!review : !!draft;
      setConflict(otherInput);
      setMessage(
        command.kind === "propose_fact_correction_package"
          ? "Complete correction package submitted for independent Supervisor review. The current fact and evidence remain unchanged."
          : command.payload.decision === "accept_and_approve"
            ? "Correction accepted and a new scientific approval recorded for the exact revised fact and evidence."
            : command.payload.decision === "accept"
              ? "Correction accepted. The revised fact awaits scientific approval; previous acceptance does not apply."
              : command.payload.decision === "return"
                ? "Package returned for revision with your explanation. The current fact is unchanged."
                : "Correction rejected with your explanation. The current fact is unchanged.",
      );
      try {
        if (!otherInput) sessionStorage.removeItem(key);
      } catch {
        /* The acknowledged transaction remains successful. */
      }
      try {
        await refresh();
        onSaved?.();
      } catch {
        setError(
          "Your transaction was saved, but the latest records could not be loaded. Refresh packages to inspect the saved result.",
        );
      }
    } catch {
      setUncertain(command);
      setError(
        "The response could not be confirmed. Your exact submission is saved. Retry it to recover the existing result without creating a duplicate.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function submitProposal() {
    if (!draft || !validateDraft()) return;
    submit({
      operation_id: draft.operationId,
      incident_id: incidentId,
      expected_revision: draft.incidentRevision,
      kind: "propose_fact_correction_package",
      payload: {
        fact_id: draft.factId,
        expected_fact_revision: draft.factRevision,
        changes: Object.fromEntries(
          changedFields(draft.before, draft.proposed, "fact").map((k) => [
            k,
            draft.proposed[k] ?? null,
          ]),
        ),
        reason: draft.reason.trim(),
        same_fact_attestation: true,
        evidence: draft.evidence.map(evidenceInput),
        ...(draft.previousId
          ? { previous_correction_id: draft.previousId }
          : {}),
        ...(draft.flagId
          ? { flag_id: draft.flagId, flag_link_reason: draft.flagReason.trim() }
          : {}),
      },
    });
  }
  function startReview(item: FactCorrectionPackage, decision: PackageDecision) {
    if (!snapshot || uncertain) return;
    if (
      review &&
      !window.confirm("Replace the unsent review currently in the editor?")
    )
      return;
    setReview({
      operationId: crypto.randomUUID(),
      packageId: item.id,
      incidentRevision: snapshot.revision,
      decision,
      reason: "",
      basis: "",
      evidenceIndices: [],
      attestation: false,
      confirmed: false,
    });
    setOpened(item.id);
    setError("");
    setConflict(false);
  }
  function submitReview() {
    if (
      !review ||
      !review.reason.trim() ||
      !review.confirmed ||
      (review.decision === "accept_and_approve" &&
        (!review.attestation || !review.basis.trim() || !review.evidenceIndices?.length))
    ) {
      setError(
        "Explain and confirm the review. Combined approval also requires explicitly selected supporting evidence, your scientific rationale and your attestation.",
      );
      return;
    }
    submit({
      operation_id: review.operationId,
      incident_id: incidentId,
      expected_revision: review.incidentRevision,
      kind: "review_fact_correction_package",
      payload: {
        correction_id: review.packageId,
        decision: review.decision,
        reason: review.reason.trim(),
        ...(review.decision === "accept_and_approve"
          ? {
              approval: {
                attestation: true,
                review_basis: review.basis.trim(),
                evidence_indices: review.evidenceIndices,
              },
            }
          : {}),
      },
    });
  }
  async function loadLatest() {
    if (busy || inFlight.current) return;
    setBusy(true);
    setMessage(
      "Loading latest records. Your unsent input is preserved while the comparison is refreshed.",
    );
    try {
      await refresh();
      setConflict(!!draft || !!review);
      setMessage(
        "Latest records loaded. Your unsent input remains separate. Compare the latest fact and evidence before explicitly updating your proposal or review baseline.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function rebaseDraft() {
    if (!draft || !snapshot) return;
    const fact = snapshot.facts.find((f) => f.id === draft.factId);
    if (!fact || restriction(fact)) {
      setError(fact ? restriction(fact) : "This fact is no longer available.");
      return;
    }
    const current = initialEvidence(fact);
    const editedMissing = draft.evidence.filter(
      (e) =>
        e.relationship_id &&
        e.action !== "retain" &&
        !current.some((c) => c.relationship_id === e.relationship_id),
    );
    if (editedMissing.length) {
      setError(
        "An evidence relationship you edited is no longer current. Your input is retained; reconcile that relationship before beginning a replacement proposal.",
      );
      return;
    }
    const evidence = current.map((c) => {
      const old = draft.evidence.find(
        (e) => e.relationship_id === c.relationship_id,
      );
      return old && old.action !== "retain"
        ? {
            ...old,
            before: c.before,
            source: c.source,
            expected_relationship_revision: c.expected_relationship_revision,
            expected_source_revision: c.expected_source_revision,
          }
        : c;
    });
    for (const added of draft.evidence.filter((e) => e.action === "add")) {
      const source = snapshot.source_catalog.find(
        (s) => s.id === added.source_id,
      );
      evidence.push(
        source
          ? { ...added, source, expected_source_revision: source.revision }
          : added,
      );
    }
    change({
      ...draft,
      before: clone(fact.data),
      incidentRevision: snapshot.revision,
      factRevision: fact.revision,
      evidence,
      identity: "",
      stage: "edit",
    });
    setConflict(false);
    setMessage(
      "Latest baseline selected. Your wording and reasoned evidence edits remain. Recheck the complete package and confirm the same fact identity before submitting.",
    );
  }
  const chosenReview = review
    ? snapshot?.packages.find((p) => p.id === review.packageId)
    : null;
  return (
    <section
      id="fact-correction-packages"
      className="fact-packages"
      aria-label="Fact correction packages"
      data-package-ready={ready && !!snapshot}
    >
      <div className="sc019-section-head">
        <div>
          <p className="sc019-eyebrow">Independent scientific review</p>
          <h2>Fact correction packages</h2>
        </div>
        <ActionButton
          type="button"
          hint="Reload available packages and current records while keeping unsent input."
          onClick={loadLatest}
          disabled={busy}
        >
          Refresh packages
        </ActionButton>
      </div>
      <p>
        Researchers and Supervisors may propose a correction with its complete
        evidence package. A different authorized Supervisor decides whether to
        adopt it and whether to approve the revised fact.
      </p>
      {error && (
        <p className="sc019-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="sc019-note" role="status">
          {message}
        </p>
      )}
      {!snapshot && !error && <p role="status">Loading correction packages…</p>}
      {snapshot && !snapshot.writes_enabled && (
        <p className="sc019-note">
          Correction writes are paused. You can inspect records and preserve
          draft input.
        </p>
      )}
      {(draft || review) && (
        <p className="sc019-save">
          {storageOk
            ? "Unsent input is saved in this browser tab for your account and this case."
            : "Browser recovery is unavailable. Preserve your input before closing or refreshing."}
        </p>
      )}
      {uncertain && (
        <div className="sc019-note">
          <p>Editing is held until this exact submission is confirmed.</p>
          <ActionButton
            type="button"
            hint="Retry the identical operation. The server returns its recorded result if it already succeeded."
            disabled={busy}
            onClick={() => submit(uncertain)}
          >
            Retry unconfirmed submission
          </ActionButton>
        </div>
      )}
      <section
        ref={editorRef}
        tabIndex={-1}
        className={draft ? "sc019-editor package-editor" : undefined}
        aria-label="Fact correction package editor"
      >
        {draft && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (validateDraft()) {
                change({ ...draft, stage: "preview" });
                editorRef.current?.scrollIntoView({ block: "start" });
              }
            }}
          >
            <fieldset
              disabled={busy || !!uncertain}
              className="sc019-form-fields"
            >
              <h2>Propose Fact Correction</h2>
              {draft.stage === "edit" ? (
                <>
                  <div className="package-edit-columns">
                    <section>
                      <h3>Original fact</h3>
                      <p>
                        <strong>{valueLabel(draft.before.subject)}</strong>
                      </p>
                      <dl>
                        {correctionFields.fact
                          .filter(
                            (k) => k !== "subject" && draft.before[k] != null,
                          )
                          .map((k) => (
                            <div key={k}>
                              <dt>{fieldLabel(k)}</dt>
                              <dd>{valueLabel(draft.before[k])}</dd>
                            </div>
                          ))}
                      </dl>
                      <p>
                        <strong>Original review state:</strong>{" "}
                        {valueLabel(
                          draft.before.lab_review_state ||
                            draft.before.validation_state,
                        )}
                      </p>
                      <p>
                        Fact identity: {draft.factId} · revision{" "}
                        {draft.factRevision}
                      </p>
                    </section>
                    <section>
                      <h3>Proposed fact</h3>
                      <ProposalFields
                        draft={{ target: "fact", proposed: draft.proposed }}
                        update={(data) => change({ ...draft, proposed: data })}
                      />
                    </section>
                  </div>
                  <Choice
                    label="Does this correct the same underlying fact?"
                    value={draft.identity}
                    choices={[
                      ["", "Choose after comparing the propositions…"],
                      ["same", "Yes — the same underlying fact, corrected"],
                      ["new", "No — a new factual proposition"],
                    ]}
                    onChange={(v) =>
                      change({ ...draft, identity: v as Draft["identity"] })
                    }
                  />
                  {draft.identity === "new" && (
                    <p className="sc019-note">
                      A different proposition needs its own identity. Your
                      unsent correction stays saved here.{" "}
                      <a href={returnHref}>
                        Return to the case and use Add new fact
                      </a>
                      .
                    </p>
                  )}
                  <h3>Evidence for the corrected proposition</h3>
                  <p>
                    Open a card to inspect its citation and provenance. Choose a
                    relationship explicitly. Removing or changing a challenging
                    source requires a scientific explanation; it does not
                    silently resolve the conflict.
                  </p>
                  {draft.evidence.map((item, index) => (
                    <EvidenceCard
                      key={
                        item.relationship_id || item.source_id || `new-${index}`
                      }
                      item={item}
                      index={index}
                      update={(v) => updateEvidence(index, v)}
                      discard={() =>
                        change({
                          ...draft,
                          evidence: draft.evidence.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                    />
                  ))}
                  {!draft.evidence.length && (
                    <p>
                      No evidence is currently attached. The Supervisor must
                      assess evidentiary adequacy.
                    </p>
                  )}
                  <details className="package-source-picker">
                    <summary>Attach an existing source</summary>
                    <p>
                      Reuse a recorded source and describe its relationship to
                      this fact. Shared source details remain unchanged.
                    </p>
                    {snapshot?.source_catalog
                      .filter(
                        (s) =>
                          !draft.evidence.some((e) => e.source_id === s.id),
                      )
                      .map((source) => (
                        <article
                          className="package-source-choice"
                          key={source.id}
                        >
                          <Citation data={source.data} />
                          <ActionButton
                            type="button"
                            hint="Attach this existing source to the proposed fact, then choose its relationship and explain the addition."
                            onClick={() => attachSource(source)}
                          >
                            Attach {valueLabel(source.data.title)}
                          </ActionButton>
                        </article>
                      ))}
                  </details>
                  {draft.intake ? (
                    <NewSourceIntake
                      intake={draft.intake}
                      update={(intake) => change({ ...draft, intake })}
                      attach={attachNewSource}
                      cancel={() => {
                        if (
                          window.confirm(
                            "Discard the unfinished new-source form?",
                          )
                        )
                          change({ ...draft, intake: undefined });
                      }}
                    />
                  ) : (
                    <ActionButton
                      type="button"
                      hint="Prepare a source using the recorded intake fields. It remains unsent until the full package is reviewed."
                      onClick={() =>
                        change({
                          ...draft,
                          intake: {
                            source: {
                              title: "",
                              original_url: "",
                              publisher_platform: "",
                              source_type: "news",
                              publication_date: {
                                value: null,
                                precision: "UNKNOWN",
                              },
                              retrieval_body_status: "UNKNOWN",
                              content_preservation_status: {
                                excerpt: null,
                                preservation: null,
                                completeness: "unknown",
                              },
                              social_fields: null,
                            },
                            relation: {
                              support_direction: "",
                              directness: null,
                              originality: "unknown",
                              dependency_provenance: {
                                relies_on: "unknown",
                                underlying: null,
                                independence: null,
                              },
                              evidence_locator: [{ locator: "", excerpt: "" }],
                              limitations: "",
                            },
                            reason: "",
                          },
                        })
                      }
                    >
                      Add newly gathered evidence
                    </ActionButton>
                  )}
                  <label>
                    Correction explanation
                    <textarea
                      required
                      maxLength={4000}
                      value={draft.reason}
                      onChange={(e) =>
                        change({ ...draft, reason: e.target.value })
                      }
                      placeholder="Explain the factual correction, the evidence supporting it, and any remaining uncertainty or reconciled conflict."
                    />
                  </label>
                  {draft.flagId && (
                    <>
                      <p>
                        Linked fact flag: {draft.flagId}. Linking documents
                        follow-up; it does not claim that the correction was
                        accepted.
                      </p>
                      <label>
                        Why this proposal follows up the flag
                        <textarea
                          required
                          maxLength={4000}
                          value={draft.flagReason}
                          onChange={(e) =>
                            change({ ...draft, flagReason: e.target.value })
                          }
                        />
                      </label>
                    </>
                  )}
                  <div className="sc019-actions">
                    <ActionButton
                      type="submit"
                      className="primary"
                      hint="Compare the entire original and proposed package before submitting it."
                      disabled={draft.identity === "new"}
                    >
                      Preview correction package
                    </ActionButton>
                  </div>
                </>
              ) : (
                <>
                  <h3>Review the complete proposed package</h3>
                  <PackageComparison
                    before={draft.before}
                    proposed={draft.proposed}
                    evidence={draft.evidence}
                    reason={draft.reason}
                  />
                  <p>
                    Same underlying fact confirmed. The current fact stays
                    unchanged until an independent Supervisor accepts this
                    package. Scientific approval is a separate, explicit
                    decision.
                  </p>
                  <div className="sc019-actions">
                    <ActionButton
                      type="button"
                      hint="Return to the editor with your wording and evidence choices preserved."
                      onClick={() => change({ ...draft, stage: "edit" })}
                    >
                      Back to package editor
                    </ActionButton>
                    <ActionButton
                      type="button"
                      className="primary"
                      hint="Submit the complete package for a different authorized Supervisor to review. No current fact or evidence changes yet."
                      disabled={!snapshot?.writes_enabled || conflict}
                      onClick={submitProposal}
                    >
                      Submit for Supervisor Review
                    </ActionButton>
                  </div>
                </>
              )}
              {conflict && (
                <div className="sc019-note">
                  <h3>Compare with the latest record</h3>
                  {snapshot?.facts.find((f) => f.id === draft.factId) && (
                    <FactComparison
                      before={draft.before}
                      proposed={
                        snapshot.facts.find((f) => f.id === draft.factId)!.data
                      }
                    />
                  )}
                  <p>
                    Your unsent wording and evidence changes are preserved.
                    Refresh first, inspect current evidence in the case, then
                    deliberately update the baseline.
                  </p>
                  <ActionButton
                    type="button"
                    hint="Load the latest current fact and evidence without overwriting unsent input."
                    onClick={loadLatest}
                  >
                    Load latest records
                  </ActionButton>
                  <ActionButton
                    type="button"
                    hint="Keep your proposed wording and reasoned edits, use current record revisions, and require a new full preview."
                    onClick={rebaseDraft}
                  >
                    Use latest baseline and keep my edits
                  </ActionButton>
                </div>
              )}
              <div className="sc019-actions">
                <ActionButton
                  type="button"
                  hint="Permanently discard this unsent package from this browser tab; submitted records are unaffected."
                  onClick={() => {
                    if (
                      window.confirm(
                        "Discard this unsent fact correction package?",
                      )
                    ) {
                      setDraft(null);
                      setConflict(false);
                    }
                  }}
                >
                  Discard unsent package
                </ActionButton>
              </div>
            </fieldset>
          </form>
        )}
      </section>
      <div className="package-list">
        <h3>Submitted packages and decisions</h3>
        {snapshot?.packages.length === 0 && (
          <p>No fact correction packages have been submitted for this case.</p>
        )}
        {snapshot?.packages.map((item) => (
          <article
            className="sc019-card package-record"
            key={item.id}
            id={`package-${item.id}`}
          >
            <div className="sc019-card-head">
              <div>
                <span className="sc019-badge">
                  {item.status === "pending"
                    ? "Pending independent review"
                    : item.status === "returned"
                      ? "Returned for revision"
                      : item.status === "accepted" && item.scientific_approval
                        ? "Accepted with new scientific approval"
                        : item.status === "accepted"
                          ? "Correction accepted · scientific review pending"
                          : "Correction rejected"}
                </span>
                <h3>{valueLabel(item.proposed.subject)}</h3>
                <p>Original: {valueLabel(item.before.subject)}</p>
                <p className="sc019-meta">
                  Proposed by {item.proposed_by_name || item.proposed_by} ·{" "}
                  {item.created_at} · {item.incident_label}
                </p>
              </div>
              <ActionButton
                type="button"
                hint="Inspect the original fact, entire proposed evidence package, eligibility and immutable review history."
                aria-expanded={opened === item.id}
                onClick={() =>
                  setOpened(opened === item.id ? undefined : item.id)
                }
              >
                {opened === item.id
                  ? "Close package inspection"
                  : "Inspect complete package"}
              </ActionButton>
            </div>
            {opened === item.id && (
              <>
                <PackageComparison
                  before={item.before}
                  proposed={item.proposed}
                  evidence={item.evidence}
                  reason={item.reason}
                />
                <details>
                  <summary>
                    Previous acceptance, locks, dependencies and consequences
                  </summary>
                  <dl>
                    {Object.entries(item.before_context || {}).map(([k, v]) => (
                      <div key={k}>
                        <dt>{fieldLabel(k)}</dt>
                        <dd>{valueLabel(v)}</dd>
                      </div>
                    ))}
                  </dl>
                  <p>
                    Acceptance creates a new fact version and current
                    relationships. Earlier scientific approval does not
                    transfer. Relevant completion, dependency and output
                    decisions may require renewed review.
                  </p>
                  <p>
                    Current restriction:{" "}
                    {snapshot.facts.find((f) => f.id === item.fact_id)
                      ? restriction(
                          snapshot.facts.find((f) => f.id === item.fact_id)!,
                        ) || "No current correction restriction reported"
                      : "Fact unavailable"}
                  </p>
                </details>
                {item.flag_id && (
                  <p>
                    Linked flag: {item.flag_id} · {item.flag_link_reason}
                  </p>
                )}
                {item.previous_correction_id && (
                  <p>Revision of package {item.previous_correction_id}</p>
                )}
                <section className="package-eligibility">
                  <h4>Scientific approval requirements</h4>
                  {item.approval_eligibility.eligible ? (
                    <p>
                      Automated eligibility checks currently permit an explicit
                      scientific review. The evidence and scientific judgment
                      remain the reviewer’s responsibility.
                    </p>
                  ) : (
                    <>
                      <p>Combined approval is currently unavailable:</p>
                      <ul>
                        {item.approval_eligibility.reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  <p>
                    Source count alone does not prove a fact. Unknown values and
                    explicit negative observations retain their meaning.
                  </p>
                </section>
                {item.status === "pending" &&
                  role === "supervisor" &&
                  (item.proposed_by === actorId ? (
                    <p className="sc019-note">
                      You proposed this package. A different authorized
                      Supervisor must review it.
                    </p>
                  ) : (
                    <div
                      className="package-decisions"
                      aria-label="Independent review decisions"
                    >
                      {(Object.keys(decisionLabels) as PackageDecision[]).map(
                        (decision) => (
                          <div key={decision}>
                            <ActionButton
                              type="button"
                              hint={decisionHints[decision]}
                              disabled={
                                busy ||
                                !!uncertain ||
                                !snapshot.writes_enabled ||
                                (decision === "accept_and_approve" &&
                                  !item.approval_eligibility.eligible)
                              }
                              onClick={() => startReview(item, decision)}
                            >
                              {decisionLabels[decision]}
                            </ActionButton>
                            <p>{decisionHints[decision]}</p>
                          </div>
                        ),
                      )}
                    </div>
                  ))}
                {review?.packageId === item.id && (
                  <form
                    className="package-review-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      submitReview();
                    }}
                  >
                    <fieldset disabled={busy || !!uncertain}>
                      <legend>{decisionLabels[review.decision]}</legend>
                      <p>{decisionHints[review.decision]}</p>
                      <label>
                        Review decision explanation
                        <textarea
                          required
                          maxLength={4000}
                          value={review.reason}
                          onChange={(e) =>
                            setReview({
                              ...review,
                              operationId: crypto.randomUUID(),
                              reason: e.target.value,
                            })
                          }
                        />
                      </label>
                      {review.decision === "accept_and_approve" && (
                        <>
                          <fieldset>
                            <legend>Evidence for approval</legend>
                            <p>Choose the proposed supporting relationships you relied on. Passages, directions and limitations appear in the complete package above.</p>
                            {item.evidence.map((evidence, index) => {
                              if (evidence.action === "remove" || evidence.proposed?.support_direction !== "SUPPORTS") return null;
                              const source = evidence.source?.data || evidence.new_source;
                              const selected = review.evidenceIndices || [];
                              return (
                                <label className="approval-evidence-choice" key={index}>
                                  <input
                                    type="checkbox"
                                    checked={selected.includes(index)}
                                    onChange={(event) => setReview({
                                      ...review,
                                      operationId: crypto.randomUUID(),
                                      evidenceIndices: event.target.checked
                                        ? [...selected, index]
                                        : selected.filter((choice) => choice !== index),
                                    })}
                                  />
                                  Rely on {valueLabel(source?.title || evidence.source_id)} · {evidence.relationship_id || `new relationship ${index + 1}`}
                                </label>
                              );
                            })}
                          </fieldset>
                          <label>
                            Scientific review basis
                            <textarea
                              required
                              maxLength={4000}
                              value={review.basis}
                              onChange={(e) =>
                                setReview({
                                  ...review,
                                  operationId: crypto.randomUUID(),
                                  basis: e.target.value,
                                })
                              }
                              placeholder="Explain evidence adequacy, provenance and independence, reconciliation of challenges, remaining limitations, unknown or negative observations, and any causal or dependency review."
                            />
                          </label>
                          <label className="package-check">
                            <input
                              type="checkbox"
                              checked={review.attestation}
                              onChange={(e) =>
                                setReview({
                                  ...review,
                                  operationId: crypto.randomUUID(),
                                  attestation: e.target.checked,
                                })
                              }
                            />
                            I independently reviewed this exact fact and
                            evidence package, its provenance, challenges,
                            dependencies and limitations, and judge it eligible
                            for scientific acceptance.
                          </label>
                        </>
                      )}
                      <label className="package-check">
                        <input
                          type="checkbox"
                          checked={review.confirmed}
                          onChange={(e) =>
                            setReview({
                              ...review,
                              operationId: crypto.randomUUID(),
                              confirmed: e.target.checked,
                            })
                          }
                        />
                        I inspected the original and proposed statement, all
                        evidence changes, recorded reasons and downstream
                        consequences.
                      </label>
                      {conflict && (
                        <>
                          <p>
                            The case changed. Reload and inspect the current
                            package before updating this review.
                          </p>
                          <ActionButton
                            type="button"
                            hint="Use the loaded current case revision only after re-inspecting the proposal; confirmations are cleared."
                            onClick={() => {
                              setReview({
                                ...review,
                                operationId: crypto.randomUUID(),
                                incidentRevision: snapshot.revision,
                                confirmed: false,
                                attestation: false,
                                evidenceIndices: [],
                              });
                              setConflict(false);
                            }}
                          >
                            I have inspected the refreshed package
                          </ActionButton>
                        </>
                      )}
                      <div className="sc019-actions">
                        <ActionButton
                          type="submit"
                          hint="Record the explained review decision atomically, subject to current authority, revision and scientific checks."
                          disabled={
                            conflict ||
                            !review.confirmed ||
                            (review.decision === "accept_and_approve" &&
                              (!review.attestation ||
                                !review.evidenceIndices?.length ||
                                !chosenReview?.approval_eligibility.eligible))
                          }
                        >
                          Confirm {decisionLabels[review.decision]}
                        </ActionButton>
                        <ActionButton
                          type="button"
                          hint="Discard this unsent review explanation."
                          onClick={() => setReview(null)}
                        >
                          Cancel review
                        </ActionButton>
                      </div>
                    </fieldset>
                  </form>
                )}
                {item.review_reason && (
                  <div className="sc019-note">
                    <p>
                      <strong>
                        {item.decision
                          ? decisionLabels[item.decision]
                          : "Review decision"}
                      </strong>{" "}
                      · {item.reviewed_by_name || item.reviewed_by} ·{" "}
                      {item.reviewed_at}
                    </p>
                    <p>{item.review_reason}</p>
                    {item.scientific_approval && (
                      <>
                        <p>
                          Independent scientific approval was recorded for this
                          corrected fact and the exact evidence versions
                          reviewed. Earlier versions remain in history.
                        </p>
                        {Array.isArray(item.scientific_approval.approval_basis) ? (
                          <section data-approval-basis>
                            <h4>Evidence selected for approval</h4>
                            <ul>
                              {item.scientific_approval.approval_basis.map((evidence) => (
                                <li key={evidence.id}>
                                  {valueLabel(evidence.data?.citation_override?.title || evidence.source?.data?.title || evidence.source?.id)}
                                  {" · source "}{evidence.source?.id}{" rev "}{evidence.source?.revision}
                                  {" · relationship "}{evidence.id}{" rev "}{evidence.revision}
                                </li>
                              ))}
                            </ul>
                          </section>
                        ) : (
                          <p>Earlier approval. An explicit evidence selection was not recorded.</p>
                        )}
                        <details>
                          <summary>
                            Inspect the fact and complete associated evidence at approval
                          </summary>
                          <dl>
                            {Object.entries(item.scientific_approval).filter(([name]) => name !== "approval_basis").map(
                              ([name, value]) => (
                                <div key={name}>
                                  <dt>{fieldLabel(name)}</dt>
                                  <dd>{valueLabel(value)}</dd>
                                </div>
                              ),
                            )}
                          </dl>
                        </details>
                      </>
                    )}
                  </div>
                )}
                {item.status === "returned" && item.proposed_by === actorId && (
                  <ActionButton
                    type="button"
                    hint="Prepare a linked replacement package; the returned package remains immutable. Recheck the current baseline and all evidence."
                    disabled={busy || !!uncertain}
                    onClick={() => {
                      const fact = snapshot.facts.find(
                        (f) => f.id === item.fact_id,
                      );
                      if (fact) begin(fact, item.flag_id || undefined, item);
                    }}
                  >
                    Revise returned package
                  </ActionButton>
                )}
                <details>
                  <summary>Immutable package and review history</summary>
                  {item.history.length ? (
                    item.history.map((event, i) => (
                      <dl key={i}>
                        {Object.entries(event).map(([k, v]) => (
                          <div key={k}>
                            <dt>{fieldLabel(k)}</dt>
                            <dd>{valueLabel(v)}</dd>
                          </div>
                        ))}
                      </dl>
                    ))
                  ) : (
                    <p>
                      The submitted original, proposed values, relationships and
                      reasons above form this package’s recorded history.
                    </p>
                  )}
                </details>
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
