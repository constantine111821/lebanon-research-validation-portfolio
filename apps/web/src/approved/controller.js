import { createPrivateAutosave } from "./private-autosave.js";
import { assignmentMembers, assignmentNames, caseAssignment } from "./assignments.js";
import { planPrivateChangeRemoval } from "./private-draft-changes.js";
import { createDisclosures } from "./disclosures.js";
import { draftEditor } from "./draft-editor.js";
import {incidentComparisons,intakeDestination} from './intake-guidance.js';
import order from "./reference-order.json";
import { WorkspaceStore } from "./transport.js";
import { installSnapshotRefresh } from "./snapshot-refresh.js";
import { polishPresentation } from "./presentation.js";
import { createSourceInspection } from "./source-inspection.js";
import { relationshipHelp } from "./evidence-presentation.js";
import { renderIdentityGuide } from "./identity-guide.js";
import { verifiedGISBlob, saveVerifiedGISBlob } from "./gis-download.js";
import { locationReviewInput } from "./geography.js";
import {
  decorateDisposition,
  actionLock,
  factLock,
  incidentLock,
  lockMessage,
  dispositionState,
  decisionSummary,
  decisionForm,
  updateDecisionSubmit,
} from "./disposition-ui.js";
import * as F from "./forms.js";
import * as V from "./views.js";
import * as P2V from "./phase2-view.js";
import * as P2D from "./phase2-data.js";
import { phase2Readiness } from "./phase2-state.js";
import { guidance, help, incidentHelp, bindGuidance } from "./guidance.js";
import {
  h,
  valueText,
  fmt,
  clone,
  uid,
  claims,
  facilityFor,
  facilityName,
  facilityType,
  evidenceFor,
  requiredIds,
  factLabel,
  completionClaims,
  tasks,
  taskBucket,
  labReviewState,
  facilityIdentityReopeningContext,
} from "./shared.js";

