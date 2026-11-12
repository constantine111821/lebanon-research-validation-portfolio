const fixtureURL = "http://127.0.0.1:43139";
const fixtureKey = "sb_publishable_simulated_local_test_only";

export function supabaseConfig() {
  if (
    process.env.RVW_BACKEND_MODE !== "local" ||
    process.env.RVW_TEST_AUTH_LABEL !== "simulated" ||
    process.env.SUPABASE_URL !== fixtureURL ||
    process.env.SUPABASE_PUBLISHABLE_KEY !== fixtureKey
  ) {
    throw new Error("PORTFOLIO_REQUIRES_LOCAL_SYNTHETIC_FIXTURE");
  }
  return { url: fixtureURL, key: fixtureKey };
}

export function cookieSecurity() {
  return { httpOnly: true, sameSite: "lax" as const, secure: false, path: "/" };
}
