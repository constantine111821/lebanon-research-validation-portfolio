import { expect, type Page, type APIRequestContext } from "@playwright/test";

export const origin = "http://127.0.0.1:3300";
export const real = false;

export async function control(request: APIRequestContext, data: object) {
  const response = await request.post("http://127.0.0.1:43139/__control", {
    headers: { "x-fixture-control": "local-fixture-control" },
    data,
  });
  expect(response.ok()).toBeTruthy();
}
export async function login(page: Page, name = "researcher") {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(name + "@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("Local-fixture-only-2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".facility-group").first()).toBeVisible();
}
export async function openCase(page: Page, id: string) {
  await page.goto("/cases/" + id);
  await expect(page.locator(".duration-panel")).toBeVisible();
}
export const snapshot = async (page: Page) =>
  (await page.request.get("/api/workspace")).json();
export async function action(page: Page, name: string) {
  const selector = `[data-action="${name}"]`;
  const inside = page.locator(`dialog[open] ${selector}`);
  const button = (await inside.count()) ? inside.first() : page.locator(selector).first();
  await expect(button).toBeAttached();
  for (const parent of await button.locator("xpath=ancestor::details").all()) {
    if ((await parent.getAttribute("open")) === null)
      await parent.locator(":scope > summary").click();
  }
  await button.click({ timeout: 10_000 });
  await expect(page.locator("#app").locator("..")).toHaveAttribute("aria-busy", "false");
}
