import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { verifiedSubject, verifySignedPolicy, bindAccess } from "../access-policy.ts";
import { SqlWorkspaceStore } from "../atomic-store.ts";
import { WorkspaceService } from "../workspace-service.ts";
import { postgresPort } from "../postgres-port.ts";
import { LunaError } from "../domain.ts";
import { sessionIdentity } from "../session-verifier.ts";

let pool: Pool | undefined;

/** No resolver setter/mock provider exists in runtime. Tests inject verifiers into pure functions. */
export async function workspaceRuntime() {
  const provider = process.env.LUNA_IDENTITY_PROVIDER?.trim();
  if (!provider) {
    if (
      (process.env.LUNA_DEPLOY_TARGET && process.env.LUNA_DEPLOY_TARGET !== "local") ||
      process.env.LUNA_DATABASE_URL ||
      process.env.LUNA_STORE_MODE ||
      process.env.DATABASE_URL ||
      process.env.VITE_AUTH_ENABLED === "true"
    )
      throw new LunaError(
        "AUTH_REQUIRED",
        "Cần cấu hình trusted authentication, không fallback demo trên staging/database.",
      );
    return null; // Separate local-only mock demo; cannot approve/execute or access durable records.
  }
  if (provider !== "better-auth" || process.env.VITE_AUTH_ENABLED !== "true")
    throw new LunaError("AUTH_REQUIRED", "Trusted identity provider chưa sẵn sàng.");
  const required = [
    "DATABASE_URL",
    "BETTER_AUTH_URL",
    "BETTER_AUTH_SECRET",
    "GROK_AUTH_CLIENT_ID",
    "GROK_AUTH_CLIENT_SECRET",
    "LUNA_ACCESS_POLICY_FILE",
    "LUNA_POLICY_PUBLIC_KEY_FILE",
    "LUNA_POLICY_ISSUER",
  ];
  if (required.some((name) => !process.env[name]?.trim()))
    throw new LunaError("AUTH_REQUIRED", "Cấu hình session/policy tin cậy chưa đầy đủ.");
  const { assertSameSiteRequest } = await import("../../lib/auth/isolation.server");
  assertSameSiteRequest();
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();
  if (!request) throw new LunaError("AUTH_REQUIRED", "Không có request session.");
  const { auth, authConfigured } = await import("../../lib/auth/server");
  const subject = await verifiedSubject(async () => {
    if (!authConfigured) return null;
    // Database session lookup: disabled cookie cache prevents accepting a revoked cached session.
    return sessionIdentity((options) => auth.api.getSession(options), request.headers);
  });
  const token = (await readFile(process.env.LUNA_ACCESS_POLICY_FILE!, "utf8")).trim();
  const keyText = await readFile(process.env.LUNA_POLICY_PUBLIC_KEY_FILE!, "utf8");
  if (token.length > 65536 || keyText.length > 8192)
    throw new LunaError("POLICY_INVALID", "Policy quá lớn.");
  const signed = await verifySignedPolicy(
    token,
    JSON.parse(keyText),
    process.env.LUNA_POLICY_ISSUER!,
  );
  const access = bindAccess(subject, signed);
  if (process.env.LUNA_STORE_MODE !== "postgres" || !process.env.LUNA_DATABASE_URL?.trim())
    throw new LunaError(
      "PERSISTENCE",
      "Cần PostgreSQL đã migration; không fallback memory cho verified users.",
    );
  // No auto-migration, URL logging or connection attempt before trusted access is established.
  pool ??= new Pool({
    connectionString: process.env.LUNA_DATABASE_URL,
    max: 4,
    connectionTimeoutMillis: 5000,
  });
  return { access, service: new WorkspaceService(new SqlWorkspaceStore(postgresPort(pool))) };
}

export function trustedAuthEnabled(): boolean {
  return (
    process.env.LUNA_IDENTITY_PROVIDER === "better-auth" &&
    process.env.VITE_AUTH_ENABLED === "true" &&
    [
      "DATABASE_URL",
      "BETTER_AUTH_URL",
      "BETTER_AUTH_SECRET",
      "GROK_AUTH_CLIENT_ID",
      "GROK_AUTH_CLIENT_SECRET",
    ].every((name) => Boolean(process.env[name]?.trim()))
  );
}
