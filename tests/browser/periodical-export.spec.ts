import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { pythonCommand } from "../support/python.mjs";
import { action, control, login } from "./helpers";

const endpoint = "/api/periodical-export";
const xlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

test("public demo exports reviewed synthetic events and shared research", async ({ page, request }) => {
  await control(request, { reset: true });
  expect((await request.get(endpoint + "?format=summary")).status()).toBe(401);
  await login(page);
  await action(page, "validated");
  await page.locator('.phase2-export-actions > [data-action="export-periodical-data"]').click();
  const chooser = page.getByRole("dialog", { name: "Export Periodical Data" });

  await chooser.getByRole("button", { name: "Simplified Periodical Export", exact: true }).click();
  await chooser.getByRole("button", { name: "Verified Only", exact: true }).click();
  await expect(chooser.locator("[data-periodical-export-summary]")).toContainText("1 event · 1 finding · 0 mappable");
  await chooser.getByRole("button", { name: "Download ArcGIS CSV", exact: true }).click();
  const readyZip = page.waitForEvent("download");
  await chooser.getByRole("button", { name: "Verified event table", exact: true }).click();
  const zip = await readyZip;
  const zipName = zip.suggestedFilename();
  expect(zipName).toMatch(/^periodical-simplified-verified-only-arcgis-\d{4}-\d{2}-\d{2}\.zip$/);
  const csvName = zipName.replace(/\.zip$/, ".csv");
  execFileSync(pythonCommand(), ["-I", "-c", [
    "import csv, io, sys, zipfile",
    "name = sys.argv[1]",
    "with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as package:",
    "    assert sorted(package.namelist()) == sorted([name, 'schema.ini'])",
    "    assert package.testzip() is None",
    "    assert package.read('schema.ini').decode().startswith('[' + name + ']')",
    "    rows = list(csv.DictReader(io.StringIO(package.read(name).decode('utf-8-sig'))))",
    "    assert [row['Event_ID'] for row in rows] == ['I-SYN019-MAIN']",
    "    assert rows[0]['Latitude'] == rows[0]['Longitude'] == ''",
  ].join("\n"), csvName], { input: fs.readFileSync((await zip.path())!), timeout: 30_000 });

  await chooser.getByRole("button", { name: "Back", exact: true }).click();
  await chooser.getByRole("button", { name: "Back", exact: true }).click();
  await chooser.getByRole("button", { name: "Back", exact: true }).click();
  await chooser.getByRole("button", { name: "Full Fact Periodical Export", exact: true }).click();
  await chooser.getByRole("button", { name: "Verified and Unverified", exact: true }).click();
  await expect(chooser.locator("[data-periodical-export-summary]")).toContainText("3 events");
  await expect(chooser.getByRole("button", { name: "Download ArcGIS CSV", exact: true })).toHaveCount(0);
  expect((await page.request.get(endpoint + "?format=arcgis&scope=all")).status()).toBe(400);
  const xlsxResponse = page.waitForResponse(response => new URL(response.url()).searchParams.get("format") === "xlsx");
  const readyXlsx = page.waitForEvent("download");
  await chooser.getByRole("button", { name: "Download Excel report", exact: true }).click();
  expect((await readyXlsx).suggestedFilename()).toMatch(/\.xlsx$/);
  expect((await xlsxResponse).headers()["content-type"]).toBe(xlsxType);
});
