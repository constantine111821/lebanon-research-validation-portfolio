import { expect, test } from "@playwright/test";
import { action, control, login, openCase, origin, snapshot } from "./helpers";

test("reviewer walkthrough preserves the evidence, private draft and Supervisor boundary", async ({ browser, page, request }) => {
  await control(request, { reset: true });
  expect((await request.get("/api/workspace")).status()).toBe(401);
  await login(page);
  await openCase(page, "I-SYN019-MAIN");
  expect((await page.request.get("/api/supervisor")).status()).toBe(403);
  expect((await page.request.get("/api/analytics")).status()).toBe(403);
  await expect(page.getByRole("button", { name: "Research Analytics" })).toHaveCount(0);
  const before = await snapshot(page);

  await page.getByRole("link", { name: "Next research steps" }).click();
  await expect(page.getByRole("heading", { name: "Next research steps" })).toBeVisible();
  await page.getByRole("link", { name: "Review facts and evidence" }).click();
  const card = page.locator('#facts-section [data-claim-id="C-SYN019-DAMAGE"]');
  const category = card.locator("xpath=ancestor::details[@data-research-category][1]");
  if ((await category.getAttribute("open")) === null) {
    await category.locator(":scope > summary").press("Enter");
  }
  await expect(card.getByText("Synthetic physical consequences", { exact: true })).toBeVisible();
  const evidence = card.locator(".fact-evidence-disclosure");
  await evidence.locator(":scope > summary").press("Enter");
  const source = evidence.locator('[data-evidence-relation="SUPPORTS"]');
  await expect(source.getByRole("heading", { name: "Synthetic019 SUPPORTS report" })).toBeVisible();
  await expect(source.getByRole("link", { name: "Synthetic019 SUPPORTS report" })).toHaveAttribute(
    "href", "https://example.invalid/scientific019/SUPPORTS",
  );
  await expect(source.locator(".incident-evidence-passage-text")).toHaveText("Synthetic SUPPORTS description");

  const note = "Synthetic walkthrough: the saved passage has a recorded limitation.";
  await card.getByRole("button", { name: "Review fact" }).click();
  await page.locator('[name="validation_state"]').selectOption({ label: "Needs more evidence" });
  await page.locator('[name="review_notes"]').fill(note);
  await page.locator('[name="attestation"]').check();
  await page.locator('#fact-form button[type="submit"]').click();
  await expect(page.getByRole("dialog")).not.toBeVisible();

  await action(page, "review-changes");
  await expect(page.getByRole("dialog")).toContainText(note);
  await page.getByRole("dialog").getByRole("button", { name: "Save private draft" }).click();
  const readDrafts = async () => {
    const result = await page.request.get("/api/drafts");
    expect(result.ok()).toBeTruthy();
    return await result.json();
  };
  await expect.poll(async () => (await readDrafts())[0]?.payload.changes[0]?.review_notes).toBe(note);
  const draftId = (await readDrafts())[0].id;
  expect((await snapshot(page)).records).toEqual(before.records);

  await page.goto("/drafts");
  await page.getByRole("button", { name: "Continue draft" }).click();
  await expect(page.locator(".private-action-bar")).toContainText("1 pending change");
  await action(page, "review-changes");
  await expect(page.getByRole("dialog")).toContainText(note);

  const context = await browser.newContext({ baseURL: origin });
  try {
    const supervisor = await context.newPage();
    await login(supervisor, "supervisor");
    expect((await supervisor.request.get("/api/supervisor")).status()).toBe(200);
    await action(supervisor, "supervisor");
    await expect(supervisor.getByRole("heading", { name: "Supervisor Hub" })).toBeVisible();
    const analytics = await supervisor.request.get("/api/analytics");
    expect(analytics.status()).toBe(200);
    expect((await analytics.json()).current.status).toBe("NOT_CAPTURED");
    await action(supervisor, "analytics");
    await expect(supervisor.getByRole("heading", { name: "Research Analytics" })).toBeVisible();
    const rows = await (await supervisor.request.get("/api/drafts")).json();
    expect(rows.some((row: { id: string }) => row.id === draftId)).toBe(false);
  } finally {
    await context.close();
  }
});
