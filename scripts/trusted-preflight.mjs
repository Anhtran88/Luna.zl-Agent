import { pathToFileURL } from "node:url";

// Offline configuration lint only. Never reads files, opens sockets, or prints values.
export function trustedPreflight(env = {}) {
  const checks = [];
  const check = (name, valid) =>
    checks.push({ name, status: valid ? "configured-unverified" : "blocked" });
  const present = (name) => typeof env[name] === "string" && env[name].trim().length > 0;
  check("LUNA_IDENTITY_PROVIDER", env.LUNA_IDENTITY_PROVIDER === "better-auth");
  check("VITE_AUTH_ENABLED", env.VITE_AUTH_ENABLED === "true");
  check("LUNA_STORE_MODE", env.LUNA_STORE_MODE === "postgres");
  for (const name of [
    "BETTER_AUTH_SECRET",
    "GROK_AUTH_CLIENT_ID",
    "GROK_AUTH_CLIENT_SECRET",
    "LUNA_ACCESS_POLICY_FILE",
    "LUNA_POLICY_PUBLIC_KEY_FILE",
    "LUNA_POLICY_ISSUER",
  ])
    check(name, present(name));
  for (const name of ["BETTER_AUTH_URL", "GROK_AUTH_ISSUER"]) {
    let valid = false;
    try {
      const url = new URL(env[name]);
      valid =
        url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
    } catch {
      /* Missing/invalid configuration stays blocked. */
    }
    check(name, valid);
  }
  for (const name of ["DATABASE_URL", "LUNA_DATABASE_URL"]) {
    let valid = false;
    try {
      const url = new URL(env[name]);
      valid =
        ["postgres:", "postgresql:"].includes(url.protocol) &&
        Boolean(url.hostname) &&
        url.pathname.length > 1 &&
        url.searchParams.getAll("sslmode").length === 1 &&
        url.searchParams.get("sslmode") === "verify-full";
    } catch {
      /* No error details: URL parser errors can contain credentials. */
    }
    check(name, valid);
  }
  return {
    decision: "NO-GO",
    configurationComplete: checks.every((item) => item.status === "configured-unverified"),
    networkCalls: 0,
    mutations: 0,
    checks,
    ownerActions: [
      "approve-budget-region-TLS-backup",
      "provision-auth-client-and-databases",
      "apply-reviewed-migrations-with-admin",
      "verify-staging-session-isolation-recovery",
    ],
    nonSubstitutable: [
      "seven-independent-human-principals",
      "owner-signed-policy-and-trust-anchor",
      "governance-evidence-and-live-authorization",
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = trustedPreflight(process.env);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  // This exit code validates configuration only; it never grants staging/live GO.
  process.exitCode = report.configurationComplete ? 0 : 1;
}