export function mountWorkspace(
  container,
  initialSnapshot,
  initialView = "queue",
  incidentId = null,
  onAnalytics = () => {},
  onCorrectionQueue = () => {},
) {
  const seed = {};
  let alive = true;
  let analyticsOpen = false;
  let gisPreview = null;
  container.setAttribute("aria-busy", "false");
  function setBusy(value) {
    busy = value;
    container.setAttribute("aria-busy", String(value));
    syncAssignmentControls();
    if(value) autosave.hold(); else autosave.release();
  }
  const listeners = [];
  const listen = (type, handler) => {
    container.addEventListener(type, handler);
    listeners.push([type, handler]);
  };
  let store = new WorkspaceStore(initialSnapshot),
    s,
    view = initialView,
    current = incidentId,
    pending = [],
    baseRevision = 0,
    creation = null,
    intakeDraft = false,
    lastCreatedId = null,
    draftId = null,
    draftRevision = 0,
    request = null,
    notice = "",
    busy = false,
    queueFilter = "all",
    facilityCommand = null,
    assignmentCommand = null,
    supervisorFilter = "all",
    supervisorSearch = "",
    supervisorAssignee = "",
    activityFilters = {},
    phase2Filter = "APPROVED",
    phase2Search = "",
    phase2Command = null,
    workflowCommand = null,
    dispositionFlow = null,
    dispositionCommand = null,
    dispositionResume = null,
    pendingEditor = null;
  const root = container.querySelector("#app"),
    dialog = container.querySelector("#dialog");
  let pendingHistory = 0;
  function syncAssignmentControls() {
    for (const button of root.querySelectorAll('button[data-action="assign-case"]'))
      button.disabled = busy || pendingHistory > 0;
  }
  let formDirty = false, saveMessage = '', historyReady = false, applyingHistory = false;
  let historyKey = crypto.randomUUID(), lastContext = '', historySerial = Promise.resolve();
  const checkpoints = new Map(); // Owner-bound, tab-memory only. Never history.state research content.
  function payload() {
    if (!current || facilityCommand || assignmentCommand || phase2Command || workflowCommand || dispositionCommand || intakeDraft || (!pending.length && !creation && !draftId)) return null;
    return {incident_id:current, title:creation?.incident.incident_label || s.records.INCIDENT.find(i=>i.incident_id===current)?.incident_label,
      expected_revision:baseRevision, creation, changes:pending, facilityCommand:null};
  }
  function saveState() {
    const status = pending.length || draftId ? saveMessage || autosave.state : "No pending changes";
    for (const bar of container.querySelectorAll(".private-save-status")) bar.textContent = status;
  }
  const autosave = createPrivateAutosave({
    save: async value => {
      draftId ??= crypto.randomUUID();
      const id = draftId;
      const d = await store.saveDraft(id, draftRevision, value);
      if(!alive) return; // An acknowledged in-flight save must not alter a later page.
      draftRevision = d.revision;
      s.drafts = [d, ...(s.drafts || []).filter(x => (x.id || x.draft_id) !== id)];
      syncHistory();
    },
    status: (state,error) => {
      if(!alive) return;
      if(error?.sessionExpired || error?.labAccessDenied || error?.code==='WORKSPACE_ACTOR_CHANGED') showError(error);
      saveMessage = error ? state + ': ' + error.message : state;
      saveState();
    },
  });
  function hasUnsecuredWork() {
    return formDirty || autosave.dirty() || !!(facilityCommand || assignmentCommand || phase2Command || workflowCommand || dispositionCommand);
  }
  function hasSuspendedWork() {
    return [...checkpoints].some(([key,x])=>key!==historyKey && (x.formDirty || (x.save?.latest && x.save.state!=='Saved privately')));
  }
  function checkpoint() {
    if (!historyReady) return;
    checkpoints.set(historyKey, {view,current,pending,baseRevision,creation,intakeDraft,draftId,draftRevision,
      facilityCommand,assignmentCommand,phase2Command,workflowCommand,dispositionCommand,dispositionFlow,dispositionResume,pendingEditor,
      formDirty, save:autosave.checkpoint(), nodes:dialog.open ? [...dialog.childNodes] : null, claim:dialog.dataset.claim, notice});
  }
  function syncHistory() {
    if (!historyReady || applyingHistory) return;
    const context = JSON.stringify([view,current]);
    const data = {view,current,draft:draftId};
    const hash = '#workspace=' + encodeURIComponent(JSON.stringify(data));
    if (context !== lastContext) {
      historyKey = crypto.randomUUID();
      history.pushState({...history.state,rvwKey:historyKey},'',hash);
    } else history.replaceState({...history.state,rvwKey:historyKey},'',hash);
    lastContext = context;
  }
  function restoreDraft(d) {
    intakeDraft=false;
    draftId=d.id||d.draft_id; draftRevision=d.revision; current=d.payload.incident_id;
    pending=clone(d.payload.changes||[]); creation=clone(d.payload.creation); facilityCommand=clone(d.payload.facilityCommand||null);
    baseRevision=d.payload.expected_revision; view=facilityCommand?'facility':'incident';
    if(facilityCommand) current=facilityCommand.payload.facility_id;
    autosave.restore(payload());
  }
  function readLocation() {
    try { return JSON.parse(decodeURIComponent(location.hash.split('#workspace=')[1] || 'null')); } catch { return null; }
  }
  function validContext(ctx) {
    return ctx && ['queue','incident','facility','supervisor','supervisor-detail','validated','validated-detail'].includes(ctx.view)
      && (!ctx.view.startsWith('supervisor') || s.profile.role==='supervisor')
      && (!ctx.current || s.records.INCIDENT.some(i=>i.incident_id===ctx.current) || s.records.FACILITY.some(f=>f.facility_id===ctx.current));
  }
  async function historyReturn(targetKey, targetContext) {
    // Traversal cannot reliably be cancelled. Retain unfinished forms in memory per entry.
    if (autosave.running) await autosave.running.catch(()=>{});
    checkpoint();
    void autosave.flush().catch(()=>{});
    if (autosave.running) await autosave.running.catch(()=>{});
    checkpoint();
    const saved=checkpoints.get(targetKey);
    if (!saved && !validContext(targetContext)) return;
    applyingHistory=true;
    if(dialog.open) dialog.close();
    formDirty=false; pending=[]; creation=null; draftId=null; draftRevision=0;
    facilityCommand=null; assignmentCommand=null; phase2Command=null; workflowCommand=null; dispositionCommand=null;
    dispositionFlow=null; dispositionResume=null; pendingEditor=null; request=null;
    if(saved) {
      ({view,current,pending,baseRevision,creation,intakeDraft,draftId,draftRevision,facilityCommand,assignmentCommand,
        phase2Command,workflowCommand,dispositionCommand,dispositionFlow,dispositionResume,pendingEditor,notice}=saved);
      // Restored unsaved content is not falsely acknowledged.
      autosave.resume(saved.save);
    } else {
      view=targetContext.view; current=targetContext.current; baseRevision=s.revisions.INCIDENT[current]||0;
      const d=s.drafts?.find(d=>(d.id||d.draft_id)===targetContext.draft);
      if(d) restoreDraft(d); else autosave.restore(null);
    }
    historyKey=targetKey||crypto.randomUUID(); lastContext=JSON.stringify([view,current]);
    draw(); applyingHistory=false;
    if(saved?.nodes) {dialog.replaceChildren(...saved.nodes);dialog.dataset.claim=saved.claim||'';dialog.showModal();formDirty=saved.formDirty;}
  }
  function onPop(event) {
    const key=event.state?.rvwKey, ctx=readLocation();
    pendingHistory++;
    syncAssignmentControls();
    historySerial=historySerial.then(()=>historyReturn(key,ctx)).catch(showError).finally(()=>{
      pendingHistory--;
      syncAssignmentControls();
    });
  }
  function beforeUnload(event) {
    if(hasUnsecuredWork() || hasSuspendedWork()) {event.preventDefault();event.returnValue='';}
  }
  function protectLink(event) {
    const link=event.target.closest?.('a[href]');
    if(!link || link.target==='_blank' || link.hasAttribute('download') || event.ctrlKey || event.metaKey || event.shiftKey || event.button!==0) return;
    const target=new URL(link.href,location.href);
    if(target.href===location.href || (target.pathname===location.pathname && target.search===location.search && target.hash)) return;
    if((hasUnsecuredWork() || hasSuspendedWork()) && !confirm('Leave this page with unsaved work? Preserve unfinished form text first. Only acknowledged private drafts survive a full page change.')) {
      event.preventDefault(); event.stopPropagation();
    }
  }
  function focusSave() { void autosave.flush().catch(()=>{}); }
  function visibilitySave() { if(document.hidden) focusSave(); }
  window.addEventListener('popstate',onPop);
  window.addEventListener('beforeunload',beforeUnload);
  window.addEventListener('blur',focusSave);
  document.addEventListener('visibilitychange',visibilitySave);
  document.addEventListener('click',protectLink,true);
  const cancelForm = event=>{
    if(formDirty && !confirm('Discard this unfinished form? It has not been added to your private draft.')) event.preventDefault();
  };
  const closeForm = ()=>{if(!dialog.open) {formDirty=false;if(!applyingHistory) checkpoint();}};
  dialog.addEventListener('cancel',cancelForm);
  dialog.addEventListener('close',closeForm);
  listen('input',event=>{if(dialog.contains(event.target) && event.target.closest('form')) formDirty=true;});
  listen('change',event=>{if(dialog.contains(event.target) && event.target.closest('form')) formDirty=true;});
  listen('focusin', event => event.target.closest?.('.scientific-control')?.removeAttribute('data-tip-dismissed'));
  listen('mouseover', event => event.target.closest?.('.scientific-control')?.removeAttribute('data-tip-dismissed'));
  listen('keydown', event => {
    if (event.key === 'Escape') event.target.closest?.('.scientific-control')?.setAttribute('data-tip-dismissed', 'true');
  });
  const disclosures = createDisclosures(root, window);
  const sourceInspection = createSourceInspection(dialog);
  function showError(e) {
    if (store?.mode === "supabase" && (e.labAccessDenied || e.sessionExpired)) {
      // Keep this tab's working input; server authority remains mandatory on every retry.
      e.message = "Access could not be verified. Your unsaved work remains in this tab. Preserve any unfinished text, sign in again as the same researcher in a separate tab, then retry. " + e.message;
    }
    const box = dialog.open
      ? dialog.querySelector("[data-review-error]") || dialog.querySelector("[role=alert]")
      : document.getElementById("notice");
    if (box) {
      box.hidden = false;
      box.textContent = e.labAccessDenied
        ? "Workspace access requires an active lab profile. Contact the project owner. Your earlier submitted work and saved drafts remain preserved."
        : e.message || String(e);
      if (box.matches("[data-review-error]") && /explain how the selected evidence supports approval/i.test(box.textContent) &&
          !/edit review/i.test(box.textContent))
        box.textContent += " Use Edit review on the proposed factual review above. Your changes are still private.";
      box.scrollIntoView?.({ block: "nearest" });
    } else alert(e.message || String(e));
  }
  function decorate(snapshot) {
    for (const [table, rows] of Object.entries(snapshot.records)) {
      const spec = order[table];
      if (spec) {
        const rank = new Map(spec.ids.map((id, i) => [id, i]));
        rows.sort(
          (a, b) =>
            (rank.get(a[spec.key]) ?? 1e9) - (rank.get(b[spec.key]) ?? 1e9) ||
            String(a[spec.key]).localeCompare(String(b[spec.key])),
        );
      }
    }
    snapshot.source_excerpts =
      snapshot.source_excerpts || seed.source_excerpts || {};
    snapshot.classifications =
      snapshot.classifications || seed.classifications || [];
    return snapshot;
  }
  async function refresh() {
    s = decorate(await store.snapshot());
    return s;
  }
  function visibleState() {
    if (!creation) return s;
    const d = clone(s),
      fid = creation.facility_id || creation.new_facility.facility_id;
    if (!creation.facility_id)
      d.records.FACILITY.push({
        facility_id: fid,
        canonical_name: null,
        aliases: [{ value: creation.new_facility.working_name }],
        source_described_types: {
          working: creation.new_facility.source_described_type,
        },
        locality_governorate: { locality: creation.new_facility.locality },
      });
    d.records.INCIDENT.push({
      incident_id: current,
      incident_label: creation.incident.incident_label,
      incident_type: "unresolved cluster",
      date_precision: "UNKNOWN",
    });
    d.records.INCIDENT_FACILITY.push({
      incident_id: current,
      facility_id: fid,
    });
    d.workflow.incidents[current] = {
      status: "in_progress",
      working_type: creation.incident.working_type,
      required_claim_ids: [],
    };
    return d;
  }
  function allFacts() {
    const ds = visibleState(),
      existing = claims(ds, current);
    return [
      ...existing,
      ...pending
        .filter((x) => x.type === "new_fact")
        .map((x) => ({
          ...x.claim,
          incident_id: current,
          current_verified_value: null,
          validation_state: "NOT_REVIEWED",
          individual_human_factual_adjudication: "NO",
        })),
    ];
  }
  function banner() {
    return current ? V.facilityBanner(visibleState(), current) : "";
  }
  function nav() {
    const local = store.mode === "local";
    return `<header class="topbar"><div class="brand"><strong>Lebanon Research</strong><span>Research workspace</span></div><div class="workspace-state"><div class="shared"><b>${local ? "Local preview" : "Shared research"}</b> <span>${local ? "Saved in this browser only" : ""}</span></div>${local ? `<label>Preview identity <select id="preview-identity"><option value="a" ${store.identity === "a" ? "selected" : ""}>Researcher A</option><option value="b" ${store.identity === "b" ? "selected" : ""}>Researcher B</option><option value="supervisor" ${store.identity === "supervisor" ? "selected" : ""}>Supervisor</option></select></label>` : `<span>${analyticsOpen ? "Supervisor analytics" : h(s.profile.display_name)} · ${h(s.profile.role)}</span>${initialSnapshot.accountSettings === true ? '<a href="/account/password" target="_blank" rel="noopener">My account</a>' : ""}<button data-action="logout">Sign out</button>`}</div></header><nav class="tabs" aria-label="Primary"><button data-action="queue" ${!analyticsOpen && ["queue", "incident", "facility"].includes(view) ? 'aria-current="page"' : ""}>My Work</button><button data-action="supervisor" ${!analyticsOpen && view.startsWith("supervisor") ? 'aria-current="page"' : ""}>Supervisor Hub</button><button data-action="validated" ${!analyticsOpen && view.startsWith("validated") ? 'aria-current="page"' : ""}>Validated Incidents</button>${s.profile.role === "supervisor" ? `<button data-action="analytics" ${analyticsOpen ? 'aria-current="page"' : ""}>Research Analytics</button>` : ""}<button class="refresh-action" data-action="refresh">Refresh</button></nav><div class="workspace-safety">${analyticsOpen ? "Read-only weekly reports. Your unfinished research stays private." : local ? "Local preview · private drafts and submissions are saved in this browser. Preview identities are demonstrations, not secure accounts." : "Your drafts are private."}${analyticsOpen ? "" : ` Submit shares your changes ${local ? "in this preview" : "with the team"}.`}</div>`;
  }
  function draw() {
    autosave.update(payload());
    syncHistory();
    disclosures.capture();
    container.classList.toggle("analytics-open", analyticsOpen);
    let body;
    const ds = {
      ...visibleState(),
      privateCount: pending.length,
      queueFilter,
      supervisorFilter,
      supervisorSearch,
      supervisorAssignee,
      activityFilters,
      phase2Filter,
      phase2Search,
    };
    if (view === "queue") body = V.renderQueue(ds);
    else if (view === "validated") body = P2V.renderValidatedIncidents(ds);
    else if (view === "validated-detail")
      body = P2V.renderValidatedIncident(ds, current);
    else if (view === "incident") body = V.renderIncident(ds, current);
    else if (view === "supervisor") body = V.renderSupervisor(ds);
    else if (view === "supervisor-detail")
      body = V.renderSupervisorDetail(ds, current);
    else if (view === "facility") body = V.renderFacility(ds, current);
    else body = V.renderQueue(ds);
    root.innerHTML = `<div class="shell">${nav()}<main id="main" class="container"><div id="notice" class="inline-notice" role="alert" ${notice ? "" : "hidden"}>${h(notice)}</div>${facilityCommand ? '<div class="private-resume"><span>Private facility review pending — not submitted.</span><button data-action="review-changes">Review changes</button><button data-action="save-facility-draft">Save private draft</button><button data-action="discard">Discard private decision</button></div>' : ""}${lastCreatedId && current === lastCreatedId ? intakeDestination(lastCreatedId) : ""}${body}${
      view === "incident" && pending.length
        ? `<section class="panel private-proposals"><h2>Private staged changes</h2><p>Not shared yet. Review your changes before submitting.</p>${pending
            .filter((x) => x.type !== "new_fact")
            .map(
              (x) =>
                 `<article class="draft-card"><b>${h(x.type === "review" ? "Factual review" : x.type === "evidence" ? "New evidence" : "Research task decision")}</b><p>${h(x.claim_id ? allFacts().find((c) => c.claim_id === x.claim_id)?.subject || x.claim_id : x.task?.factual_question || "")}</p><div class="inline">${['evidence','review'].includes(x.type) ? `<button data-action="edit-pending" data-index="${pending.indexOf(x)}">Edit ${x.type === 'evidence' ? 'evidence' : 'review'}</button>` : ''}<button type="button" data-action="remove-submission-item" data-index="${pending.indexOf(x)}">Remove private change</button></div></article>`,
            )
            .join("")}${pending
            .filter((x) => x.type === "new_fact")
            .map(
              (x) =>
                 `<article class="draft-card"><h3 class="fact-type">${h(factLabel(x.claim))}</h3><p>${h(x.claim.subject)}</p><span class="pill unknown">Not Reviewed</span> <div class="inline"><button data-action="edit-pending" data-index="${pending.indexOf(x)}">Edit fact entry</button> <button data-action="review" data-claim="${h(x.claim.claim_id)}">Review fact</button> <button data-action="evidence" data-claim="${h(x.claim.claim_id)}">+ Add evidence</button><button type="button" data-action="remove-submission-item" data-index="${pending.indexOf(x)}">Remove private change</button></div></article>`,
            )
            .join(
              "",
             )}<div class="inline section-space"><button class="primary" data-action="review-changes">Review changes</button><button data-action="save-draft">Save private draft</button>${draftId && draftRevision > 0 ? '<button data-action="reload-saved-draft">Reload saved draft</button><button class="danger" data-action="delete-draft">Discard entire draft</button>' : '<button class="danger" data-action="discard">Discard working changes</button>'}</div></section>`
        : ""
    }${view === "queue" ? draftsPanel() : ""}<footer class="footer">486 approved baseline records · six classifications · ten Core entities · three-case seed${store.mode === "local" ? " · local preview is not a shared team deployment" : ""}. ${store.mode === "local" ? '<button class="text-button" data-action="reset">Reset local preview</button>' : ""}</footer></main></div>`;
    onCorrectionQueue(!analyticsOpen && view === "supervisor" ? root.querySelector("#fact-correction-queue-host") : null);
    disclosures.restore(`${view}:${current || ""}`);
    if (view === "supervisor-detail") {
      for (const card of root.querySelectorAll(".supervisor-finding[data-claim-id]")) {
        const fact = ds.records.CLAIM.find(c => c.claim_id === card.dataset.claimId);
        if (fact) card.insertAdjacentHTML("beforeend", V.correctionActions(ds, fact, current));
      }
    }
    decorateDisposition(root, ds, current, view);
    polishPresentation(root, ds, current);
    if (!analyticsOpen && ['incident','facility','supervisor-detail'].includes(view)) {
      const count=pending.length+(facilityCommand?1:0);
      const reviewHelp = view === 'incident' ? incidentHelp('review-changes','Review and save changes','<p>Open Review changes to check your queued findings and evidence. Choose Save private draft to return to them later. Submit changes shares the reviewed items with the team.</p>') : '';
      root.querySelector('.shell').insertAdjacentHTML('beforeend',`<aside class="private-action-bar" aria-label="Private changes"><div><strong>${count} pending ${count===1?'change':'changes'}</strong><span class="private-save-status" role="status" aria-live="polite"></span></div><button class="primary" data-action="review-changes">Review changes</button>${count||draftId?'<button data-action="save-draft">Save private draft</button>':''}${reviewHelp}</aside>`);
      saveState();
      if(facilityCommand) root.querySelector('.private-save-status').textContent='Manual private save required';
    }
    root.querySelector("main").id = analyticsOpen ? "workspace-main" : "main";
    root.querySelector("main").hidden = analyticsOpen;
    root.querySelector(".shell").style.minHeight = analyticsOpen ? "0" : "";
    syncAssignmentControls();
  }
  function draftsPanel() {
    return `<section class="panel"><h2>My private drafts</h2>${(s.drafts || []).map((d) => `<article><strong>${h(d.payload?.title || "Private incident draft")}</strong> · saved ${h(d.updated_at)} <button data-action="resume" data-id="${h(d.id || d.draft_id)}">Continue draft</button> <button data-action="delete-draft" data-id="${h(d.id || d.draft_id)}">Discard entire draft</button></article>`).join("") || "<p>No saved private drafts.</p>"}</section>`;
  }
  function modal(title, content) {
    // Preserve the approved renderer bytes while describing this server-backed mode accurately.
    content =
      store.mode === "local"
        ? content
        : content
            .replaceAll(
              "Local preview saves only in this browser.",
              "Submitted changes are saved in the shared workspace.",
            )
            .replaceAll(
              "Local preview saves in this browser only; a configured shared workspace saves for the team.",
              "Drafts are private. Submit shares your changes with the team.",
            )
            .replaceAll(
              "Local preview saves in this browser; shared mode saves for the team.",
              "Submitted facility changes are saved in the shared workspace.",
            );
    formDirty = false;
    dialog.innerHTML = `<div class="dialog-head"><div><div class="eyebrow">Research workspace</div><h2 id="dialog-title">${h(title)}</h2></div><button class="icon-button" data-action="close-dialog" aria-label="Close dialog">×</button></div>${banner()}<div class="dialog-body">${content}</div><p role="alert" class="form-error" hidden></p>`;
    if (!dialog.open) dialog.showModal();
    F.bindForm(dialog);
    polishPresentation(dialog);
    dialog.querySelector("input,select,textarea,button")?.focus();
    dialog.scrollTop = 0;
  }
  function stage(changes, message = "Changes added. Review them before submitting.") {
    pending.push(...changes);
    request = null;
    notice = message;
    dialog.close();
    draw();
  }
  function evidenceSignature(value) {
    // PostgreSQL jsonb can reorder object keys when a private draft is restored.
    // Preserve all values and array order; compare objects independently of order.
    return JSON.stringify(value, (_key, entry) =>
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]]))
        : entry,
    );
  }
  async function leave() {
    checkpoint();
    if(formDirty) { alert('Finish or preserve this unfinished form before leaving. It is not part of your saved draft.'); return false; }
    autosave.update(payload());
    if(payload()) {
      await autosave.flush({retry:true});
      checkpoint();
      pending=[]; creation=null; draftId=null; draftRevision=0; request=null; autosave.restore(null);
    }
    if (
      !pending.length &&
      !creation &&
      !facilityCommand &&
      !assignmentCommand &&
      !phase2Command
    )
      return true;
    modal(
      "Keep your private work?",
      `<p>Save a private draft to continue later, or keep editing.</p><button data-action="save-draft">Save private draft</button> <button data-action="close-dialog">Keep editing</button> <button data-action="discard">Discard private changes</button>`,
    );
    return false;
  }
  async function openIncident(id, target = "incident") {
    if (current !== id && !(await leave())) return;
    await refresh();
    current = id;
    intakeDraft = false;
    view = target;
    baseRevision = s.revisions.INCIDENT[id];
    notice = "";
    draw();
    window.scrollTo(0, 0);
  }
  async function openCorrections(el) {
    // The mounted workspace owns the selected case, including hash traversal.
    // Never derive the destination from the server route that originally mounted it.
    if (!current || !["incident", "supervisor-detail"].includes(view) ||
        !s.records.INCIDENT.some(i => i.incident_id === current))
      throw Error("Open the case from My Work before opening corrections.");
    if (formDirty || hasSuspendedWork() || facilityCommand || assignmentCommand ||
        phase2Command || workflowCommand || dispositionCommand) {
      alert("Finish or save the unfinished research form before opening Corrections and History. Your work remains in this tab; use Back to return to an unfinished form.");
      return;
    }
    autosave.update(payload());
    if (payload()) await autosave.flush({retry:true});
    if (autosave.dirty()) throw Error("Your private draft has not been acknowledged. Retry saving before opening corrections.");
    syncHistory();
    checkpoint();
    const query = new URLSearchParams({returnTo: "/work" + location.hash});
    if (el.dataset.claim) query.set("fact", el.dataset.claim);
    if (el.dataset.intent) query.set("intent", el.dataset.intent);
    window.location.assign(`/cases/${encodeURIComponent(current)}/corrections?${query}`);
  }
  function reviewFactById(claimId) {
    if (factLock(s, claimId).locked)
      throw Error(lockMessage(factLock(s, claimId)));
    let c =
      allFacts().find((c) => c.claim_id === claimId) ||
      s.records.CLAIM.find((c) => c.claim_id === claimId);
    if (view === "facility" && c) {
      current = c.incident_id;
      baseRevision = s.revisions.INCIDENT[current];
      view = "incident";
      draw();
    }
    if (!c) throw Error("Fact not found.");
    const proposal = s.workflow?.claims?.[c.claim_id]?.proposal;
    modal(
      "Review fact",
      (proposal
        ? `<div class="callout"><b>Initial entry — needs validation:</b> ${h(fmt(Object.hasOwn(proposal, "value") ? proposal.value : proposal.proposed_value))} ${h(proposal.date_precision || "")}<p>Check the sources and choose the verified value yourself. This entry is not a verified finding.</p></div>`
        : "") + reviewFactForm(c),
    );
    dialog.dataset.claim = c.claim_id;
  }
  function sourceState(cid, includePrivate = true) {
    const ds = clone(visibleState());
    const proposed = pending.find(
      (x) => x.type === "new_fact" && x.claim.claim_id === cid,
    );
    if (includePrivate && proposed) ds.records.CLAIM.push(proposed.claim);
    for (const x of includePrivate ? pending : []) {
      if (x.type === "evidence" && x.claim_id === cid) {
        if (x.source) ds.records.SOURCE.push(x.source);
        ds.records.CLAIM_SOURCE.push({
          ...x.relation,
          claim_id: cid,
          source_id: x.source?.source_id || x.source_id,
        });
      }
    }
    for (const x of includePrivate ? creation?.facility_evidence || [] : []) {
      if (
        x.source &&
        (x.identity_claim_id === cid || x.type_claim_id === cid)
      ) {
        ds.records.SOURCE.push(x.source);
        ds.records.CLAIM_SOURCE.push({
          ...x.relation,
          claim_id: cid,
          source_id: x.source.source_id,
        });
      }
    }
    return ds;
  }
  function sourceCards(cid, includePrivate = true, privateOnly = false) {
    const ds = sourceState(cid, includePrivate);
    const linked = evidenceFor(ds, cid).filter(({ relation }) =>
      !privateOnly || !s.records.CLAIM_SOURCE.some(saved => saved.claim_source_id === relation.claim_source_id),
    );
    if (privateOnly && !linked.length) return "";
    if (privateOnly)
      return `<section class="evidence-review"><h3>Unsubmitted evidence</h3><p>Submit this evidence first, then reopen the review to select it for approval.</p><div class="review-evidence">${linked.map(({ source, relation }) => V.evidenceCard(ds, source, relation, false)).join("")}</div></section>`;
    return `<section class="evidence-review"><h3>Review the linked evidence</h3>${guidance("review-evidence", "Check what each source says about this exact fact. Linked records are not a count of independent confirmations.")}${help("review-evidence-relationships", "What do these evidence relationships mean?", relationshipHelp())}<div class="review-evidence">${
      linked
        .map(({ source, relation }) =>
          V.evidenceCard(ds, source, relation, false),
        )
        .join("") ||
      "<p>No linked evidence yet. Add at least one source before submitting a factual review.</p>"
    }</div></section>`;
  }
  function evidenceDialog(cid) {
    if (incidentLock(s, current).locked)
      throw Error(lockMessage(incidentLock(s, current)));
    if (cid && factLock(s, cid).locked)
      throw Error(lockMessage(factLock(s, cid)));
    const cs = allFacts(),
      selected = cs.find((c) => c.claim_id === cid);
    modal(
      "Add evidence",
      `<form id="evidence-form">${guidance("add-evidence-purpose", "<b>Use this when you found another source about an existing fact.</b> Adding evidence does not automatically change the current finding.")}<section class="review-context" data-evidence-target><h2>${selected ? h(factLabel(selected)) : "Choose the exact facts"}</h2>${selected ? `<p class="fact-proposition"><strong>${h(selected.subject)}</strong></p><p>Recorded finding: <b>${h(valueText(selected))}</b> · ${h(selected.validation_state)}</p><p>${h(s.records.INCIDENT.find((i) => i.incident_id === current)?.incident_label)}</p><small>Fact ${h(selected.claim_id)}</small>` : "<p>Choose each proposition below; the relationship applies to each selected proposition.</p>"}</section>${selected ? `<input type="hidden" name="claim_id" value="${h(cid)}">` : cs.map((c) => `<label><input type="checkbox" name="claims" value="${h(c.claim_id)}" ${factLock(s, c.claim_id).locked ? "disabled" : ""}> ${h(c.subject)}${factLock(s, c.claim_id).locked ? " — shared changes locked by supervisor disposition" : ""}</label>`).join("<br>")}<label class="field">Use a source already recorded, or enter a new one<select name="existing_source" data-source-reuse><option value="">Enter a new source</option>${s.records.SOURCE.map((x) => `<option value="${h(x.source_id)}">${h(x.title)}</option>`).join("")}</select></label><div id="source-entry">${F.renderSource("evidence")}</div>${guidance("add-evidence-review-needed", "If this source materially challenges the existing finding, the fact will be marked for review rather than changed automatically.")}<button class="primary">Add evidence to changes</button></form>`,
    );
  }
  function reviewChanges() {
    if (facilityCommand) {
      reviewFacility();
      return;
    }
    const rs = clone(visibleState());
    for (const x of pending) {
      if (x.type === "new_fact")
        rs.records.CLAIM.push({
          ...x.claim,
          current_verified_value: null,
          validation_state: "NOT_REVIEWED",
        });
      if (
        x.source?.source_id &&
        !rs.records.SOURCE.some((v) => v.source_id === x.source.source_id)
      )
        rs.records.SOURCE.push(x.source);
    }
    modal(
      "Review Changes",
      V.renderReview(rs, current, pending) +
        (creation?.facility_evidence || [])
          .map(
            (e) =>
              `<article class="draft-card"><h3>Facility evidence</h3><p><b>Selected dimensions:</b> ${h(e.scopes.join(", "))}. Other dimensions receive no evidence link.</p>${V.evidenceCard(rs, e.source || rs.records.SOURCE.find((x) => x.source_id === e.source_id), e.relation, true)}${e.location ? "<p><b>Location described by source:</b> " + h((e.location.locality || "Unknown locality") + " · " + e.location.method + " · " + e.location.precision + " · " + e.location.limitations) + "</p>" : ""}</article>`,
          )
          .join("") +
        `<section class="panel">${guidance("submission-result", creation ? "<b>Facility/incident changes:</b> This creates an incident for Team Review. Intake does not establish study eligibility. New facts start Not Reviewed unless you also explicitly reviewed and certified them in these changes." : "These changes create a recorded revision. Earlier findings remain in history. Removing an item changes only your private draft.")}<p class="private-save-status" role="status" aria-live="polite"></p><p class="form-error" role="alert" data-review-error hidden></p><label><input id="submission-confirm" type="checkbox"> I checked these changes.</label><div class="actions"><button data-action="save-draft" ${payload() ? "" : "disabled"}>Save private draft</button><button class="primary" data-action="submit" ${pending.length ? "" : "disabled"}>${creation ? "Submit to Team Review" : directFactSubmission() ? "Add fact to case" : "Submit changes"}</button><button data-action="submit-evidence" ${creation || !pending.some((x) => x.type === "evidence" && s.records.CLAIM.some((c) => c.claim_id === x.claim_id)) ? "disabled" : ""}>Submit evidence only</button></div>${draftId && draftRevision > 0 ? '<div class="inline section-space"><button data-action="reload-saved-draft">Reload saved draft</button><button class="danger" data-action="delete-draft">Discard entire draft</button></div>' : ""}${guidance("submission-options", "<b>Save private draft:</b> keep this work for yourself without changing shared research.<br><b>Submit evidence only:</b> add sources to existing facts without a new factual decision or other staged changes.<br><b>" + (creation ? "Submit to Team Review:</b> add this incident so other researchers can continue it." : directFactSubmission() ? "Add fact to case:</b> save the new factual proposition and any initial evidence. It still needs lab validation." : "Submit changes:</b> save the listed changes, including only the factual decisions you explicitly reviewed and certified."))}${help("submission-options-more", "What happens after I submit?", "<p>Human-reviewed facts are only those you explicitly checked and certified. New unreviewed facts stay unreviewed; adding a source does not certify a fact. Submitted history is preserved. Local preview saves in this browser only; a configured shared workspace saves for the team.</p>")}</section>`,
    );
    saveState();
  }
  function restoreIntakeDraft(d) {
    intakeDraft = !!d.payload.creation?.intake_form;
    if (!intakeDraft) return false;
    draftId=d.id||d.draft_id; draftRevision=d.revision; current=d.payload.incident_id; pending=[]; creation=null; request=null; facilityCommand=null;
    modal('Continue private incident intake',F.manualForm(s.records.FACILITY.filter(f=>s.workflow?.facilities?.[f.facility_id]?.resolution?.outcome!=='same').map(f=>({...f,facility_type:facilityType(s,f.facility_id)})),{incidents:incidentComparisons(s),links:s.records.INCIDENT_FACILITY,sources:s.records.SOURCE}));
    F.restoreIntake(dialog.querySelector('#manual-form'),d.payload.creation.intake_form);
    return true;
  }
  async function saveDraft() {
    if (!payload()) throw Error("This work needs its existing explicit save/review action.");
    autosave.update(payload());
    await autosave.flush({retry:true});
    notice="Private draft saved for this researcher. It has not entered Team Review.";
    if(dialog.open && !formDirty) dialog.close();
    draw();
  }
  function directFactSubmission() {
    const ids = new Set(
      pending.filter((x) => x.type === "new_fact").map((x) => x.claim.claim_id),
    );
    return (
      !creation &&
      ids.size > 0 &&
      pending.every(
        (x) =>
          x.type === "new_fact" ||
          (x.type === "evidence" && ids.has(x.claim_id)),
      )
    );
  }
  async function submit(evidenceOnly = false) {
    const addingFact = !evidenceOnly && directFactSubmission();
    const created = !!creation;
    if (!dialog.querySelector("#submission-confirm")?.checked)
      throw Error("Check the changes and confirm before submitting.");
    const selected = evidenceOnly
      ? pending.filter(
          (x) =>
            x.type === "evidence" &&
            s.records.CLAIM.some((c) => c.claim_id === x.claim_id),
        )
      : pending;
    if (selected.some((change) => change.type === "review" &&
      change.validation_state === "SUPPORTED" &&
      (typeof change.basis_explanation !== "string" || !change.basis_explanation.trim()) &&
      F.reviewBasisNeedsExplanation(s, change.claim_id)))
      throw Error(F.approvalRationaleMessage + " Choose Edit review to add that explanation, then review your changes again.");
    const known = new Set(s.records.SOURCE.map((x) => x.source_id));
    const changes = selected.map((x) => {
      if (x.type !== "evidence") return x;
      if (x.source) {
        known.add(x.source.source_id);
        return x;
      }
      if (x.source_id && !known.has(x.source_id)) {
        const original = pending.find(
          (y) => y.source?.source_id === x.source_id,
        );
        if (original) {
          known.add(x.source_id);
          const copy = { ...x, source: original.source };
          delete copy.source_id;
          return copy;
        }
      }
      return x;
    });
    if (!changes.length) throw Error("There are no changes to submit.");
    request ??= {
      operation_id: crypto.randomUUID(),
      incident_id: current,
      expected_revision: baseRevision,
      kind: creation ? "create_incident" : "submit_changes",
      payload: creation ? { ...creation, changes } : { changes },
    };
    if (JSON.stringify(request.payload.changes) !== JSON.stringify(changes))
      request = {
        ...request,
        operation_id: crypto.randomUUID(),
        payload: creation ? { ...creation, changes } : { changes },
      };
    const result = await store.commit(request);
    baseRevision = result.revision;
    pending = pending.filter((x) => !selected.includes(x));
    creation = null;
    if (created) lastCreatedId = current;
    request = null;
    if (draftId && !pending.length) {
      try {
        await store.deleteDraft(draftId, draftRevision);
        draftId = null;
        draftRevision = 0;
      } catch {
        notice =
          "Submitted. The saved private draft could not be removed; it remains revision-protected.";
      }
    }
    await refresh();
    view = "incident";
    dialog.close();
    notice = evidenceOnly
      ? "Evidence submitted. Earlier factual findings remain unchanged; material evidence is flagged for review."
      : addingFact
        ? "Fact added to the case. It needs lab validation; adding evidence does not validate it."
        : created
          ? "Submitted to Team Review. This does not mark the incident complete."
          : changes.some(change => change.type === "review")
            ? "Fact validation recorded in shared research. Incident completion is a separate Supervisor decision."
            : "Changes submitted to shared research.";
    draw();
  }

  function assignmentDialog(id) {
    if (s.profile?.role !== "supervisor")
      throw Error("Only a supervisor can assign cases.");
    const incident = s.records.INCIDENT.find((i) => i.incident_id === id);
    if (!incident) throw Error("Incident not found.");
    current = id;
    baseRevision = s.revisions.INCIDENT[id];
    assignmentCommand = null;
    const a = caseAssignment(s, id);
    const members = assignmentMembers(a);
    const available = (s.team || []).filter((p) => p.role === "researcher" && p.active !== false);
    // Keep the existing first assignee first for older read-only clients.
    const choices = [...members, ...available.map((p) => p.user_id).filter((id) => !members.includes(id))];
    const checkboxes = choices.map((id) => {
      const person = available.find((p) => p.user_id === id);
      const label = person?.display_name || assignmentNames(s, [id]) + " (remove before saving)";
      return `<label class="certification-box"><input type="checkbox" name="assigned_researchers" value="${h(id)}" ${members.includes(id) ? "checked" : ""}> ${h(label)}</label>`;
    }).join("");
    modal(
      "Assign case",
      `<form id="assignment-form" data-incident="${h(id)}" data-revision="${baseRevision}" data-assignment-revision="${a?.revision || 0}"><p>${h(incident.incident_label)}</p><fieldset><legend>Assigned researchers</legend><p class="subtle">Select everyone who should see this incident under Assigned to me. Clear all selections to unassign the case.</p>${checkboxes || '<p>No active researchers are available.</p>'}</fieldset><label class="field">Assignment reason / note<textarea name="assignment_note" required maxlength="4000">${h(a?.assignment_note || "")}</textarea></label><p>Assignments coordinate lab work. Scientific review and private drafts have their own permissions.</p><button type="submit" class="primary">Review assignment</button></form>`,
    );
  }
  function reviewAssignment() {
    const x = assignmentCommand,
      a = caseAssignment(s, x.incident_id);
    modal(
      "Review assignment",
      `<p><b>Case:</b> ${h(s.records.INCIDENT.find((i) => i.incident_id === x.incident_id)?.incident_label)}</p><div class="change-detail-grid"><div><span>Current assignees</span><b>${h(assignmentNames(s, assignmentMembers(a)))}</b></div><div><span>Proposed assignees</span><b>${h(assignmentNames(s, x.payload.assigned_researchers))}</b></div><div class="wide"><span>Reason / note</span><b>${h(x.payload.assignment_note)}</b></div></div><p>The proposed team is private until you submit. The server checks case and assignment revisions. Earlier assignments remain in history.</p><label class="certification-box"><input type="checkbox" id="assignment-confirm"> I checked this assignment.</label><div class="dialog-actions"><button data-action="close-dialog">Cancel</button><button class="primary" data-action="submit-assignment">Submit assignment</button></div>`,
    );
  }
  async function submitAssignment() {
    if (
      !assignmentCommand ||
      !dialog.querySelector("#assignment-confirm")?.checked
    )
      throw Error(
        "Check the proposed assignment and confirm before submitting.",
      );
    await store.commit(assignmentCommand);
    assignmentCommand = null;
    await refresh();
    baseRevision = s.revisions.INCIDENT[current];
    dialog.close();
    notice =
      "Assignment recorded. Factual findings and review completion are unchanged.";
    draw();
  }

  async function phase2Dialog(id, revoke = false) {
    if (s.profile?.role !== "supervisor")
      throw Error("Only a supervisor can approve or revoke Phase 2 entry.");
    if (pending.length || creation || facilityCommand || assignmentCommand)
      throw Error("Submit or leave private changes before a Phase 2 decision.");
    await openIncident(id, "supervisor-detail");
    if (current !== id) return;
    const r = phase2Readiness(s, id);
    phase2Command = null;
    const modes = revoke
      ? ""
      : `<label class="field">Approval action<select name="mode"><option value="approve" ${r.canApprove ? "" : "disabled"}>Approve for Phase 2</option></select></label>`;
    modal(
      revoke ? "Revoke Phase 2 approval" : "Approve for Phase 2",
      `<form id="phase2-form" data-kind="${revoke ? "revoke_phase2" : "approve_phase2"}" data-incident="${h(id)}" data-revision="${r.revision}" data-approval-revision="${r.approval?.revision || 0}">${P2V.phase2ReadinessPanel(s, id, { actions: false })}${modes}<label class="field">${revoke ? "Reason for revoking approval" : "Supervisor rationale"}<textarea name="reason" required maxlength="4000" placeholder="Explain this decision for the current downstream objective."></textarea></label><p>This changes workflow approval, not factual values. The next screen shows the exact decision before submission.</p><button type="submit" class="primary" ${!revoke && !r.canApprove && !r.canDeferAndApprove ? "disabled" : ""}>Review Phase 2 decision</button></form>`,
    );
  }
  function reviewPhase2() {
    const x = phase2Command,
      r = phase2Readiness(s, x.incident_id),
      revoke = x.kind === "revoke_phase2",
      defer = x.payload.mode === "defer_nonessential";
    modal(
      revoke ? "Confirm Phase 2 revocation" : "Confirm Phase 2 approval",
      `${P2V.phase2ReadinessPanel(s, x.incident_id, { actions: false })}<div class="change-detail-grid"><div><span>Decision</span><b>${revoke ? "Revoke Phase 2 approval" : defer ? "Defer remaining nonessential work and approve" : "Approve for Phase 2"}</b></div><div><span>Incident revision being reviewed</span><b>${h(x.expected_revision)}</b></div><div class="wide"><span>Supervisor rationale</span><b>${h(x.payload.reason)}</b></div></div>${defer ? `<h3>Tasks to defer in this transaction</h3><ul>${r.deferrableTasks.map((g) => `<li>${h(g.factual_question)} — ${h(g.lab_task_state)} → Deferred</li>`).join("") || "<li>No eligible remaining tasks.</li>"}</ul><p>${r.completionCurrent ? "The current completion will be carried forward with the approval." : "The transaction will also record completion under the existing requirements if eligible."} All parts commit together or none do.</p>` : ""}<p>${revoke ? "The record leaves the approved repository. Its research and approval history remain preserved." : "The repository will read the same current facts. Unknowns, conflicts and remaining limitations are preserved."}</p><label class="certification-box"><input type="checkbox" id="phase2-confirm"> I checked this decision, the remaining limitations, and the current revision.</label><div class="dialog-actions"><button data-action="close-dialog">Cancel</button><button class="primary" data-action="submit-phase2">${revoke ? "Revoke Phase 2 approval" : "Approve for Phase 2"}</button></div>`,
    );
  }
  async function submitPhase2() {
    if (!phase2Command || !dialog.querySelector("#phase2-confirm")?.checked)
      throw Error("Check the Phase 2 decision and confirm before submitting.");
    const kind = phase2Command.kind;
    await store.commit({
      ...phase2Command,
      payload: { ...phase2Command.payload, attestation: true },
    });
    phase2Command = null;
    await refresh();
    baseRevision = s.revisions.INCIDENT[current];
    view = "supervisor-detail";
    dialog.close();
    notice =
      kind === "revoke_phase2"
        ? "Phase 2 approval revoked. The research and approval history are preserved."
        : "Phase 2 approval recorded. The current eligible record is available in Validated Incidents.";
    draw();
  }
  async function exportValidated(context = false) {
    await refresh();
    const count = P2D.repositoryRecords(s).length,
      csv = context ? P2D.contextMeasuresCSV(s) : P2D.validatedIncidentsCSV(s),
      name = context
        ? "validated_context_measures_" +
          new Date().toISOString().slice(0, 10) +
          ".csv"
        : P2D.csvFilename(new Date());
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice = context
      ? "Context measures CSV exported from currently approved incidents."
      : "CSV exported: " +
        count +
        " currently approved incident" +
        (count === 1 ? "" : "s") +
        ". Unknown values remain unknown.";
    draw();
  }

  async function gisRequest(mode, format, binding = null) {
    const params = new URLSearchParams({ mode, format });
    if (binding) {
      params.set("version", binding.snapshot_version);
      params.set("checksum", binding.content_sha256);
      if (binding.generated_at) params.set("generated_at", binding.generated_at);
    }
    const response = await fetch("/api/gis-export?" + params, { cache: "no-store", signal: AbortSignal.timeout(330000) });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const messages = {
        GIS_PRESENTATION_CAPACITY_EXCEEDED: "The presentation exceeds the current verified package envelope. No findings were dropped. The existing CSV remains available; request a larger-package acceptance review.",
        GIS_DATA_CHANGED_REVIEW_AGAIN: "The research changed while this export was prepared. Open the summary again to use the current approved records.",
        GIS_NO_ELIGIBLE_FEATURES: "No facility-incident currently meets this GIS export's requirements.",
        GIS_ARCGIS_FIELD_LIMIT_EXCEEDED: "The full evidence exceeds this CSV's tested ArcGIS field limit. No findings were dropped and no file was generated.",
        GIS_ARCGIS_TEXT_FIELD_TOO_LONG: "A field exceeds the tested ArcGIS text limit. No text was shortened and no file was generated.",
        GIS_EXPORT_BUSY: "Another export is being prepared on this server. Wait for it to finish, then try again. No file was saved.",
        GIS_EXPORT_TIME_BUDGET: "This export exceeded the preparation time limit. No partial file was saved. Try again; if it repeats, report the export size for review.",
        GIS_EXPORT_RESOURCE_BUDGET: "This export exceeded the verified resource envelope. No findings were omitted and no partial file was saved. Report the export size for review.",
      };
      throw Error(messages[body.error] || "The GIS integrity check could not complete. No file was generated. " + (body.error || ""));
    }
    return response;
  }
  async function prepareGIS(mode) {
    gisPreview = null;
    modal("Preparing GIS export", '<p role="status">Checking current approvals, locations, dates and evidence… A large Full Fact export can take a minute or longer. Keep this tab open.</p>');
    try {
      const result = await (await gisRequest(mode, "summary")).json();
      gisPreview = { mode, result };
      const count = result.facility_incident_features_exported;
      const title = mode === "full" ? "Full Fact GIS Export" : "Date and Incident GIS Export (Simplified)";
      modal(title, `<p>${h(result.empty_reason || "This file uses the current validated snapshot. Downloads are checked again if research changes.")}</p>
        <dl class="gis-summary"><dt>Eligible incidents considered</dt><dd>${result.eligible_incidents_considered}</dd>
        <dt>Facility-incident features to export</dt><dd>${count}</dd>
        <dt>Excluded: unresolved location</dt><dd>${result.features_excluded_geometry}</dd>
        <dt>Excluded: missing or unvalidated date</dt><dd>${result.features_excluded_date}</dd>
        <dt>Other validation exclusions</dt><dd>${result.features_excluded_other}</dd></dl>
        ${result.undated_full_features ? `<p>${result.undated_full_features} features have no validated day or bounded range. Their date fields remain blank.</p>` : ""}
        ${result.direct_file_mapping?.public_account_within_feature_limit === false ? `<p class="callout" role="status">This complete file has more than 250 features, beyond the documented free public-account direct-mapping limit. No rows are removed or split. Do not accept a partial map; use an authorized workflow that supports the complete file.</p>` : ""}
        <details><summary>Exclusions and reproducibility</summary><p>Schema ${h(result.receipt.schema_version)}. Only individually validated findings are included. No geocoding is performed. CSV download does not configure ArcGIS pop-ups.</p>
        <ul>${result.exclusions.map(x=>`<li>${h(x.facility_id||"No facility association")} / ${h(x.incident_id)}: ${h(x.reason.replaceAll("_"," ").toLowerCase())}</li>`).join("")||"<li>No feature exclusions.</li>"}</ul>
        <p>${result.excluded_facts} unreviewed, invalidated or deferred findings excluded. The receipt records their IDs and the exact file checksum.</p>
        <p>Long findings and paired citations use numbered continuation columns. Follow the supplied ArcGIS import and pop-up instructions; default date inference can introduce timestamps.</p></details>
        <p class="gis-download-status" role="status" aria-live="polite">${count ? "Export available. The file will be verified before it is saved." : ""}</p>
        ${mode === "full" ? '<p>The companion presentation ZIP is deferred pending hosted delivery validation. The existing CSV and verification receipt remain available.</p>' : ""}
        <div class="dialog-actions"><button data-action="close-dialog">Close</button><button data-action="download-gis-receipt" ${count?"":"disabled"}>Download verification receipt</button><button class="primary" data-action="download-gis-csv" ${count?"":"disabled"}>Download CSV</button></div>`);
    } catch(error) {
      modal("GIS export unavailable", `<p role="alert">${h(error.message)}</p><button data-action="close-dialog">Close</button>`);
    }
  }
  async function downloadGIS(format) {
    if (!gisPreview) throw Error("Open the GIS export summary first.");
    const { mode, result } = gisPreview;
    const status = dialog.querySelector(".gis-download-status");
    const show = text => { if (status) status.textContent = text; };
    const buttons = [...dialog.querySelectorAll('[data-action^="download-gis-"]')];
    buttons.forEach(button => { button.disabled = true; });
    try {
      show("Preparing export. A large Full Fact file can take a minute or longer. Keep this tab open.");
      let blob, filename = format === "csv" ? result.filename : result.filename.replace(".csv", ".receipt.json");
      if (format === "csv") {
        const response = await gisRequest(mode, format, result.receipt);
        blob = await verifiedGISBlob(response, result.receipt, progress => {
          show(progress.stage === "verify" ? "Verifying file integrity…" :
            `Transferring export: ${progress.received.toLocaleString()} of ${progress.total.toLocaleString()} bytes received.`);
        });
      } else {
        blob = new Blob([JSON.stringify(result.receipt, null, 2) + "\n"], { type: "application/json" });
      }
      show("Checking that approvals and research are still current…");
      await gisRequest(mode, "verify", result.receipt);
      saveVerifiedGISBlob(blob, filename);
      show(format !== "receipt" ? "Download completed and verified. Your browser may ask where to save the file." : "Verification receipt saved for this unchanged snapshot.");
    } catch (error) {
      const integrity = /^GIS_DOWNLOAD_/.test(error.message);
      show(integrity ? "The file was incomplete or did not match its verification receipt. No file was saved. Open the export summary again and retry." :
        error.name === "TimeoutError" || error.name === "AbortError" ? "The download timed out or was interrupted. No file was saved. Open the export summary again and retry." :
        "No file was saved. " + error.message + " Open the export summary again before retrying.");
    } finally {
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  function requirementDialog() {
    const w = s.workflow.incidents[current] || {},
      required = requiredIds(s, current);
    modal(
      "Set completion requirements",
      `<form id="requirements-form"><p>Choose which facts are material to this incident. Optional context does not block completion. Every exception needs a recorded reason.</p>${completionClaims(
        s,
        current,
      )
        .map(
          (c) =>
            `<fieldset><legend>${h(factLabel(c))}</legend><p>${h(c.subject)}</p><label><input type="checkbox" name="required" value="${h(c.claim_id)}" ${required.includes(c.claim_id) ? "checked" : ""}> Required material fact</label><label>Explicit disposition <select name="disposition-${h(c.claim_id)}"><option value="">No exception — review required</option>${["deferred", "unable_to_resolve", "not_required"].map((v) => `<option value="${v}" ${w.dispositions?.[c.claim_id]?.disposition === v ? "selected" : ""}>${h(v.replaceAll("_", " "))}</option>`).join("")}</select></label><label>Reason <input name="reason-${h(c.claim_id)}" value="${h(w.dispositions?.[c.claim_id]?.reason || "")}" ${w.dispositions?.[c.claim_id]?.disposition ? "data-required-text" : ""}></label></fieldset>`,
        )
        .join(
          "",
        )}<fieldset><legend>Facility location requirement</legend><p>This requirement applies to all currently linked incidents for ${h(facilityName(facilityFor(s, current)))} (${s.records.INCIDENT_FACILITY.filter((x) => x.facility_id === facilityFor(s, current)?.facility_id && x.is_current !== false).length} records). A supervisor must give a reason if location review is not material to their intended use. This never verifies a location; changing this shared requirement reopens affected completed reviews.</p><label><input type="checkbox" name="location_required" ${s.workflow?.facilities?.[facilityFor(s, current)?.facility_id]?.location_required ? "checked" : ""}> Supported location review is required</label><label>Reason for the location requirement<textarea name="location_requirement_reason" required>${h(s.workflow?.facilities?.[facilityFor(s, current)?.facility_id]?.reason || "")}</textarea></label></fieldset><label>Why are these the appropriate completion requirements?<textarea name="reason" required></textarea></label><button class="primary">Record requirements</button></form>`,
    );
  }
  async function workflow(kind, payload) {
    if (pending.length)
      throw Error(
        "Submit or save and leave private changes before a completion decision.",
      );
    if (
      !workflowCommand ||
      workflowCommand.kind !== kind ||
      workflowCommand.expected_revision !== baseRevision ||
      JSON.stringify(workflowCommand.payload) !== JSON.stringify(payload)
    )
      workflowCommand = {
        operation_id: crypto.randomUUID(),
        incident_id: current,
        expected_revision: baseRevision,
        kind,
        payload,
      };
    await store.commit(workflowCommand);
    workflowCommand = null;
    await refresh();
    baseRevision = s.revisions.INCIDENT[current];
    dialog.close();
    notice =
      "Workflow decision recorded with researcher identity, timestamp, and revision.";
    draw();
  }
  async function beginDisposition(
    type,
    id,
    action,
    requestId = null,
    override = false,
  ) {
    if (s.profile.role !== "supervisor")
      throw Error(
        "Only a supervisor may defer, approve or reopen a fact or incident.",
      );
    await refresh();
    const fact = s.records.CLAIM.find((c) => c.claim_id === id);
    const iid =
      type === "incident"
        ? id
        : view !== "facility" &&
            s.records.INCIDENT.some((i) => i.incident_id === current)
          ? current
          : fact?.incident_id;
    if (!iid || (type === "fact" && !fact))
      throw Error("The disposition target is no longer available.");
    const state = dispositionState(s, type, id);
    if (action === "REOPEN" ? state === "ACTIVE" : state !== "ACTIVE")
      throw Error(
        "This state changed. Reopen deferred or approved work before a new decision.",
      );
    if (type === "fact" && action !== "REOPEN" && factLock(s, id).locked)
      throw Error(lockMessage(factLock(s, id)));
    dispositionFlow = {
      target_type: type,
      target_id: id,
      incident_id: iid,
      action,
      request_id: requestId,
      override,
      expected_revision: s.revisions.INCIDENT[iid],
      expected_target_revision:
        type === "fact" ? s.revisions.CLAIM[id] : s.revisions.INCIDENT[iid],
    };
    dispositionCommand = null;
    dispositionResume = null;
    renderDispositionConfirmation();
  }
  function renderDispositionConfirmation() {
    const flow = dispositionFlow;
    if (flow.action === "REOPEN") {
      modal(`Reopen ${flow.target_type}`, decisionForm(s, flow));
      return;
    }
    const heading = `<div class="disposition-flow" data-disposition-ui><p>Step 2 of 3 · Confirm ${h(flow.action.toLowerCase())}</p>${decisionSummary(s, flow)}</div>`;
    if (flow.target_type === "fact" && flow.action === "APPROVE") {
      const fact = s.records.CLAIM.find((c) => c.claim_id === flow.target_id);
      const template = document.createElement("template");
      template.innerHTML = reviewFactForm(fact, false);
      const form = template.content.querySelector("form");
      form.id = "disposition-review-form";
      form.classList.add("disposition-flow");
      form.querySelector('[type="submit"]').textContent =
        "Confirm Approve — review this determination";
      modal("Approve fact — review determination", heading + form.outerHTML);
    } else {
      const evidence =
        flow.target_type === "fact"
          ? sourceCards(flow.target_id, false)
          : `<h3>Current facts, evidence and uncertainty</h3>${claims(
              s,
              flow.incident_id,
            )
              .map(
                (c) =>
                  `<details class="secondary-details"><summary>${h(c.subject)} — ${h(fmt(c.current_verified_value))} · ${h(c.validation_state)}</summary>${sourceCards(c.claim_id, false)}</details>`,
              )
              .join("")}`;
      modal(
        `${flow.action === "DEFER" ? "Defer" : "Approve"} ${flow.target_type}`,
        `${heading}<details class="secondary-details"><summary>Evidence details</summary>${evidence}</details><div class="dialog-actions"><button data-action="close-dialog">Cancel</button><button class="primary" data-action="disposition-confirm">Confirm ${h(flow.action.toLowerCase())}</button></div>`,
      );
    }
  }
  async function commitDisposition(payload) {
    const flow = dispositionFlow;
    const candidate = {
      incident_id: flow.incident_id,
      expected_revision: flow.expected_revision,
      kind: "set_disposition",
      payload,
    };
    if (
      !dispositionCommand ||
      JSON.stringify({ ...dispositionCommand, operation_id: undefined }) !==
        JSON.stringify(candidate)
    )
      dispositionCommand = { ...candidate, operation_id: crypto.randomUUID() };
    await store.commit(dispositionCommand);
    dispositionCommand = null;
    dispositionFlow = null;
    await refresh();
    if (!pending.length && !creation && current)
      baseRevision = s.revisions.INCIDENT[current];
    dialog.close();
    notice =
      "Supervisor decision recorded. Evidence, earlier decisions and private drafts remain preserved. Incident Approve also authorizes Phase 2 / validated output.";
    draw();
  }
  async function submitRequest(kind, payload, iid = current) {
    const candidate = {
      kind,
      payload,
      incident_id: iid,
      expected_revision: s.revisions.INCIDENT[iid],
    };
    if (
      !dispositionCommand ||
      JSON.stringify({ ...dispositionCommand, operation_id: undefined }) !==
        JSON.stringify(candidate)
    )
      dispositionCommand = { ...candidate, operation_id: crypto.randomUUID() };
    await store.commit(dispositionCommand);
    dispositionCommand = null;
    await refresh();
    dialog.close();
    notice =
      kind === "request_disposition"
        ? "Request sent to the Supervisor Hub. Incident disposition has not changed."
        : "Request declined with your reason. The original request remains in history.";
    draw();
  }

  function prepareManual(value) {
    if (!intakeDraft) { current = uid("I"); draftId = null; draftRevision = 0; }
    intakeDraft = false;
    baseRevision = 0;
    pending = [];
    const friendly = {
        "kinetic episode": "Strike event",
        "combined supported causal episode": "Attack-and-effect episode",
        "operational episode": "Operational-status episode",
        "service observation": "Service / follow-up observation",
        "research lead": "Research lead",
      },
      fid = value.facility_id || uid("F");
    creation = {
      facility_id: value.facility_id,
      incident: {
        ...value.incident,
        duplicate_reason: value.incident.distinct_reason,
        incident_label: value.incident.incident_label,
        working_type: friendly[value.working_type],
        lead: value.working_type === "research lead",
      },
    };
    if (!value.facility_id)
      creation.new_facility = {
        ...value.facility,
        facility_id: fid,
        duplicate_disposition:
          value.facility.duplicate_disposition === "not_sure"
            ? "unsure"
            : value.facility.duplicate_disposition,
        duplicate_reason:
          value.facility.duplicate_reason ||
          "Identity comparison remains unresolved; no automatic merge.",
      };
    const add = (family, subject, type, proposed, extra = {}) => {
      const c = {
        claim_id: uid("C"),
        facility_id: fid,
        claim_family: family,
        subject,
        value_type: type,
        proposed_value: proposed,
        ...extra,
      };
      pending.push({ type: "new_fact", claim: c });
      return c.claim_id;
    };
    if (!value.facility_id) {
      const ids = [
        add(
          "IDENTITY",
          "The physical facility is called " +
            value.facility.working_name +
            ".",
          "TEXT_WHERE_REQUIRED",
          value.facility.working_name,
          { requirement_category: "PHYSICAL_IDENTITY" },
        ),
        add(
          "FACILITY_TYPE",
          "The facility type is " +
            (value.facility.source_described_type || "not established") +
            ".",
          "CATEGORICAL",
          value.facility.facility_type,
          { requirement_category: "FACILITY_TYPE" },
        ),
      ];
      if (value.identityEvidence) {
        const e = value.identityEvidence,
          scopes = e.scopes || [],
          sid = uid("SRC"),
          source = { ...e.source, source_id: sid };
        let used = false;
        for (const [scope, cid] of [
          ["identity", ids[0]],
          ["type", ids[1]],
        ]) {
          if (scopes.includes(scope)) {
            pending.push({
              type: "evidence",
              claim_id: cid,
              ...(used ? { source_id: sid } : { source }),
              relation: e.relation,
              material: e.material,
              material_reason: e.material_reason,
            });
            used = true;
          }
        }
        if (scopes.includes("location"))
          creation.facility_evidence = [
            {
              ...(used ? { source_id: sid } : { source }),
              relation: e.relation,
              material: e.material,
              material_reason: e.material_reason,
              scopes: ["location"],
              location: {
                locality: value.facility.locality || null,
                coordinates:
                  value.facility.geo?.latitude != null
                    ? {
                        latitude: value.facility.geo.latitude,
                        longitude: value.facility.geo.longitude,
                      }
                    : null,
                method: value.facility.geo?.method || "UNKNOWN",
                precision: value.facility.geo?.precision || "Unknown",
                limitations:
                  value.facility.geo?.limitations ||
                  "Typed location; evidence has not received a human location review.",
              },
            },
          ];
      }
    }
    if (value.coordinateProposal) creation.facility_evidence = [...(creation.facility_evidence || []), {...value.coordinateProposal, facility_id: fid}];
    add(
      "EVENT_DATE",
      value.working_type === "service observation"
        ? "Date / period of service observation"
        : "Date / period of this recorded episode",
      value.incident.working_date.precision === "RANGE" ? "DATE_RANGE" : "DATE",
      value.incident.working_date.value,
      { date_precision: value.incident.working_date.precision },
    );
    if (
      ["kinetic episode", "combined supported causal episode"].includes(
        value.working_type,
      )
    ) {
      add(
        "KINETIC_EVENT",
        "An attack occurred in this episode.",
        "BOOLEAN",
        null,
      );
      add(
        "ATTACK_RELATIONSHIP",
        "The attack relationship to this facility.",
        "CATEGORICAL",
        value.incident.working_relationship,
      );
    }
    pending.push({
      type: "task",
      task: {
        claim_id: null,
        factual_question:
          "What does the evidence establish about this new incident?",
        reason:
          value.incident.distinct_reason ||
          "New manually entered incident requires factual review.",
        next_action: "Review the submitted facts and link relevant evidence.",
        status: "open",
        disposition: "active",
      },
    });
    view = "incident";
    dialog.close();
    notice =
      "Private starting record. Add facts and evidence, then review and submit to Team Review.";
    draw();
  }
  listen("click", async (e) => {
    const el = e.target.closest("[data-action]");
    if (!el || busy) return;
    const action = el.dataset.action;
    try {
      setBusy(true);
      if (autosave.running) {
        // A failed save must not prevent the researcher from fixing or
        // discarding private work. Writes still use the acknowledged revision.
        if (["remove-submission-item", "reload-saved-draft", "confirm-reload-draft", "delete-draft", "confirm-delete-draft"].includes(action))
          await autosave.running.catch(() => {});
        else await autosave.running;
      }
      checkpoint();
      if (action === "scientific-corrections") {
        await openCorrections(el);
        return;
      }
      if (action === "analytics") {
        if (s.profile.role !== "supervisor")
          throw Error("Supervisor access required.");
        analyticsOpen = !analyticsOpen;
        onAnalytics(analyticsOpen ? "open" : "close");
        draw();
        return;
      }
      if (analyticsOpen && action === "refresh") {
        onAnalytics("refresh");
        return;
      }
      if (
        analyticsOpen &&
        ["queue", "supervisor", "validated"].includes(action)
      ) {
        analyticsOpen = false;
        onAnalytics("close");
        draw();
      }
      const blocked = actionLock(s, el, current, view);
      if (blocked.locked) throw Error(lockMessage(blocked));
      if (action === "disposition-start") {
        await beginDisposition(
          el.dataset.targetType,
          el.dataset.targetId,
          el.dataset.dispositionAction,
        );
        return;
      }
      if (action === "disposition-confirm") {
        if (!dispositionFlow)
          throw Error("Open the disposition decision again.");
        dispositionFlow.override = Boolean(
          dialog.querySelector("#disposition-override")?.checked,
        );
        modal("Record supervisor decision", decisionForm(s, dispositionFlow));
        return;
      }
      if (action === "disposition-request") {
        if (s.profile.role !== "researcher")
          throw Error("Only researchers submit disposition requests.");
        dispositionCommand = null;
        modal(
          "Request incident disposition",
          `<form id="disposition-request-form" data-requested-action="${h(el.dataset.requestedAction)}"><p>Request ${el.dataset.requestedAction === "DEFER" ? "deferral" : "approval"} for this incident. This sends a pending flag to the supervisor; it does not change the incident.</p><label>Explain your request<textarea name="explanation" required maxlength="4000"></textarea></label><button type="submit" class="primary">Send request</button></form>`,
        );
        return;
      }
      if (
        ["disposition-accept-request", "disposition-decline-request"].includes(
          action,
        )
      ) {
        const row = (s.disposition_requests || []).find(
          (x) => x.id === el.dataset.requestId && x.status === "PENDING",
        );
        if (s.profile.role !== "supervisor" || !row)
          throw Error(
            "This pending request is not available to this supervisor.",
          );
        if (action === "disposition-accept-request") {
          await openIncident(row.incident_id, "supervisor-detail");
          if (current === row.incident_id)
            await beginDisposition(
              "incident",
              row.incident_id,
              row.requested_action,
              row.id,
            );
        } else {
          dispositionCommand = null;
          modal(
            "Decline incident disposition request",
            `<form id="disposition-decline-form" data-request-id="${h(row.id)}" data-incident-id="${h(row.incident_id)}"><p>${h(row.requested_action)} · ${h(row.explanation)}</p><label>Supervisor decline reason<textarea name="reason" required maxlength="4000"></textarea></label><button type="submit" class="primary">Decline request</button></form>`,
          );
        }
        return;
      }
      if (action === "source-return") {
        sourceInspection.resume();
        return;
      }
      if (action === "disposition-resume") {
        const saved = dispositionResume;
        if (!saved) throw Error("Open the decision again.");
        modal(saved.title, saved.html);
        for (const field of saved.fields) {
          const input = [
            ...dialog.querySelectorAll("input,select,textarea"),
          ].find((x) => x.name === field.name && x.type === field.type);
          if (!input) continue;
          input.value = field.value;
          if (field.type === "checkbox") input.checked = field.checked;
        }
        updateDecisionSubmit(dialog);
        return;
      }
      if (action.startsWith("supervisor") && s.profile.role !== "supervisor")
        throw Error("Only a supervisor can open the Supervisor Hub.");
      if (action === "delete-draft") {
        if (formDirty) throw Error("Finish or close the unfinished form before discarding a draft.");
        const id = el.dataset.id || draftId;
        const d = s.drafts.find((d) => (d.id || d.draft_id) === id);
        if (!d) throw Error("Draft no longer available. Refresh.");
        const revision = id === draftId ? draftRevision : d.revision;
        modal(
          "Discard entire private draft?",
          `<p>All changes in this private draft will be discarded. You cannot restore the draft after discarding it. Shared research is unchanged.</p><div class="dialog-actions"><button data-action="close-dialog">Keep draft</button><button class="danger" data-action="confirm-delete-draft" data-id="${h(id)}" data-revision="${revision}">Discard entire draft</button></div>`,
        );
      } else if (action === "confirm-delete-draft") {
        const id = el.dataset.id;
        await store.deleteDraft(id, Number(el.dataset.revision));
        s.drafts = s.drafts.filter((d) => (d.id || d.draft_id) !== id);
        for (const [key, saved] of checkpoints)
          if (saved.draftId === id) checkpoints.delete(key);
        if (draftId === id) {
          if (creation || intakeDraft) {
            current = null;
            view = "queue";
          }
          pending = [];
          creation = null;
          intakeDraft = false;
          facilityCommand = null;
          pendingEditor = null;
          request = null;
          draftId = null;
          draftRevision = 0;
          baseRevision = s.revisions.INCIDENT[current] || 0;
          autosave.restore(null);
        }
        dialog.close();
        notice = "Entire private draft discarded. Shared research is unchanged.";
        draw();
      } else if (action === "reload-saved-draft") {
        modal(
          "Reload saved draft",
          '<p>Your unsaved working proposal will be replaced by the latest saved private draft. Shared research is unchanged.</p><button data-action="confirm-reload-draft">Replace working proposal with saved draft</button>',
        );
      } else if (action === "confirm-reload-draft") {
        await refresh();
        const d = s.drafts.find((d) => (d.id || d.draft_id) === draftId);
        if (!d)
          throw Error(
            "The saved draft no longer exists. Your working proposal is retained.",
          );
        if (restoreIntakeDraft(d)) return;
        pending = clone(d.payload.changes || []);
        creation = clone(d.payload.creation);
        facilityCommand = clone(d.payload.facilityCommand || null);
        baseRevision = d.payload.expected_revision;
        draftRevision = d.revision;
        request = null;
        autosave.restore(payload());
        dialog.close();
        notice =
          "Saved private draft reloaded at revision " + draftRevision + ".";
        draw();
      } else if (action === "close-dialog") {
        if(formDirty && !confirm('Discard this unfinished form? It has not been added to your private draft.')) return;
        if (sourceInspection.resume()) return;
        assignmentCommand = null;
        phase2Command = null;
        dispositionFlow = null;
        dispositionResume = null;
        dialog.close();
      } else if (action === "refresh") {
        await refresh();
        if (current && !pending.length && !creation)
          baseRevision = s.revisions.INCIDENT[current];
        notice = pending.length
          ? "Latest shared state loaded. Your private proposals remain unchanged; submission still checks the revision you started from."
          : "Latest available research loaded.";
        draw();
      } else if (action === "remove-submission-item") {
        if (formDirty) throw Error("Finish or close the unfinished form before removing private changes.");
        const plan = planPrivateChangeRemoval(
          pending, Number(el.dataset.index), s.records.SOURCE.map(source => source.source_id),
        );
        const dependentCount = plan.removedCount - 1;
        if (!confirm(dependentCount
          ? `Remove this private change and ${dependentCount} dependent ${dependentCount === 1 ? "change" : "changes"}? Other private changes and shared research will stay in place.`
          : "Remove this private change? Other private changes and shared research will stay in place.")) return;
        const reviewing = dialog.open;
        pending = plan.changes;
        pendingEditor = null;
        request = null;
        notice = dependentCount ? "Private change and dependent changes removed from this working draft."
          : "Private change removed from this working draft.";
        draw();
        if (reviewing) reviewChanges();
        else (root.querySelector('.private-proposals [data-action="remove-submission-item"]') ||
          root.querySelector('.private-action-bar [data-action="review-changes"]'))?.focus({ preventScroll: true });
        if (payload()) await autosave.flush({ retry: true });
      } else if (action === "open") {
        const fromIntake = !!dialog.querySelector('#manual-form');
        await openIncident(el.dataset.id);
        if (fromIntake && current === el.dataset.id) dialog.close();
      }
      else if (action === "supervisor-detail")
        await openIncident(el.dataset.id, "supervisor-detail");
      else if (action === "validated-detail")
        await openIncident(el.dataset.id, "validated-detail");
      else if (["queue", "validated", "supervisor"].includes(action)) {
        if (!(await leave())) return;
        await refresh();
        view = action;
        current = null;
        draw();
        window.scrollTo(0, 0);
      } else if (action === "facility") {
        if (!(await leave())) return;
        current = el.dataset.id;
        view = "facility";
        draw();
        window.scrollTo(0, 0);
      } else if (action === "new-incident") {
        if (!(await leave())) return;
        current = null; draftId = null; draftRevision = 0; intakeDraft = false;
        modal(
          "Add incident — choose the facility first",
          F.manualForm(
            s.records.FACILITY.filter(
              (f) =>
                s.workflow?.facilities?.[f.facility_id]?.resolution?.outcome !==
                "same",
            ).map((f) => ({
              ...f,
              facility_type: facilityType(s, f.facility_id),
            })),
            {
              incidents: incidentComparisons(s),
              links: s.records.INCIDENT_FACILITY,
              prefillFacilityId: el.dataset.facility,
              sources: s.records.SOURCE,
            },
          ),
        );
      } else if (action === "save-intake-draft") {
        const form = dialog.querySelector('#manual-form');
        const raw = F.captureIntake(form);
        draftId ??= crypto.randomUUID(); current ??= uid('I');
        const title = form.elements.incident_label.value.trim() || form.elements.working_name.value.trim() || 'Unfinished incident intake';
        const d = await store.saveDraft(draftId, draftRevision, {incident_id:current,title,expected_revision:0,creation:{intake_form:raw},changes:[],facilityCommand:null});
        draftRevision=d.revision; await refresh(); dialog.close(); current=null; creation=null; pending=[]; view='queue';
        notice='Private intake saved. No shared facility, incident or factual decision was created.'; draw();
      } else if (action === "review") reviewFactById(el.dataset.claim);
      else if (action === "evidence" || action === "add-evidence") {
        if (view === "facility") {
          const c = s.records.CLAIM.find(
            (c) => c.claim_id === el.dataset.claim,
          );
          current = c.incident_id;
          baseRevision = s.revisions.INCIDENT[current];
          view = "incident";
          draw();
        }
        evidenceDialog(el.dataset.claim);
      } else if (action === "supervisor-readiness") {
        await openIncident(el.dataset.id, "supervisor-detail");
        document.getElementById("completion-readiness")?.scrollIntoView();
      } else if (action === "supervisor-assignee") {
        supervisorAssignee = el.dataset.value || "";
        supervisorFilter = "all";
        draw();
        document.getElementById("supervisor-work-queue")?.scrollIntoView();
      } else if (action === "supervisor-filter") {
        supervisorFilter = el.dataset.value;
        draw();
      } else if (action === "supervisor-activity") {
        if (!(await leave())) return;
        await refresh();
        view = "supervisor";
        current = null;
        activityFilters = { ...activityFilters, incident: el.dataset.id || "" };
        draw();
        document.getElementById("supervisor-recent-activity")?.scrollIntoView();
      } else if (action === "open-fact") {
        phase2Command = null;
        const fact = s.records.CLAIM.find(
            (c) => c.claim_id === el.dataset.claim,
          ),
          target = fact?.incident_id || el.dataset.id;
        await openIncident(target);
        if (current === target && view === "incident")
          reviewFactById(el.dataset.claim);
      } else if (action === "open-task") {
        if (dialog.open) {
          phase2Command = null;
          dialog.close();
        }
        await openIncident(el.dataset.id);
        const card = document.querySelector(
          '[data-task-id="' + CSS.escape(el.dataset.task) + '"]',
        );
        if (card) {
          disclosures.reveal(card);
          card.open = true;
          card.scrollIntoView();
        }
      } else if (action === "assign-case") {
        const currentControl = () => !pendingHistory && root.contains(el);
        if (currentControl() && await leave() && currentControl())
          assignmentDialog(el.dataset.id);
      } else if (action === "submit-assignment") {
        if (!pendingHistory && dialog.contains(el)) await submitAssignment();
      } else if (action === "phase2-readiness") {
        await openIncident(el.dataset.id, "supervisor-detail");
        document.getElementById("phase2-readiness")?.scrollIntoView();
      } else if (action === "phase2-approve") await phase2Dialog(el.dataset.id);
      else if (action === "phase2-revoke")
        await phase2Dialog(el.dataset.id, true);
      else if (action === "submit-phase2") await submitPhase2();
      else if (action === "export-validated-csv") await exportValidated();
      else if (action === "export-context-csv") await exportValidated(true);
      else if (action === "export-gis-full") await prepareGIS("full");
      else if (action === "download-gis-package") throw Error("The companion presentation ZIP is deferred pending hosted delivery validation. The existing CSV downloads remain available.");
      else if (action === "export-gis-simplified") await prepareGIS("simplified");
      else if (action === "download-gis-csv") await downloadGIS("csv");
      else if (action === "download-gis-receipt") await downloadGIS("receipt");
      else if (action === "export-research-package") {
        el.disabled = true;
        try {
          const response = await fetch("/api/research-export", {
            cache: "no-store",
            signal: AbortSignal.timeout(30_000),
          }).catch(() => null);
          if (!response || response.status === 429 || response.status >= 500)
            throw Error("The research export is temporarily unavailable. Please try again shortly.");
          if (response.status === 413)
            throw Error("The research package exceeds the download limit. Ask the project owner for help.");
          if (response.status === 401)
            throw Error("Sign in again to download the research package.");
          if (!response.ok)
            throw Error("The research export could not be downloaded.");
          const blob = await response.blob().catch(() => null);
          if (!blob)
            throw Error("The research export is temporarily unavailable. Please try again shortly.");
          const url = URL.createObjectURL(blob), a = document.createElement("a");
          a.href = url;
          a.download =
            response.headers
              .get("content-disposition")
              ?.match(/filename="([^"]+)"/)?.[1] || "research-export.zip";
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } finally {
          el.disabled = false;
        }
        notice =
          "Portable research package exported from the current eligible dataset.";
        draw();
      } else if (action === "queue-filter") {
        queueFilter = el.dataset.value;
        draw();
      } else if (action === "confirm-facility") {
        notice =
          "Facility context checked for this session. No factual certification was recorded.";
        draw();
      } else if (action === "note") {
        modal(
          "Add note / context",
          `<p>Reviewer notes belong with the fact review. Evidence notes belong with the relevant source. Neither creates a new verified fact.</p><div class="note-route">${allFacts()
            .map(
              (c) =>
                `<button data-action="review" data-claim="${h(c.claim_id)}">Reviewer note · ${h(factLabel(c))}</button>`,
            )
            .join(
              "",
            )}<button data-action="add-evidence">Evidence note / limitations</button></div>`,
        );
      } else if (action === "reopen-facility-identity") {
        await reopenFacilityIdentityDialog(
          el.dataset.facility,
          el.dataset.resolution,
        );
      } else if (action === "resolve-identity-guide") {
        modal("Resolve Facility Identity", renderIdentityGuide(s,el.dataset.facility));
      } else if (
        action === "facility-resolution" ||
        action === "location-review" ||
        action === "location-proposal" ||
        action === "facility-association" ||
        action === "facility-evidence"
      ) {
        if (["location-review", "facility-association"].includes(action)) throw Error("Geographic and physical-association decisions are deferred for this launch. Evidence proposals remain available and do not approve coordinates.");
        if (!(await leave())) return;
        const fid = el.dataset.facility,
          f = {
            ...s.records.FACILITY.find((f) => f.facility_id === fid),
            facility_type: facilityType(s, fid),
          };
        dialog.dataset.facility = fid;
        modal(
          action === "facility-resolution"
            ? "Review facility identity"
            : action === "location-review"
              ? "Review facility location"
              : action === "location-proposal" ? "Propose facility coordinates"
              : action === "facility-association" ? "Review physical facility association"
              : "Add facility evidence",
          action === "facility-resolution"
            ? F.facilityResolutionForm(f, s.records.FACILITY, s.records.SOURCE)
            : action === "location-review"
              ? F.locationForm(f, s.records.SOURCE, locationReviewInput(f))
              : action === "location-proposal" ? F.locationProposalForm(f, s.records.SOURCE)
              : action === "facility-association" ? F.facilityAssociationForm(f, s.records.INCIDENT_FACILITY.find(l => l.incident_facility_id === el.dataset.link), s.records.SOURCE, s.records.CLAIM)
              : F.facilityEvidenceForm(
                  f,
                  s.records.SOURCE,
                  s.records.CLAIM.filter(
                    (c) => c.facility_id === fid && c.is_current !== false,
                  ),
                ),
        );
        dialog.dataset.facility = fid;
      } else if (action === "save-facility-draft") await saveFacilityDraft();
      else if (action === "submit-facility") await submitFacility();
      else if (action === "new-fact")
        modal(
          "Add fact",
          F.newFactForm(allFacts(), {
            family: el.dataset.family,
            value_type: el.dataset.valueType,
          }),
        );
      else if (action === "task") {
        const gap = tasks(s).find((g) => g.gap_task_id === el.dataset.id) || {
          claim_id: el.dataset.claim,
          ...(el.dataset.metadataReview ? {factual_question:"Does the current case description or working classification need review?",next_action:"Compare the current case wording with the specific source-supported finding. Record the proposed correction and its evidence for an authorized review; preserve current metadata until then.",reason:"Case metadata and individual factual validation are separate."} : {}),
        };
        modal("What Still Needs Checking", F.taskForm(gap));
        dialog.dataset.gap = gap.gap_task_id || "";
        dialog.dataset.claim = gap.claim_id || "";
      } else if (action === "source") {
        sourceInspection.open((canReturn) =>
          modal(
            "Source details",
            V.renderSourceDetails(
              sourceState(el.dataset.claim),
              el.dataset.id,
              el.dataset.claim,
              el.dataset.relation,
            ) +
              (canReturn
                ? '<div class="dialog-actions"><button type="button" data-action="source-return">Return to review</button><span class="subtle">Your unfinished inputs are kept.</span></div>'
                : ""),
          ),
        );
      } else if (action === "edit-pending") {
        const index = Number(el.dataset.index), item = pending[index];
        const returnToReview = dialog.contains(el);
        if (!item) throw Error('This private item is no longer available. Reopen your draft.');
        const lock = incidentLock(s, current);
        if (lock.locked) throw Error(lockMessage(lock));
        const fact = factLock(s, item.claim_id || item.claim?.claim_id);
        if (fact.locked) throw Error(lockMessage(fact));
        const editor = draftEditor(item, pending, s, allFacts());
        modal('Edit private change', editor.html);
        const form = dialog.querySelector('#draft-edit-form');
        form.noValidate = true;
        form.querySelector('[type="submit"]')?.remove();
        form.insertAdjacentHTML('beforeend', '<p role="alert" class="form-error" hidden></p><div class="dialog-actions"><button type="submit" class="primary">Update private change</button></div>');
        pendingEditor = {index, item, returnToReview, read: editor.bind(form)};
      } else if (action === "review-changes") reviewChanges();
      else if (action === "save-draft") {
        if (facilityCommand) await saveFacilityDraft();
        else await saveDraft();
      } else if (action === "submit") await submit();
      else if (action === "submit-evidence") await submit(true);
      else if (action === "requirements") requirementDialog();
      else if (action === "complete") {
        if (el.dataset.id && el.dataset.id !== current)
          await openIncident(el.dataset.id, "supervisor-detail");
        await beginDisposition(
          "incident",
          current,
          "APPROVE",
          null,
          el.dataset.mode === "override",
        );
      } else if (action === "reopen") {
        if (el.dataset.id && el.dataset.id !== current)
          await openIncident(el.dataset.id, "supervisor-detail");
        await beginDisposition("incident", current, "REOPEN");
      } else if (action === "discard") {
        checkpoints.delete(historyKey);
        autosave.restore(null);
        intakeDraft=false;
        pending = [];
        creation = null;
        facilityCommand = null;
        phase2Command = null;
        request = null;
        draftId = null;
        draftRevision = 0;
        current = null;
        view = "queue";
        dialog.close();
        notice =
          "Private working changes discarded. Saved draft copies, if any, remain available.";
        draw();
      } else if (action === "resume") {
        if (!(await leave())) return;
        const d = s.drafts.find((d) => (d.id || d.draft_id) === el.dataset.id);
        draftId = d.id || d.draft_id;
        draftRevision = d.revision;
        if (restoreIntakeDraft(d)) return;
        pending = clone(d.payload.changes || []);
        creation = clone(d.payload.creation);
        facilityCommand = clone(d.payload.facilityCommand || null);
        current = d.payload.incident_id;
        baseRevision = d.payload.expected_revision;
        view = facilityCommand ? "facility" : "incident";
        if (facilityCommand) current = facilityCommand.payload.facility_id;
        autosave.restore(payload());
        notice =
          "Private draft restored. Submission will check the shared revision.";
        draw();
        if (facilityCommand) reviewFacility();
        else {
          // The incident can be long. Bring the restored editable proposal into
          // view instead of leaving its controls below all shared fact sections.
          const edit = root.querySelector('.private-proposals [data-action="edit-pending"]');
          edit?.focus({preventScroll:true});
          edit?.scrollIntoView({block:'center'});
        }
      } else if (action === "reset") {
        modal(
          "Reset local preview",
          `<p>This clears local preview submissions and private drafts and reloads the unchanged approved seed.</p><button data-action="confirm-reset">Reset local preview</button>`,
        );
      } else if (action === "confirm-reset") {
        await store.reset();
        await refresh();
        pending = [];
        creation = null;
        facilityCommand = null;
        phase2Command = null;
        draftId = null;
        draftRevision = 0;
        current = null;
        view = "queue";
        dialog.close();
        notice = "Local preview reset.";
        draw();
      } else if (action === "logout") {
        if((hasUnsecuredWork() || hasSuspendedWork()) && !confirm('Sign out and discard unsaved work in this tab? Preserve unfinished text first.')) return;
        autosave.stop(); formDirty=false; checkpoints.clear();
        try {
          await store.logout();
        } finally {
          location.reload();
        }
      } else if (action === "reload-latest") {
        await refresh();
        baseRevision = s.revisions.INCIDENT[current];
        if (phase2Command) {
          phase2Command.operation_id = crypto.randomUUID();
          phase2Command.expected_revision =
            s.revisions.INCIDENT[phase2Command.incident_id];
          phase2Command.payload.expected_approval_revision =
            s.phase2_approvals?.[phase2Command.incident_id]?.revision || 0;
        }
        if (assignmentCommand) {
          assignmentCommand.operation_id = crypto.randomUUID();
          assignmentCommand.expected_revision =
            s.revisions.INCIDENT[assignmentCommand.incident_id];
          assignmentCommand.payload.expected_assignment_revision =
            caseAssignment(s, assignmentCommand.incident_id)?.revision || 0;
        }
        if (facilityCommand?.kind === "reopen_facility_identity") {
          const ctx = facilityIdentityReopeningContext(
            s,
            facilityCommand.payload.resolution_id,
          );
          if (!ctx || !ctx.is_current)
            throw Error(
              "This decision has already changed. Inspect its current history before reopening.",
            );
          facilityCommand = {
            ...facilityCommand,
            operation_id: crypto.randomUUID(),
            incident_id: ctx.incident_id,
            expected_revision: ctx.expected_revision,
            payload: { ...ctx.payload, reason: facilityCommand.payload.reason },
          };
        } else if (facilityCommand) {
          const p = facilityCommand.payload;
          facilityCommand.expected_revision =
            s.revisions.INCIDENT[facilityCommand.incident_id];
          p.expected_facility_revision = s.revisions.FACILITY[p.facility_id];
          if (p.target_facility_id)
            p.expected_target_revision =
              s.revisions.FACILITY[p.target_facility_id];
          p.incident_revisions = Object.fromEntries(
            s.records.INCIDENT_FACILITY.filter(
              (x) => x.facility_id === p.facility_id && x.is_current !== false,
            ).map((x) => [x.incident_id, s.revisions.INCIDENT[x.incident_id]]),
          );
          facilityCommand.operation_id = crypto.randomUUID();
        }
        request = null;
        notice =
          "Latest record loaded. Review your private proposal against the new values before submitting.";
        dialog.close();
        draw();
        if (facilityCommand) reviewFacility();
        else if (assignmentCommand) reviewAssignment();
        else if (phase2Command) reviewPhase2();
      }
    } catch (err) {
      showError(err);
      if (err.code === "DISPOSITION_LOCKED") {
        await refresh().catch(() => {});
        draw();
        if (
          pending.length &&
          dialog.open &&
          !dialog.querySelector("[data-disposition-save]")
        )
          dialog
            .querySelector(".dialog-body")
            .insertAdjacentHTML(
              "beforeend",
              '<p>Your staged changes are still private. Save them to continue after supervisor reopening.</p><button data-disposition-save data-action="save-draft">Save private draft</button>',
            );
      }
      if (err.code !== "DRAFT_CONFLICT" && /revision|changed|stale/i.test(err.message) && dialog.open)
        dialog
          .querySelector(".dialog-body")
          .insertAdjacentHTML(
            "beforeend",
            '<button data-action="reload-latest">Load latest record and review again</button>',
          );
    } finally {
      setBusy(false);
      autosave.update(payload());
      saveState();
    }
  });
  listen("input", (e) => {
    if (e.target.matches('[data-identity-search]')) {
      const term=e.target.value.trim().toLocaleLowerCase();
      for (const row of dialog.querySelectorAll('[data-identity-match]')) row.hidden=!row.dataset.matchText.includes(term);
      return;
    }
    updateDecisionSubmit(dialog);
    if (e.target.id === "phase2-search") {
      phase2Search = e.target.value;
      const caret = e.target.selectionStart;
      draw();
      const input = document.getElementById("phase2-search");
      input?.focus({ preventScroll: true });
      input?.setSelectionRange(caret, caret);
    }
    if (e.target.id === "supervisor-search") {
      supervisorSearch = e.target.value;
      const caret = e.target.selectionStart;
      draw();
      const input = document.getElementById("supervisor-search");
      input?.focus({ preventScroll: true });
      input?.setSelectionRange(caret, caret);
    }
  });
  listen("change", async (e) => {
    try {
      updateDecisionSubmit(dialog);
      if (e.target.matches("[data-phase2-filter]")) {
        phase2Filter = e.target.value;
        draw();
        return;
      }
      if (e.target.matches("[data-supervisor-filter]")) {
        supervisorFilter = e.target.value;
        draw();
        return;
      }
      if (e.target.matches("[data-supervisor-assignee]")) {
        supervisorAssignee = e.target.value;
        draw();
        return;
      }
      if (e.target.matches("[data-activity-filter]")) {
        activityFilters = {
          ...activityFilters,
          [e.target.dataset.activityFilter]: e.target.value,
        };
        draw();
        document.getElementById("supervisor-recent-activity")?.scrollIntoView();
        return;
      }
      if (e.target.id === "preview-identity") {
        if (
          pending.length ||
          creation ||
          facilityCommand ||
          assignmentCommand ||
          phase2Command
        ) {
          e.target.value = store.identity;
          await leave();
          return;
        }
        await store.switchUser(e.target.value);
        await refresh();
        notice =
          "Preview identity changed. Only that researcher’s private drafts are shown.";
        draw();
      }
      if (
        e.target.matches("[data-source-reuse]") &&
        e.target.name === "existing_source"
      ) {
        if (!e.target.value) {
          dialog.querySelector('#source-entry').innerHTML=F.renderSource('evidence');
          F.bindForm(dialog); return;
        }
        const source = s.records.SOURCE.find(
          (x) => x.source_id === e.target.value,
        );
        dialog.querySelector("#source-entry").innerHTML =
          '<p class="callout">You are reusing the recorded source. Its identity and saved source details remain unchanged. Enter the passage and relationship relevant to this fact below.</p>' +
          F.renderSource("evidence", { source });
        const relationshipFields = new Set(['relationship','locator','excerpt','limitations','directness','originality','relies','underlying','dependency','material','material-reason']);
        for (const field of dialog.querySelectorAll('#source-entry [name]'))
          if (!relationshipFields.has(field.name.replace(/^evidence-/,''))) field.disabled=true;
        F.bindForm(dialog);
      }
    } catch (err) {
      showError(err);
    }
  });
  listen("submit", async (e) => {
    if (!e.target.closest("#dialog") || busy) return;
    e.preventDefault();
    const form = e.target;
    try {
      setBusy(true);
      if(autosave.running) await autosave.running.catch(()=>{});
      if (form.id === "draft-edit-form") {
        const edit = pendingEditor;
        if (!edit || pending[edit.index] !== edit.item) throw Error('The pending list changed. Reopen Edit; your inputs have not been saved.');
        const lock = incidentLock(s, current);
        if (lock.locked) throw Error(lockMessage(lock));
        const fact = factLock(s, edit.item.claim_id || edit.item.claim?.claim_id);
        if (fact.locked) throw Error(lockMessage(fact));
        const {replacement, sourceOwner, source} = edit.read();
        if (pending.some((x, i) => i !== edit.index && evidenceSignature(x) === evidenceSignature(replacement)))
          throw Error('An identical change already exists in this private draft.');
        if (sourceOwner && sourceOwner !== edit.item) sourceOwner.source = source;
        pending[edit.index] = replacement;
        pendingEditor = null;
        request = null;
        notice = 'Private change updated. Save private draft to retain this revision. Nothing has been shared.';
        dialog.close();
        draw();
        if (edit.returnToReview) reviewChanges();
      } else if (form.id === "disposition-review-form") {
        if (!dispositionFlow || dispositionFlow.action !== "APPROVE")
          throw Error("Open the approval decision again.");
        const fact = s.records.CLAIM.find(
          (c) => c.claim_id === dispositionFlow.target_id,
        );
        dispositionFlow.review = { type: "review", ...F.readFact(form, fact) };
        modal(
          "Approve the displayed determination",
          decisionForm(s, dispositionFlow),
        );
      } else if (form.id === "disposition-decision-form") {
        if (!dispositionFlow)
          throw Error("Open the disposition decision again.");
        const fd = new FormData(form),
          reason = String(fd.get("disposition_reason") || "").trim(),
          attestation = fd.has("disposition_attestation");
        if (!reason || (dispositionFlow.action !== "REOPEN" && !attestation))
          throw Error(
            "Supply a written reason and check the review attestation.",
          );
        const {
          target_type,
          target_id,
          action,
          expected_target_revision,
          review,
          override,
          request_id,
        } = dispositionFlow;
        await commitDisposition({
          target_type,
          target_id,
          action,
          expected_target_revision,
          reason,
          attestation,
          ...(review ? { review } : {}),
          ...(target_type === "incident" && action === "APPROVE"
            ? { override }
            : {}),
          ...(request_id ? { request_id } : {}),
        });
      } else if (form.id === "disposition-request-form") {
        const explanation = String(
          new FormData(form).get("explanation") || "",
        ).trim();
        if (!explanation)
          throw Error("Explain why you are requesting this decision.");
        await submitRequest("request_disposition", {
          requested_action: form.dataset.requestedAction,
          explanation,
        });
      } else if (form.id === "disposition-decline-form") {
        const reason = String(new FormData(form).get("reason") || "").trim();
        if (!reason)
          throw Error("Record the reason for declining this request.");
        await submitRequest(
          "decline_disposition_request",
          { request_id: form.dataset.requestId, reason },
          form.dataset.incidentId,
        );
      } else if (form.id === "facility-identity-reopen-form") {
        const ctx = dialog.reopeningContext;
        if (!ctx)
          throw Error(
            "Open the current facility identity decision before continuing.",
          );
        const entered = F.readFacilityIdentityReopen(form, ctx.source);
        facilityCommand = {
          operation_id: crypto.randomUUID(),
          incident_id: ctx.incident_id,
          expected_revision: ctx.expected_revision,
          kind: "reopen_facility_identity",
          payload: { ...clone(ctx.payload), reason: entered.reason },
        };
        reviewFacility();
      } else if (form.id === "phase2-form") {
        const fd = new FormData(form),
          reason = String(fd.get("reason") || "").trim();
        if (!reason) throw Error("Explain the supervisor decision.");
        phase2Command = {
          operation_id: crypto.randomUUID(),
          incident_id: form.dataset.incident,
          expected_revision: Number(form.dataset.revision),
          kind: form.dataset.kind,
          payload: {
            expected_approval_revision: Number(form.dataset.approvalRevision),
            reason,
            mode: fd.get("mode") || "approve",
          },
        };
        reviewPhase2();
      } else if (form.id === "assignment-form") {
        if (pendingHistory || !dialog.contains(form)) return;
        const fd = new FormData(form);
        const members = fd.getAll("assigned_researchers").map(String);
        if (members.some((id) => !s.team?.some((p) => p.user_id === id && p.active !== false && p.role === "researcher")))
          throw Error("Remove unavailable assignees before saving. Choose active researchers only.");
        assignmentCommand = {
          operation_id: crypto.randomUUID(),
          incident_id: form.dataset.incident,
          expected_revision: Number(form.dataset.revision),
          kind: "assign_case",
          payload: {
            assigned_researchers: members,
            assignment_note: String(fd.get("assignment_note") || "").trim(),
            expected_assignment_revision: Number(
              form.dataset.assignmentRevision,
            ),
          },
        };
        if (!assignmentCommand.payload.assignment_note)
          throw Error("Explain this assignment decision.");
        reviewAssignment();
      } else if (
        [
          "facility-resolution-form",
          "location-review-form",
          "location-proposal-form",
          "facility-association-form",
          "facility-evidence-form",
        ].includes(form.id)
      ) {
        const fid = dialog.dataset.facility,
          f = s.records.FACILITY.find((f) => f.facility_id === fid),
          kind =
            form.id === "facility-resolution-form"
              ? "resolve_facility"
              : form.id === "location-review-form"
                ? "review_location"
                : form.id === "facility-association-form" ? "review_facility_association" : "facility_evidence",
          payload =
            kind === "resolve_facility"
              ? F.readFacilityResolution(form, f)
              : kind === "review_location"
                ? F.readLocation(form, f)
                : form.id === "location-proposal-form" ? F.readLocationProposal(form, f) : form.id === "facility-association-form" ? F.readFacilityAssociation(form, f, s.records.INCIDENT_FACILITY.find(l => l.incident_facility_id === form.dataset.link)) : F.readFacilityEvidence(form, f);
        stageFacility(kind, payload, fid);
      } else if (form.id === "manual-form") prepareManual(F.readManual(form));
      else if (form.id === "fact-form") {
        const c =
          allFacts().find((c) => c.claim_id === dialog.dataset.claim) ||
          s.records.CLAIM.find((c) => c.claim_id === dialog.dataset.claim);
        if (!c)
          throw Error(
            "The fact is no longer available. Refresh the case before reviewing.",
          );
        stage([{ type: "review", ...F.readFact(form, c) }]);
      } else if (form.id === "new-fact-form") {
        const x = F.readNewFact(form),
          cid = uid("C");
        stage([
          {
            type: "new_fact",
            claim: {
              ...x.claim,
              claim_id: cid,
              facility_id: facilityFor(visibleState(), current)?.facility_id,
            },
            distinct_reason: x.distinct_reason,
          },
          ...(x.evidence || []).map((e) => ({
            type: "evidence",
            claim_id: cid,
            ...e,
          })),
        ]);
        reviewChanges();
      } else if (form.id === "evidence-form") {
        if (form.dataset.evidenceQueued === "true") return;
        const lock = incidentLock(s, current);
        if (lock.locked) throw Error(lockMessage(lock));
        const fd = new FormData(form),
          ids = fd.get("claim_id") ? [fd.get("claim_id")] : fd.getAll("claims");
        if (!ids.length) throw Error("Choose the fact this source relates to.");
        for (const id of ids) {
          if (!allFacts().some((claim) => claim.claim_id === id))
            throw Error("This fact is no longer available in the current incident. Reopen Add evidence and choose its exact fact.");
          const fact = factLock(s, id);
          if (fact.locked) throw Error(lockMessage(fact));
        }
        const reuse = fd.get("existing_source"),
          x = F.readSource(form, "evidence", {reuse:!!reuse});
        if (reuse && !s.records.SOURCE.some((source) => source.source_id === reuse))
          throw Error("The selected source is no longer available. Choose a recorded source again.");
        const duplicate = pending.some((item) => {
          if (item.type !== "evidence" || !ids.includes(item.claim_id)) return false;
          const queuedSource = item.source || pending.find((entry) => entry.source?.source_id === item.source_id)?.source;
          const sameSource = reuse
            ? (item.source_id || item.source?.source_id) === reuse
            : queuedSource && evidenceSignature({ ...queuedSource, source_id: undefined }) === evidenceSignature(x.source);
          return sameSource && evidenceSignature(item.relation) === evidenceSignature(x.relation) &&
            item.material === x.material && item.material_reason === x.material_reason;
        });
        if (duplicate)
          throw Error("This evidence is already in your private changes for a selected fact. Review those changes before adding it again.");
        const sid = reuse || uid("SRC");
        form.dataset.evidenceQueued = "true";
        stage(
          ids.map((claim_id, index) => ({
            type: "evidence",
            claim_id,
            ...(reuse || index
              ? { source_id: sid }
              : { source: { ...x.source, source_id: sid } }),
            relation: x.relation,
            material: x.material,
            material_reason: x.material_reason,
          })),
          "Evidence added to your private changes. Not shared yet: review changes to submit, or save a private draft.",
        );
        // Wait for dialog focus restoration and the redrawn disclosure layout.
        // Otherwise the browser can restore the old fact-card scroll position.
        const queuedIncident = current, queuedNotice = notice;
        window.requestAnimationFrame(() => {
          if (!alive || dialog.open || current !== queuedIncident || notice !== queuedNotice) return;
          const box = document.getElementById("notice");
          if (!box || box.hidden) return;
          box.tabIndex = -1;
          box.focus({ preventScroll: true });
          box.scrollIntoView({ block: "center", behavior: "instant" });
        });
      } else if (form.id === "task-form") {
        const gap = tasks(s).find(
          (g) => g.gap_task_id === dialog.dataset.gap,
        ) || { claim_id: dialog.dataset.claim || null };
        stage([{ type: "task", ...F.readTask(form, gap) }]);
      } else if (form.id === "requirements-form") {
        const fd = new FormData(form),
          required = fd.getAll("required"),
          dispositions = {};
        for (const c of completionClaims(s, current)) {
          const d = fd.get("disposition-" + c.claim_id),
            reason = fd.get("reason-" + c.claim_id);
          if (d) {
            if (!reason?.trim())
              throw Error("Explain every explicit disposition.");
            dispositions[c.claim_id] = { disposition: d, reason };
          }
        }
        await workflow("update_requirements", {
          required_claim_ids: required,
          optional_claim_ids: completionClaims(s, current)
            .filter((c) => !required.includes(c.claim_id))
            .map((c) => c.claim_id),
          dispositions,
          reason: fd.get("reason"),
          facility_requirements: {
            [facilityFor(s, current).facility_id]: {
              location_required: fd.has("location_required"),
              reason: fd.get("location_requirement_reason"),
            },
          },
        });
      } else if (form.id === "completion-form") {
        const fd = new FormData(form);
        if (!fd.has("confirm")) throw Error("Confirm the completion decision.");
        await workflow("complete_incident", {
          override: form.dataset.override === "true",
          reason: fd.get("reason"),
        });
      } else if (form.id === "reopen-form")
        await workflow("reopen_incident", {
          reason: new FormData(form).get("reason"),
        });
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
      autosave.update(payload());
      saveState();
    }
  });
  function reviewFactForm(c, includePrivate = true) {
    const gap = tasks(s).find(
        (g) => g.claim_id === c.claim_id && taskBucket(g) !== "resolved",
      ),
      task = gap
        ? V.researchInstruction(gap)
        : "Review the saved evidence for this exact proposition. Outside research is not required for this review step.";
    const holder = document.createElement("template");
    holder.innerHTML = F.factForm(
      c,
      includePrivate ? allFacts() : claims(s, dispositionFlow.incident_id),
      s,
    );
    const form = holder.content.querySelector("form"),
      grid = document.createElement("div"),
      left = document.createElement("div"),
      right = document.createElement("aside");
    grid.className = "dialog-grid";
    right.innerHTML = "<h3>Review result and verified value</h3>";
    for (const selector of [
      "h2.fact-type",
      ".fact-proposition",
      ".review-context",
      ".fact-state-guidance",
      ".fact-method-guidance",
      ".task-guidance",
      ".secondary-details",
    ]) {
      const node = form.querySelector(selector);
      if (node) left.append(node);
    }
    if (s.workflow?.claims?.[c.claim_id]?.review_needed) {
      const note = left.querySelector('[data-guidance="fact-human-review"]');
      if (note)
        note.innerHTML =
          labReviewState(c, s) === "REOPENED"
            ? "<b>New evidence may affect the previous lab finding.</b> Review this fact again. The previous lab review is preserved."
            : "<b>New evidence awaits the first current-lab review.</b> The lab has not yet validated this fact. Preserved research remains available below.";
    }
    left.querySelector(".task-guidance").innerHTML =
      "<b>Your task</b><br>" +
      h(task) +
      " Your factual review does not complete the incident.";
    right.append(form.querySelector(".form-grid"));
    grid.append(left, right);
    form.prepend(grid);
    const privateEvidence = includePrivate ? sourceCards(c.claim_id, true, true) : "";
    if (privateEvidence) {
      form.dataset.unsubmittedEvidence = "true";
      grid.insertAdjacentHTML("afterend", privateEvidence);
    }
    return form.outerHTML;
  }
  async function reopenFacilityIdentityDialog(fid, resolutionId) {
    if (!(await leave())) return;
    await refresh();
    if (s.profile?.role !== "supervisor")
      throw Error("Only a supervisor can reopen a facility identity decision.");
    const ctx = facilityIdentityReopeningContext(s, resolutionId);
    if (
      !ctx ||
      !ctx.is_current ||
      ctx.resolution.outcome !== "same" ||
      ctx.source?.facility_id !== fid
    )
      throw Error(
        "This same-facility decision is no longer current. Refresh and inspect its history.",
      );
    current = fid;
    view = "facility";
    draw();
    modal(
      "Reopen Facility Identity Decision",
      F.facilityIdentityReopenForm(ctx.source, ctx.resolution, ctx.target),
    );
    dialog.reopeningContext = clone(ctx);
    dialog.dataset.facility = fid;
  }
  function reviewFacilityReopening() {
    const x = facilityCommand,
      p = x.payload,
      ctx = facilityIdentityReopeningContext(s, p.resolution_id);
    if (!ctx || !ctx.is_current)
      throw Error(
        "This facility identity decision is no longer current. Refresh and inspect its history.",
      );
    const person = (id) =>
      s.team?.find((v) => v.user_id === id)?.display_name ||
      id ||
      "Not recorded";
    const names = Object.keys(p.incident_revisions).map(
      (id) =>
        s.records.INCIDENT.find((i) => i.incident_id === id)?.incident_label ||
        id,
    );
    modal(
      "Review facility identity reopening",
      `<p class="callout"><b>This reopens the identity question.</b> It does not declare these facilities different or change the existing factual findings.</p><div class="change-detail-grid"><div><span>Facility record to restore</span><b>${h(facilityName(ctx.source))}</b></div><div><span>Earlier match</span><b>${h(facilityName(ctx.target))}</b></div><div class="wide"><span>Previous decision preserved</span><b>Same physical facility · ${h(person(ctx.resolution.reviewer))} · ${h(ctx.resolution.reviewed_at)}</b></div><div class="wide"><span>Supervisor reason</span><b>${h(p.reason)}</b></div></div><h3>Affected currently recorded incidents</h3><ul>${names.map((n) => `<li>${h(n)}</li>`).join("")}</ul><p>The earlier match and link history remain available. Appropriate facility links are restored, identity returns to review, and affected completion and Phase 2 approval must be reviewed again. This does not create a new identity finding.</p><details class="secondary-details"><summary>Revision checks and affected links</summary><p>Facility revision ${h(p.expected_facility_revision)} · compared facility revision ${h(p.expected_target_revision)}.</p><p>Every affected incident and link revision is checked before saving. All changes commit together or none do.</p><ul>${Object.entries(
        p.link_revisions,
      )
        .map(([id, rev]) => `<li>${h(id)} · revision ${h(rev)}</li>`)
        .join(
          "",
        )}</ul></details><label class="certification-box"><input type="checkbox" id="facility-submit-confirm"> I checked the earlier decision, reason, affected records, and reopening consequences.</label><div class="dialog-actions"><button data-action="close-dialog">Keep editing</button><button data-action="save-facility-draft">Save private draft</button><button class="primary" data-action="submit-facility">Reopen Facility Identity Decision</button></div>`,
    );
  }
  function stageFacility(kind, payload, fid) {
    const link = s.records.INCIDENT_FACILITY.find(
      (x) => x.facility_id === fid && x.is_current !== false && (!payload.incident_id || x.incident_id === payload.incident_id),
    );
    if (!link)
      throw Error(
        "This facility has no current incident link. Open its resolved authoritative facility to continue.",
      );
    payload.expected_facility_revision = s.revisions.FACILITY[fid];
    if (kind === "review_facility_association") payload.expected_link_revision = s.revisions.INCIDENT_FACILITY[payload.incident_facility_id];
    payload.incident_revisions = Object.fromEntries(
      s.records.INCIDENT_FACILITY.filter(
        (x) => x.facility_id === fid && x.is_current !== false,
      ).map((x) => [x.incident_id, s.revisions.INCIDENT[x.incident_id]]),
    );
    if (payload.target_facility_id)
      payload.expected_target_revision =
        s.revisions.FACILITY[payload.target_facility_id];
    facilityCommand = {
      operation_id: crypto.randomUUID(),
      incident_id: link.incident_id,
      expected_revision: s.revisions.INCIDENT[link.incident_id],
      kind,
      payload,
    };
    reviewFacility();
  }
  function reviewFacility() {
    if (facilityCommand.kind === "reopen_facility_identity") {
      reviewFacilityReopening();
      return;
    }
    const x = facilityCommand,
      p = x.payload,
      f = s.records.FACILITY.find((f) => f.facility_id === p.facility_id),
      target = s.records.FACILITY.find(
        (f) => f.facility_id === p.target_facility_id,
      ),
      source =
        p.source || s.records.SOURCE.find((v) => v.source_id === p.source_id);
    const fields =
      x.kind === "resolve_facility"
        ? [
            [
              "Proposition assessed",
              "These two records represent the same physical facility.",
            ],
            [
              "Physical-facility decision",
              {
                same: "Same physical facility",
                different: "Different physical facility",
                unsure: "Not sure yet",
              }[p.outcome],
            ],
            [
              "Compared with",
              target ? facilityName(target) : "No specific comparison record",
            ],
            ["Evidence basis", p.basis],
            ["Review note", p.review_note],
          ]
        : x.kind === "review_location"
          ? [
              ["Location evidence state", p.review_state],
              ["Locality", p.locality],
              [
                "Facility coordinates",
                p.coordinates
                  ? `${p.coordinates.latitude}, ${p.coordinates.longitude}`
                  : "Unknown — no coordinates proposed",
              ],
              ["Method", p.method],
              ["Precision", p.precision],
              ["Limitations", p.limitations],
              ["Evidence basis", p.basis],
              ["Review note", p.review_note],
            ]
          : x.kind === "review_facility_association" ? [
              ["Exact incident record", p.incident_id],
              ["Physical facility association", p.facility_match_state === "supported" ? "Supported for this exact physical facility" : "Unresolved — continue investigating"],
              ["Physical identity finding", p.identity_claim_id],
              ["Source evidence", p.basis],
              ["Review note and limitations", p.review_note],
            ] : [
              ["Selected dimensions", p.scopes.join(", ")],
              ...(p.location ? [["Proposed facility coordinates", p.location.coordinates ? `${p.location.coordinates.latitude}, ${p.location.coordinates.longitude} (${p.location.coordinates.crs || "CRS unknown"})` : "Not established"], ["Geographic provenance", p.location.coordinate_reference_type], ["Why this is the physical facility", p.location.researcher_explanation], ["Approval status", "Pending geographic review; this submission does not approve the point"]] : []),
              ...(p.identity_claim_id
                ? [
                    [
                      "Identity proposition",
                      s.records.CLAIM.find(
                        (c) => c.claim_id === p.identity_claim_id,
                      )?.subject || p.identity_claim_id,
                    ],
                  ]
                : []),
              ...(p.type_claim_id
                ? [
                    [
                      "Facility-type proposition",
                      s.records.CLAIM.find(
                        (c) => c.claim_id === p.type_claim_id,
                      )?.subject || p.type_claim_id,
                    ],
                  ]
                : []),
              [
                "Location description",
                p.location
                  ? `${p.location.locality || "Unknown locality"} · ${p.location.method} · ${p.location.precision} · ${p.location.limitations}`
                  : "No location evidence link",
              ],
            ];
    modal(
      "Review facility changes",
      `${guidance("review-facility-changes", "<b>Facility/incident changes — your final check before saving.</b> Check the physical facility, selected evidence, and exact decision below. A source only applies to the dimensions you selected.")}<h3>${h(facilityName(f))}</h3><p>Expected facility revision ${h(p.expected_facility_revision)}${target ? " · compared facility revision " + h(p.expected_target_revision) : ""}. The server checks these before recording a decision.</p><div class="change-detail-grid">${fields.map(([k, v]) => `<div class="wide"><span>${h(k)}</span><b>${h(v || "Not recorded")}</b></div>`).join("")}</div>${source ? V.evidenceCard(s, source, p.relation, true) : ""}<p class="callout">${x.kind === "resolve_facility" && p.outcome === "same" ? "The provisional facility will remain in history. Its current incident links will point to the selected authoritative facility; original names, evidence and past reviews remain preserved." : "Only the stated dimensions and decision will be recorded. Adding a source does not certify other facility attributes."}</p><label class="certification-box"><input type="checkbox" id="facility-submit-confirm"> I checked the source, selected dimensions, facility, and proposed decision.</label><div class="dialog-actions"><button data-action="close-dialog">Keep editing</button><button data-action="save-facility-draft">Save private draft</button><button class="primary" data-action="submit-facility">Submit facility changes</button></div>${guidance("facility-submit-options", "<b>Save private draft:</b> keep this decision for yourself.<br><b>Submit facility changes:</b> save only this evidence-backed facility decision and its history. Local preview saves in this browser; shared mode saves for the team.")}`,
    );
  }
  async function submitFacility() {
    if (["review_location", "review_facility_association"].includes(facilityCommand?.kind))
      throw Error("This geographic-review draft is preserved, but its submission is deferred for this launch.");
    if (!dialog.querySelector("#facility-submit-confirm")?.checked)
      throw Error(
        "Review the proposed facility decision and confirm before submitting.",
      );
    const fid = facilityCommand.payload.facility_id,
      reopening = facilityCommand.kind === "reopen_facility_identity";
    await store.commit(facilityCommand);
    facilityCommand = null;
    if (draftId) {
      await store.deleteDraft(draftId, draftRevision);
      draftId = null;
      draftRevision = 0;
    }
    await refresh();
    current = fid;
    view = "facility";
    dialog.close();
    notice = reopening
      ? "Facility identity decision reopened. The previous match remains in history; identity needs review and affected completion and Phase 2 approval require re-review."
      : "Facility review submitted with evidence, reviewer identity, timestamp and history.";
    draw();
  }
  async function saveFacilityDraft() {
    draftId ??= crypto.randomUUID();
    const d = await store.saveDraft(draftId, draftRevision, {
      incident_id: facilityCommand.incident_id,
      title:
        "Facility review · " +
        facilityName(
          s.records.FACILITY.find(
            (f) => f.facility_id === facilityCommand.payload.facility_id,
          ),
        ),
      expected_revision: facilityCommand.expected_revision,
      creation: null,
      changes: [],
      facilityCommand,
    });
    draftRevision = d.revision;
    await refresh();
    dialog.close();
    facilityCommand = null;
    current = null;
    view = "queue";
    notice =
      "Private facility-review draft saved. No shared facility decision was submitted.";
    draw();
  }
  function signIn() {
    window.location.assign("/sign-in");
  }
  async function start() {
    s = decorate(initialSnapshot);
    if (current) baseRevision = s.revisions.INCIDENT[current];
    const ctx=readLocation();
    if(validContext(ctx)) {view=ctx.view; current=ctx.current; baseRevision=s.revisions.INCIDENT[current]||0;
      const d=s.drafts?.find(d=>(d.id||d.draft_id)===ctx.draft); if(d) restoreDraft(d);}
    lastContext=JSON.stringify([view,current]); historyReady=true;
    if (alive) draw();
  }
  // Refresh only the canonical snapshot, never form inputs or a private proposal.
  // Keeping the started revision with pending work preserves optimistic concurrency.
  function canAutoRefresh() {
    return Boolean(
      alive &&
        !analyticsOpen &&
        store &&
        s &&
        !busy &&
        !dialog.open &&
        pending.length === 0 &&
        !creation &&
        !facilityCommand &&
        !assignmentCommand &&
        !phase2Command &&
        document.querySelector(".workspace-state") &&
        (store.mode === "local" || store.session),
    );
  }
  async function refreshSharedView() {
    if (!canAutoRefresh()) return;
    const sourceStore = store,
      sourceState = s,
      sourceIdentity = store.identity;
    const next = await sourceStore.snapshot();
    if (
      !canAutoRefresh() ||
      store !== sourceStore ||
      s !== sourceState ||
      store.identity !== sourceIdentity
    )
      return;
    if (
      notice ===
      "Automatic refresh could not load the latest research. Current findings may be out of date. Refresh to try again; private work is unchanged."
    ) {
      notice = "";
      const box = document.getElementById("notice");
      if (box) {
        box.hidden = true;
        box.textContent = "";
      }
    }
    if (next === s) return;
    const oldRevision = s.revisions.INCIDENT[current];
    const opened = [...root.querySelectorAll("details")]
      .filter((d) => d.open)
      .map((d) => d.querySelector("summary")?.textContent);
    const focus = document.activeElement?.closest("[data-action]")?.dataset;
    const search = document.getElementById("supervisor-search")?.value;
    const scroll = [window.scrollX, window.scrollY];
    s = decorate(next);
    if (pending.length) {
      if (s.revisions.INCIDENT[current] !== oldRevision)
        notice =
          "This item changed while you were reviewing it. The latest findings are shown; your private changes keep their original revision. Review the latest version before submitting.";
    } else if (current && s.revisions.INCIDENT[current] != null)
      baseRevision = s.revisions.INCIDENT[current];
    draw();
    for (const d of root.querySelectorAll("details"))
      if (!d.dataset.disclosureKey && opened.includes(d.querySelector("summary")?.textContent))
        d.open = true;
    if (search) {
      const input = document.getElementById("supervisor-search");
      if (input) {
        input.value = search;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    if (focus) {
      const target = [...root.querySelectorAll("[data-action]")].find((el) =>
        Object.entries(focus).every(([k, v]) => el.dataset[k] === v),
      );
      target?.focus({ preventScroll: true });
    }
    window.scrollTo(...scroll);
  }
  const stopRefresh = installSnapshotRefresh({
    refresh: refreshSharedView,
    dialog,
    onError: (error) => {
      if (error.labAccessDenied || error.sessionExpired) {
        showError(error);
        return;
      }
      if (!canAutoRefresh()) return;
      notice =
        "Automatic refresh could not load the latest research. Current findings may be out of date. Refresh to try again; private work is unchanged.";
      const box = document.getElementById("notice");
      if (box) {
        box.hidden = false;
        box.textContent = notice;
      }
    },
  });
  bindGuidance(container);
  listen("change", () => polishPresentation(dialog));
  start().then(() => disclosures.anchor()).catch(showError);
  return () => {
    alive = false;
    autosave.stop(); checkpoints.clear();
    window.removeEventListener('popstate',onPop);
    window.removeEventListener('beforeunload',beforeUnload);
    window.removeEventListener('blur',focusSave);
    document.removeEventListener('visibilitychange',visibilitySave);
    document.removeEventListener('click',protectLink,true);
    dialog.removeEventListener('cancel',cancelForm);
    dialog.removeEventListener('close',closeForm);
    disclosures.dispose();
    sourceInspection.dispose();
    stopRefresh();
    for (const [type, handler] of listeners)
      container.removeEventListener(type, handler);
    if (dialog.open) dialog.close();
    root.replaceChildren();
  };
}
