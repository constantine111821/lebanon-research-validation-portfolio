import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { startWeb } from "./local-web.mjs";

async function checkPort(port) {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}

for (const port of [3000, 43139]) await checkPort(port);
const services = [
  spawn(process.execPath, ["tests/support/fixture-server.mjs"], {
    env: { ...process.env, RVW_ENABLE_TEST_FIXTURE: "1", RVW_FIXTURE_PORT: "43139" },
    stdio: "inherit",
    windowsHide: true,
  }),
  startWeb(3000),
];
function stop() {
  for (const service of services) if (!service.killed) service.kill();
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
for (const service of services) service.once("exit", (code) => {
  if (code) process.exitCode = code;
  stop();
});
