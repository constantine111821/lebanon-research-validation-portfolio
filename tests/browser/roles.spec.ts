import { expect, test } from "@playwright/test";
import { control, login, openCase, origin, snapshot } from "./helpers";

test("researcher drafts are owner-scoped and supervisor controls are role-scoped", async ({ browser, page, request }) => {
  await control(request, { reset: true });
  expect((await request.get("/api/workspace")).status()).toBe(401);
  await login(page);
  const incident = "I-SYN019-MAIN";
  await openCase(page, incident);
  expect((await page.request.get("/api/supervisor")).status()).toBe(403);
  const start = await snapshot(page);
  const draftId = crypto.randomUUID();
  const draftTitle = "Synthetic researcher-only draft";
  const saved = await page.request.post("/api/drafts", {
    headers: { Origin: origin },
    data: {
      id: draftId,
      expected_revision: 0,
      payload: {
        incident_id: incident,
        title: draftTitle,
        expected_revision: start.revisions.INCIDENT[incident],
        creation: null,
        facilityCommand: null,
        changes: [{ type: "review", claim_id: "C-SYN019-EVAC", review_notes: draftTitle }],
      },
    },
  });
  expect(saved.status()).toBe(200);
  await page.goto("/drafts");
  await expect(page.getByText(draftTitle, { exact: true })).toBeVisible();

  const context = await browser.newContext({ baseURL: origin });
  try {
    const supervisor = await context.newPage();
    await login(supervisor, "supervisor");
    expect((await supervisor.request.get("/api/supervisor")).status()).toBe(200);
    const rows = await (await supervisor.request.get("/api/drafts")).json();
    expect(rows.some((row: { id: string }) => row.id === draftId)).toBe(false);
  } finally {
    await context.close();
  }
});
