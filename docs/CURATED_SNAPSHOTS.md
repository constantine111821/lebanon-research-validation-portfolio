# Curated source snapshots

Selected changes from the project’s historical source and release artifacts. The excerpts omit unrelated code and private inputs. Line wrapping is adjusted where needed. Added lines in the early pilot are excerpts from the first available implementation. They are not a reconstructed Git diff against the workbook. The portfolio’s own Git history starts with the curated application.

## September 12–16, 2026 · Research queries became traceable inputs

Manual searches left the team without a common record of what had been tried. The early pilot gave each planned query an identifier, language, purpose and evidence category. It distinguished a search about physical damage from one about service disruption. Later stages recorded source access and review outcomes separately. A successful search was only a lead until a source passage supported a specific proposition.

```python
def make_query(query_id, language, purpose, evidence_category, text):
    """Give every query the same clear structure."""
    return {
        "query_id": query_id,
        "language": language,
        "purpose": purpose,
        "evidence_category": evidence_category,
        "query": text,
    }
```

```python
        make_query(
            "Q03",
            "English",
            "Physical damage discovery",
            "possible_physical_damage",
            f'"{english_name}" (hit OR damaged OR destroyed)',
        ),
        make_query(
            "Q04",
            "English",
            "Operational impact discovery",
            "operational_disruption_only",
            f'"{english_name}" (evacuated OR closed OR "out of service")',
        ),
        make_query(
            "Q05",
            "English",
            "Geographic disambiguation",
            "geographic_context",
            f'"{english_name}" "{district}"',
        ),
```

The archived query generator verified against its original file hash. A local execution with fictional facility and locality fields produced 12 unique queries across English and Arabic without a network call. The historical search and source records separately preserved what actually ran and what each source said. Surviving source records carry the excerpt and locator, publication and retrieval dates, and occurrence date with its basis. The early runner is outside this portfolio. The current application retains a related distinction between source metadata, claim-specific evidence and the excerpt used in review. [Synthetic evidence records](../tests/support/records.mjs) · [Evidence renderer](../apps/web/src/approved/evidence-presentation.js)

## October 1, 2026 · Private saves carry a revision

The spreadsheet pilot exposed the difficulty of sharing a workbook while preserving unfinished individual work. The first Next.js case slice connected a private editor to an authenticated draft route. The browser submitted the revision it had opened. The route passed it to the database save operation and exposed a conflict as HTTP 409, so the editor could keep its local input and ask the researcher to reload.

```diff
# Browser editor
+ const response = await fetch("/api/drafts", {
+   method: "POST",
+   headers: { "Content-Type": "application/json" },
+   body: JSON.stringify({ id, expected_revision: revision, payload }),
+ });
+ if (response.status === 409) {
+   setConflict(true);
```

```diff
# Authenticated save route
+ checkOrigin(request);
+ const { client, snapshot } = await authorizedWorkspace();
+ const input = saveInput(await boundedBody(request), snapshot);
+ const { data, error } = await client.rpc("lab_save_draft", {
+   p_id: input.id,
+   p_expected_revision: input.expected_revision,
+   p_payload: input.payload,
+ });
+ if (error) {
+   if (["PT409", "40001"].includes(error.code))
+     throw new AccessError(409, "DRAFT_CONFLICT");
+   throw error;
+ }
+ return json(data);
```

The early checkout and database tests exercised draft saves and version checks. The current browser test saves a draft through the case UI, reopens it, and checks that another role cannot list it. [Current draft route](../apps/web/src/app/api/drafts/route.ts) · [Synthetic draft schema](../tests/support/schema) · [Browser test](../tests/browser/roles.spec.ts)

## October 5 · Supervisor acceptance has its own rules

Early case-level progression needed a defensible definition of readiness. The new policy required the current revision of a fact to have a recorded reviewer and time, or a documented waiver. A waiver could affect case readiness without making the fact supported. A separate test for output checked the Supervisor approval and the incident revision it covered.

```diff
+ const review = s.workflow?.claims?.[c.claim_id];
+ const current =
+   review?.lab_review_state === "REVIEWED" &&
+   !review.review_needed &&
+   Boolean(review.lab_reviewed_by && review.lab_reviewed_at) &&
+   review.lab_reviewed_claim_revision === s.revisions?.CLAIM?.[c.claim_id];
```

