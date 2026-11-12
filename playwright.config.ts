import { defineConfig } from "@playwright/test";

process.env.RVW_APP_PORT = "3300";
process.env.RVW_FIXTURE_PORT = "43139";
delete process.env.RVW_BROWSER_MODE;

export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: 60_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3300",
    browserName: "chromium",
    trace: "off",
    screenshot: "off",
  },
  webServer: [
    {
      command: "node tests/support/fixture-server.mjs",
      url: "http://127.0.0.1:43139/health",
      env: { RVW_ENABLE_TEST_FIXTURE: "1", RVW_ENABLE_FIXTURE_CONTROLS: "1" },
    },
    {
      command: "node scripts/test-web.mjs",
      url: "http://127.0.0.1:3300/sign-in",
    },
  ],
});
