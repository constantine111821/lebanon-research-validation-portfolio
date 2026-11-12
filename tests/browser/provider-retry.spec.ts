import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { pythonCommand } from "../support/python.mjs";
import { action, control, login, openCase, origin, real, snapshot } from "./helpers";

test.skip(real, "Provider failures are simulated by the isolated fixture.");

test.beforeEach(async ({ request }) => {
  await control(request, { reset: true, synthetic_only: true });
});

test("sign-in distinguishes transient failures, keeps credential errors generic and preserves an existing session", async ({ page, request }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill("researcher@example.invalid");
  const password = page.getByLabel("Password", { exact: true });
  const button = page.getByRole("button", { name: "Sign in", exact: true });
  const response = () => page.waitForResponse(r =>
    r.url() === origin + "/api/session" && r.request().method() === "POST",
  );
  const alert = page.locator(".login-form").getByRole("alert");
  const cases = [
    { fault: null, password: "Wrong password", status: 401, message: "Sign-in failed. Check your email and password." },
    { fault: "auth-throttled", status: 429, message: "Sign-in is temporarily limited. Wait a moment and try again." },
    { fault: "auth-unavailable", status: 503, message: "Sign-in is temporarily unavailable. Please try again shortly." },
    { fault: "auth-gateway-timeout", status: 503, message: "Sign-in is temporarily unavailable. Please try again shortly." },
    { fault: "profile-unavailable", status: 503, message: "Sign-in is temporarily unavailable. Please try again shortly." },
  ];
  for (const scenario of cases) {
    await control(request, { fault: scenario.fault });
    await password.fill(scenario.password ?? "Local-fixture-only-2026!");
    const waiting = response();
    await button.click();
    const result = await waiting;
    expect(result.status()).toBe(scenario.status);
    await expect(alert).toHaveText(scenario.message);
    expect((await page.context().cookies()).filter(cookie => cookie.name.startsWith("sb-"))).toEqual([]);
  }
  await control(request, { fault: null });
  await button.click();
  await expect(page.locator(".facility-group").first()).toBeVisible();
  const initialActor = (await snapshot(page)).profile.user_id;

  // A failed login from another tab must preserve the browser's existing actor.
  await control(request, { fault: "profile-unavailable" });
  const failedSwitch = await page.request.post("/api/session", {
    headers: { Origin: origin },
    data: { email: "supervisor@example.invalid", password: "Local-fixture-only-2026!" },
  });
  expect(failedSwitch.status()).toBe(503);
  expect(await failedSwitch.json()).toEqual({ error: "SIGN_IN_UNAVAILABLE" });
  expect(failedSwitch.headers()["set-cookie"]).toBeUndefined();
  await control(request, { fault: null });
  expect((await snapshot(page)).profile.user_id).toBe(initialActor);
});

