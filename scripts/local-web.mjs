import path from "node:path";
import { spawn } from "node:child_process";

export function startWeb(port) {
  if (![3000, 3300].includes(port)) throw new Error("Unsupported demo app port");
  const web = path.resolve("apps/web");
  return spawn(
    process.execPath,
    [path.join(web, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: web,
      env: {
        ...process.env,
        RVW_BACKEND_MODE: "local",
        RVW_TEST_AUTH_LABEL: "simulated",
        SUPABASE_URL: "http://127.0.0.1:43139",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_simulated_local_test_only",
        APP_ORIGIN: `http://127.0.0.1:${port}`,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: "inherit",
      windowsHide: true,
    },
  );
}
