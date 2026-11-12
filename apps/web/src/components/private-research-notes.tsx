"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { PrivateNote, PrivateNotePayload } from "@/lib/private-note-input";

const endpoint = "/api/private-notes";
const messages: Record<string, string> = {
  PRIVATE_NOTE_CONFLICT: "This note changed in another tab or was removed. Copy your unsaved text, then reload the saved notes.",
  WORKSPACE_ACTOR_CHANGED: "The signed-in account changed. Preserve your unsaved text privately and reopen this page in your own session.",
  SIGN_IN_REQUIRED: "Sign in again to recover saved notes. Preserve any unsaved text first.",
  INVALID_PRIVATE_NOTE: "Enter a title, a case or Research Lead reference, and note text.",
  CASE_NOT_FOUND: "That incident is unavailable. Choose an accessible incident or use a Research Lead reference.",
};

export function PrivateResearchNotes({
  actor, cases, incident,
}: {
  actor: string;
  cases: Array<{ id: string; label: string }>;
  incident?: string;
}) {
  const initialContext = cases.some(item => item.id === incident) ? incident! : "";
  const blank: PrivateNotePayload = {
    kind: "private_research_note", title: "", context_kind: "incident",
    context_id: initialContext, text: "",
  };
  const [form, setForm] = useState(blank);
  const [notes, setNotes] = useState<PrivateNote[]>([]);
  const [selected, setSelected] = useState<PrivateNote | null>(null);
  const [newId, setNewId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const headers = { "Content-Type": "application/json", "x-rvw-actor": actor };

  useEffect(() => {
    const abort = new AbortController();
    fetch(endpoint, { headers: { "x-rvw-actor": actor }, signal: abort.signal, cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(messages[data.error] || "Saved notes are unavailable. Reload to try again.");
        setNotes(data);
        setLoaded(true);
      })
      .catch((failure: Error) => { if (!abort.signal.aborted) setError(failure.message); });
    return () => abort.abort();
  }, [actor]);

  useEffect(() => {
    if (!dirty && !busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, busy]);

  function choose(note: PrivateNote | null) {
    if (dirty && !window.confirm("Discard the unsaved edits to this note? Your last saved version will be kept.")) return;
    setSelected(note);
    setNewId(null);
    setForm(note?.payload || blank);
    setDirty(false);
    setNotice("");
    setError("");
  }

  function update(changes: Partial<PrivateNotePayload>) {
    setForm(current => ({ ...current, ...changes }));
    setDirty(true);
    setNotice("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !loaded) return;
    const id = selected?.id || newId || "note:" + crypto.randomUUID();
    if (!selected) setNewId(id);
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers,
        body: JSON.stringify({ id, expected_revision: selected?.revision || 0, payload: form }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(messages[data.error] || "The note could not be saved. Your text is still here.");
      setNotes(current => [data, ...current.filter(note => note.id !== data.id)]);
      setSelected(data);
      setForm(data.payload);
      setDirty(false);
      setNotice("Saved privately.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The note could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected || busy || !window.confirm("Delete this private note and any unsaved edits? This affects only this personal note.")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, { method: "DELETE", headers,
        body: JSON.stringify({ id: selected.id, expected_revision: selected.revision }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(messages[data.error] || "The note could not be deleted.");
      setNotes(current => current.filter(note => note.id !== selected.id));
      setSelected(null);
      setNewId(null);
      setForm(blank);
      setDirty(false);
      setNotice("Private note deleted.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The note could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main" className="container">
      <section className="panel">
        <div className="inline"><a href="/work">Return to My Work</a>{initialContext &&
          <a href={`/cases/${encodeURIComponent(initialContext)}`}>Return to incident</a>}</div>
        <h1>Private research notes</h1>
        <p>Save working observations, source URLs, excerpts and open questions. Personal notes are visible only to you.</p>
        <p>Use the incident’s fact and evidence forms when you are ready to share research.</p>
        {error && <p role="alert" className="inline-notice">{error}</p>}
        <p role="status">{busy ? "Working…" : notice || (!loaded && !error ? "Loading saved notes…" : "")}</p>
        <div className="inline">
          <button type="button" disabled={busy || !loaded} onClick={() => choose(null)}>New private note</button>
          {notes.map(note => <button type="button" key={note.id} disabled={busy}
            aria-pressed={note.id === selected?.id} onClick={() => choose(note)}>{note.payload.title}</button>)}
        </div>
        <form onSubmit={save} className="section-space">
          <fieldset disabled={busy || !loaded}>
            <legend>{selected ? "Edit private note" : "Write a private note"}</legend>
            <label className="field">Title<input required maxLength={160} value={form.title}
              onChange={event => update({ title: event.target.value })} /></label>
            <label className="field">Associated with<select value={form.context_kind}
              onChange={event => update({ context_kind: event.target.value === "lead" ? "lead" : "incident", context_id: "" })}>
              <option value="incident">Incident</option><option value="lead">Research Lead reference</option>
            </select></label>
            {form.context_kind === "incident" ?
              <label className="field">Incident<select required value={form.context_id}
                onChange={event => update({ context_id: event.target.value })}>
                <option value="">Choose an incident</option>
                {cases.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select></label> :
              <label className="field">Research Lead reference<input required maxLength={200} value={form.context_id}
                onChange={event => update({ context_id: event.target.value })} placeholder="Workbook holder ID or lead reference" /></label>}
            <label className="field">Note<textarea required rows={7} maxLength={16000} value={form.text}
              onChange={event => update({ text: event.target.value })} /></label>
            <div className="inline">
              <button type="submit" className="primary">Save private note</button>
              {selected && <button type="button" className="danger" onClick={remove}>Delete private note</button>}
            </div>
          </fieldset>
        </form>
      </section>
    </main>
  );
}