test("synthetic approval, failed export and download retry preserve saved private work", async ({ page, request }) => {
  const incidentId = "I-SYN019-OTHER";
  const privateTitle = "Synthetic private draft excluded from the export";
  expect((await request.get("/api/research-export")).status()).toBe(401);
  await login(page, "supervisor");
  const start = await snapshot(page);
  expect(start.records.INCIDENT.map((incident: { incident_id: string }) => incident.incident_id).sort())
    .toEqual(["I-SYN019-MAIN", incidentId, "I-SYN019-SHARED"].sort());
  const draft = {
    id: crypto.randomUUID(),
    expected_revision: 0,
    payload: {
      incident_id: incidentId,
      title: privateTitle,
      expected_revision: start.revisions.INCIDENT[incidentId],
      creation: null,
      facilityCommand: null,
      changes: [{ type: "review", claim_id: "C-SYN019-OTHER", review_notes: privateTitle }],
    },
  };
  const save = (data: typeof draft) => page.request.post("/api/drafts", {
    headers: { Origin: origin },
    data,
  });
  const saved = await save(draft);
  expect(saved.status()).toBe(200);
  const revision = (await saved.json()).revision;
  await control(request, { fault: "draft-unavailable" });
  const update = {
    ...draft,
    expected_revision: revision,
    payload: { ...draft.payload, title: "Synthetic failed update" },
  };
  expect((await save(update)).status()).toBe(503);
  await control(request, { fault: null });

  await openCase(page, incidentId);
  await page.locator(`[data-action="disposition-start"][data-target-type="incident"][data-target-id="${incidentId}"][data-disposition-action="APPROVE"]`).first().click();
  await action(page, "disposition-confirm");
  await page.locator('[name="disposition_reason"]').fill("Synthetic fixture approval with recorded limitations.");
  await page.locator('[name="disposition_attestation"]').check();
  const waitingForApproval = page.waitForResponse(r => r.url() === origin + "/api/commands");
  await page.locator('#disposition-decision-form button[type="submit"]').click();
  const approved = await waitingForApproval;
  expect(approved.status(), await approved.text()).toBe(200);
  await expect(page.locator("dialog")).not.toBeVisible();
  expect((await snapshot(page)).output_eligibility[incidentId]).toBe(true);
  await action(page, "validated");

  await control(request, { fault: "snapshot-delayed" });
  const concurrent = await Promise.all([
    page.request.get("/api/research-export"),
    page.request.get("/api/research-export"),
  ]);
  expect(concurrent.map(response => response.status()).sort()).toEqual([200, 429]);
  const busy = concurrent.find(response => response.status() === 429)!;
  expect(await busy.json()).toEqual({ error: "RESEARCH_EXPORT_BUSY" });
  await control(request, { fault: "snapshot-oversized" });
  const oversized = await page.request.get("/api/research-export");
  expect(oversized.status()).toBe(413);
  expect(await oversized.json()).toEqual({ error: "RESEARCH_EXPORT_TOO_LARGE" });

  const downloads: string[] = [];
  page.on("download", download => downloads.push(download.suggestedFilename()));
  await control(request, { fault: "snapshot-unavailable" });
  const waitingForFailure = page.waitForResponse(r => r.url() === origin + "/api/research-export");
  await action(page, "export-research-package");
  expect((await waitingForFailure).status()).toBe(503);
  await expect(page.getByText("The research export is temporarily unavailable. Please try again shortly.", { exact: true })).toBeVisible();
  expect(downloads).toEqual([]);
  await control(request, { fault: null });
  const waitingForDownload = page.waitForEvent("download");
  await action(page, "export-research-package");
  const download = await waitingForDownload;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rvw-synthetic-retry-"));
  try {
    await download.saveAs(path.join(directory, "research.zip"));
    const zip = fs.readFileSync(path.join(directory, "research.zip"));
    expect(zip.toString("utf8")).not.toContain(privateTitle);
    const code = "import pathlib,zipfile,runpy,sys; p=sys.argv[1]; z=zipfile.ZipFile('research.zip'); assert z.read('verify_export.py')==pathlib.Path(p).read_bytes(); sys.argv=[p,'research.zip']; runpy.run_path(p,run_name='__main__')";
    const check = spawnSync(pythonCommand(), ["-I", "-c", code, path.resolve("scripts/verify_export.py")], { cwd: directory, encoding: "utf8", timeout: 30000 });
    expect(check.status, check.stdout + check.stderr).toBe(0);
    expect(JSON.parse(check.stdout).counts.incidents).toBe(1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  const rows = await (await page.request.get("/api/drafts")).json();
  expect(rows).toEqual([expect.objectContaining({
    id: draft.id,
    revision,
    payload: expect.objectContaining({ title: privateTitle }),
  })]);
  expect((await save(update)).status()).toBe(200);
  const retried = await (await page.request.get("/api/drafts")).json();
  expect(retried[0].revision).toBe(revision + 1);
  await page.goto("/drafts");
  await expect(page.getByText(update.payload.title, { exact: true })).toBeVisible();
});
