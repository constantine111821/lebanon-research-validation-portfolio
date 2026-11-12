"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  fmt,
  label,
  type DraftPayload,
  type PrivateDraft,
  type Snapshot,
} from "@rvw/domain";
import {
  booleanValue,
  draftIsSupported,
  emptyDraft,
  setDraftChange,
} from "@rvw/domain/drafts";

export function DraftEditor({
  snapshot,
  incidentId,
  initialDraft,
}: {
  snapshot: Snapshot;
  incidentId: string;
  initialDraft?: PrivateDraft;
}) {
  const router = useRouter();
  const [payload, setPayload] = useState<DraftPayload>(
    initialDraft?.payload || emptyDraft(snapshot, incidentId),
  );
  const [draftId, setDraftId] = useState<string | null>(
    initialDraft?.id || null,
  );
  const [revision, setRevision] = useState(initialDraft?.revision || 0);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [conflict, setConflict] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false);
  const [dirty, setDirty] = useState(false),
    [mode, setMode] = useState<"review" | "new_fact">("review");
  const facts = snapshot.records.CLAIM.filter(
    (c) =>
      c.incident_id === incidentId &&
      c.value_type === "BOOLEAN" &&
      c.claim_family !== "ATTACK_TO_EFFECT_CAUSATION" &&
      c.is_current !== false,
  );
  const [selected, setSelected] = useState(facts[0]?.claim_id || "");
  const [choice, setChoice] = useState("unknown"),
    [reviewState, setReviewState] = useState("NEEDS_MORE_EVIDENCE");
  const [notes, setNotes] = useState(""),
    [attested, setAttested] = useState(false);
  const [subject, setSubject] = useState(""),
    [distinct, setDistinct] = useState(""),
    [family, setFamily] = useState("KINETIC_EVENT");
  const supported = draftIsSupported(payload);
  function stage(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (mode === "review" && !selected) {
      setError("Choose a factual question.");
      return;
    }
    if (mode === "new_fact" && (!subject.trim() || !distinct.trim())) {
      setError(
        "Describe the factual question and how it differs from existing facts.",
      );
      return;
    }
    const value = booleanValue(choice);
    const change =
      mode === "review"
        ? {
            type: "review",
            claim_id: selected,
            value,
            value_type: "BOOLEAN",
            validation_state: reviewState,
            date_precision: "UNKNOWN",
            quantitative_unit: null,
            impact_basis: null,
            review_notes: notes,
            basis_explanation: null,
            attestation: attested,
          }
        : {
            type: "new_fact",
            claim: {
              claim_id: `C-${crypto.randomUUID()}`,
              claim_family: family,
              subject: subject.trim(),
              value_type: "BOOLEAN",
              proposed_value: value,
              current_verified_value: null,
              ai_original_value: null,
              date_precision: "UNKNOWN",
              quantitative_unit: null,
              impact_basis: null,
              validation_state: "NOT_REVIEWED",
              source_described_type: null,
            },
            distinct_reason: distinct.trim(),
            evidence: [],
          };
    setPayload(setDraftChange(payload, change));
    setDirty(true);
    setNotice(
      "Change added to your review list. Save the private draft to keep it.",
    );
  }
  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    const id = draftId || crypto.randomUUID();
    setDraftId(id);
    try {
      const response = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, expected_revision: revision, payload }),
      });
      if (response.status === 409) {
        setConflict(true);
        setError(
          "This private draft changed elsewhere. Your unsaved changes are still here. Reload the saved draft before saving again.",
        );
        return;
      }
      if (response.status === 401 || response.status === 403) {
        setError(
          "Workspace access is no longer available. Your unsaved changes are still here; sign in again before saving.",
        );
        return;
      }
      if (!response.ok) {
        setError(
          "The private draft could not be saved. Your changes are still here.",
        );
        return;
      }
      const saved: PrivateDraft = await response.json();
      setRevision(saved.revision);
      setPayload(saved.payload);
      setDirty(false);
      setConflict(false);
      setNotice(
        `Private draft saved · revision ${saved.revision}. Shared facts are unchanged.`,
      );
      router.refresh();
    } catch {
      setError(
        "The connection was interrupted. Your changes are still here. Check the saved draft before trying again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    if (!draftId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/drafts", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const rows: PrivateDraft[] = await response.json();
      const saved = rows.find((d) => d.id === draftId);
      if (!saved) {
        setError(
          "This saved draft no longer exists. Your unsaved changes remain here. Open a new case draft to save a separate copy.",
        );
        return;
      }
      if (!draftIsSupported(saved.payload)) {
        setError(
          "This draft now contains a workflow not supported by this editor. It has been preserved.",
        );
        return;
      }
      setPayload(saved.payload);
      setRevision(saved.revision);
      setDirty(false);
      setConflict(false);
      setNotice(`Saved draft reloaded · revision ${saved.revision}.`);
    } catch {
      setError(
        "The saved draft could not be loaded. Your changes are still here.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!draftId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/drafts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draftId, expected_revision: revision }),
      });
      if (response.status === 409) {
        setConflict(true);
        setError(
          "The draft changed or was deleted elsewhere. Reload before deleting; no draft was deleted by this request.",
        );
        return;
      }
      if (!response.ok) throw new Error();
      setDraftId(null);
      setRevision(0);
      setPayload(emptyDraft(snapshot, incidentId));
      setDirty(false);
      setConflict(false);
      setNotice("Private draft deleted. Shared facts are unchanged.");
      router.replace(`/cases/${encodeURIComponent(incidentId)}`);
      router.refresh();
    } catch {
      setError(
        "Deletion could not be confirmed. Check the saved draft before trying again.",
      );
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }
  return (
    <section id="private-draft" className="draft-editor panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">03 / ADD OR CORRECT INFORMATION</span>
          <h2>Your private draft</h2>
        </div>
        <span className="badge teal">
          Only you · {revision ? `revision ${revision}` : "not saved yet"}
        </span>
      </div>
      <p>
        Prepare changes, review the exact values, then save for yourself. This
        does not change shared research or submit to Team Review.
      </p>
      <p className="small muted">
        This editor supports Boolean fact corrections and new attack, damage or
        closure questions. Other fact types remain visible with their full
        evidence.
      </p>
      {!supported ? (
        <p role="alert">
          This preserved draft uses a workflow not yet supported by this editor.
        </p>
      ) : (
        <>
          <div className="segmented" aria-label="Draft action">
            <button
              type="button"
              aria-pressed={mode === "review"}
              onClick={() => setMode("review")}
            >
              Correct an existing fact
            </button>
            <button
              type="button"
              aria-pressed={mode === "new_fact"}
              onClick={() => setMode("new_fact")}
            >
              Add fact
            </button>
          </div>
          <form className="draft-form" onSubmit={stage}>
            {mode === "review" ? (
              <>
                <label>
                  Fact to review
                  <select
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    {facts.map((c) => (
                      <option value={c.claim_id} key={c.claim_id}>
                        {c.subject}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="small">
                  <a href={`#fact-${selected}`}>
                    Read this fact and its sources ↑
                  </a>
                </p>
              </>
            ) : (
              <>
                <label>
                  Type of fact
                  <select
                    value={family}
                    onChange={(e) => setFamily(e.target.value)}
                  >
                    <option value="KINETIC_EVENT">Attack occurrence</option>
                    <option value="PHYSICAL_DAMAGE">Physical damage</option>
                    <option value="FULL_CLOSURE">Full closure</option>
                  </select>
                </label>
                <label>
                  Factual question
                  <textarea
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    maxLength={2000}
                    required
                  />
                </label>
                <label>
                  How is this different from the existing facts?
                  <textarea
                    value={distinct}
                    onChange={(e) => setDistinct(e.target.value)}
                    maxLength={6000}
                    required
                  />
                </label>
                <p className="callout">
                  Initial entry · Needs evidence and lab validation. An initial
                  value is not a verified finding.
                </p>
              </>
            )}
            <div className="two-columns">
              <label>
                {mode === "review"
                  ? "Draft factual value"
                  : "Initial value — optional"}
                <select
                  value={choice}
                  onChange={(e) => setChoice(e.target.value)}
                >
                  <option value="unknown">Unknown / not established</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              {mode === "review" && (
                <label>
                  Draft review result
                  <select
                    value={reviewState}
                    onChange={(e) => setReviewState(e.target.value)}
                  >
                    {[
                      "NEEDS_MORE_EVIDENCE",
                      "SUPPORTED",
                      "NOT_SUPPORTED",
                      "CONFLICTING",
                      "NOT_APPLICABLE",
                    ].map((v) => (
                      <option key={v} value={v}>
                        {label(v)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <p className="small">
              Unknown means the evidence does not answer the question. It must
              not be converted into No.
            </p>
            {mode === "review" && (
              <>
                <label>
                  Review notes
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    maxLength={6000}
                  />
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={attested}
                    onChange={(e) => setAttested(e.target.checked)}
                  />{" "}
                  I checked this fact against the evidence. Leave unchecked
                  while this work is unfinished.
                </label>
              </>
            )}
            <button type="submit">Review change</button>
          </form>
          <div className="draft-review">
            <span className="eyebrow">04 / REVIEW BEFORE SAVING</span>
            <h3>
              Changes in this draft{" "}
              <span className="count">{payload.changes.length}</span>
            </h3>
            {payload.changes.length === 0 ? (
              <p className="muted">No changes added yet.</p>
            ) : (
              payload.changes.map((change, index) => (
                <article
                  className="pending-change"
                  key={change.claim_id || change.claim.claim_id}
                >
                  <div>
                    <strong>
                      {change.type === "review"
                        ? "Fact correction"
                        : "New fact"}{" "}
                      ·{" "}
                      {change.type === "review"
                        ? snapshot.records.CLAIM.find(
                            (c) => c.claim_id === change.claim_id,
                          )?.subject
                        : change.claim.subject}
                    </strong>
                    <p data-testid="draft-value">
                      {fmt(
                        change.type === "review"
                          ? change.value
                          : change.claim.proposed_value,
                      )}{" "}
                      ·{" "}
                      {label(
                        change.type === "review"
                          ? change.validation_state
                          : "NOT_REVIEWED",
                      )}
                    </p>
                    <p className="small">
                      {change.review_notes ||
                        change.distinct_reason ||
                        "Notes not yet recorded"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="quiet"
                    aria-label={`Remove change ${index + 1}`}
                    onClick={() => {
                      setPayload({
                        ...payload,
                        changes: payload.changes.filter((_, n) => n !== index),
                      });
                      setDirty(true);
                    }}
                  >
                    Remove
                  </button>
                </article>
              ))
            )}
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="success" role="status">
              {notice}
            </p>
          )}
          <div className="draft-actions">
            <button
              className="primary"
              disabled={busy || conflict}
              onClick={save}
            >
              {busy ? "Working…" : "Save private draft"}
            </button>
            {draftId && (
              <button disabled={busy} onClick={reload}>
                Reload saved draft
              </button>
            )}
            {revision > 0 && (
              <button
                className="danger quiet"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                Delete draft
              </button>
            )}
            <span className="small muted">
              {dirty
                ? "Unsaved changes in review list"
                : revision
                  ? "Saved draft loaded"
                  : "Not saved yet"}
            </span>
          </div>
          {dirty && revision > 0 && (
            <p className="small muted">
              Reloading replaces the review list with your saved version.
            </p>
          )}
          {confirmDelete && (
            <div className="delete-confirm" role="alert">
              <p>
                Delete this private draft? Shared facts and research history
                will remain unchanged.
              </p>
              <button className="danger" onClick={remove} disabled={busy}>
                Confirm delete
              </button>{" "}
              <button onClick={() => setConfirmDelete(false)}>
                Keep draft
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
