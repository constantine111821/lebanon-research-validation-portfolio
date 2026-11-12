import test from "node:test";
import assert from "node:assert/strict";
import { supabaseConfig } from "../../apps/web/src/lib/config.ts";

test("demo backend rejects hosted mode and off-loopback database settings", () => {
  const keys = ["RVW_BACKEND_MODE", "RVW_TEST_AUTH_LABEL", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"];
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.RVW_BACKEND_MODE = "local";
    process.env.RVW_TEST_AUTH_LABEL = "simulated";
    process.env.SUPABASE_URL = "http://127.0.0.1:43139";
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_simulated_local_test_only";
    assert.equal(supabaseConfig().url, "http://127.0.0.1:43139");
    process.env.RVW_BACKEND_MODE = "hosted";
    assert.throws(supabaseConfig, /PORTFOLIO_REQUIRES_LOCAL_SYNTHETIC_FIXTURE/);
    process.env.RVW_BACKEND_MODE = "local";
    process.env.SUPABASE_URL = "https://backend.example.invalid";
    assert.throws(supabaseConfig, /PORTFOLIO_REQUIRES_LOCAL_SYNTHETIC_FIXTURE/);
  } finally {
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});