```diff
+ export function outputAuthorized(s, iid) {
+   const d = s.dispositions?.incidents?.[iid],
+     w = s.workflow?.incidents?.[iid],
+     a = s.phase2_approvals?.[iid],
+     rev = s.revisions?.INCIDENT?.[iid];
+   return (
+     d?.state !== "DEFERRED" &&
+     ["review_complete", "supervisor_override", "complete"].includes(w?.status) &&
+     w.completion?.completion_revision === rev &&
+     a?.status === "APPROVED" &&
+     a.approved_incident_revision === rev &&
+     Boolean(a.approved_by && a.approved_at && a.approval_reason?.trim())
+   );
+ }
```

The historical isolated acceptance tests exercised readiness and revision history. The current browser test records a fictional Supervisor disposition and checks the case is eligible before requesting the export. [Current acceptance policy](../packages/domain/src/acceptance-policy.js) · [Approval and export check](../tests/browser/provider-retry.spec.ts)

## November 11 · Evidence opens beside the finding

The previous review card used general-purpose source summaries. Lab feedback led to a direct entry point from the incident header and a presentation specific to incident review. The specialized renderer shows a saved passage only when it is tied to the finding, retaining its locator and evidence direction. The source title is the link, with publication information where recorded.

```diff
+ <nav class="inline incident-review-links" aria-label="Incident research">
+   <a class="primary" href="#facts-section">Review facts and evidence</a>
+   <a href="#research-tasks">Next research steps</a>
+ </nav>
```

```diff
- export function renderFactEvidence(s, claim) {
+ export function renderFactEvidence(s, claim, { incidentReview = false } = {}) {
    const links=(s.records?.CLAIM_SOURCE||[]).filter(r=>r.claim_id===claim.claim_id&&currentEvidence(r));
-   const pairs=links.map(relation=>({relation,source:s.records.SOURCE.find(x=>x.source_id===relation.source_id)}));
+   const pairs=links.map(relation=>({relation,source:s.records?.SOURCE?.find(x=>x.source_id===relation.source_id)}));
+   const renderSource=incidentReview?renderIncidentEvidence:renderEvidenceSummary;
```

```diff
+ const passages = incidentPassages(s, source, relation);
+ const title = h(source.title || "Source title not recorded");
+ const href = safeURL(source.canonical_url) || safeURL(source.original_url);
```

```diff
+ const exactText = h(text).replaceAll("\r", "&#13;");
+ return `<div class="incident-evidence-passage" data-evidence-kind="${kind}">
+   <p><strong>${descriptions[kind]}</strong></p>
+   <div class="incident-evidence-passage-text" dir="auto">${exactText}</div>
+   ${locator ? `<p class="incident-evidence-locator"><strong>Saved citation</strong> <bdi>${h(locator)}</bdi></p>` : ""}
+ </div>`;
```

The accepted implementation was checked in an isolated browser and confirmed by the owner on the hosted site. The current synthetic test exercises both incident links and checks the finding, title link and exact saved passage on one card. [Incident layout](../apps/web/src/approved/views.js) · [Evidence renderer](../apps/web/src/approved/evidence-presentation.js) · [Browser test](../tests/browser/roles.spec.ts)

## November 11–12 UTC · Export admits bounded work

The earlier route read a workspace and built the portable package directly. The private remediation added a work deadline, a snapshot byte budget, a per-instance admission check, record limits and an archive size ceiling. The result distinguishes overload, a package too large, and temporary unavailability. The per-instance check does not establish deployment-wide concurrency control.

```diff
- const { snapshot } = await authorizedWorkspace();
+ const actor = await authorizedActor({
+   signal,
+   snapshotByteLimit: {
+     maxBytes: maxSnapshotBytes,
+     onLimit: () => { snapshotTooLarge = true; },
+   },
+ });
+ checkBudget();
+ if (exporting) return json({ error: "RESEARCH_EXPORT_BUSY" }, 429);
+ exporting = admitted = true;
+ const { snapshot } = await workspaceForActor(actor);
+ checkBudget();
+ const records = Object.values(snapshot.records).reduce((count, rows) => count + rows.length, 0);
+ if (snapshot.records.INCIDENT.length > maxIncidents || records > maxRecords)
+   throw new ResearchPackageSizeError();
```

```diff
  const result = buildResearchPackage(snapshot, {
    // Existing package metadata omitted from this excerpt.
+   maxArchiveBytes,
+   checkBudget,
  });
```

The private CI run exercised failure handling and a real approved download using disposable services. The portfolio test checks overlap, oversize and temporary-failure responses, then downloads the approved ZIP and verifies its manifest and data with an independent Python consumer. It also checks that the private draft is absent and its saved revision survives the failed update. [Export route](../apps/web/src/app/api/research-export/route.ts) · [Archive builder](../packages/domain/src/research-export.mjs) · [Browser and ZIP check](../tests/browser/provider-retry.spec.ts)
