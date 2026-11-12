import { startWeb } from "./local-web.mjs";

const app = startWeb(3300);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => app.kill(signal));
}
app.on("exit", (code) => { process.exitCode = code ?? 1; });
