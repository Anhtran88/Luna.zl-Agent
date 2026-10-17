import { isLoopbackUrl, planRollback, unexpectedEndpointKey, type RollbackPlan } from "./deploy.ts";
import { DATA_SAFETY } from "./readiness.ts";
import { localProbes } from "./reliability.ts";
import { SCHEMA_VERSION } from "./schema.ts";
import { containsSecret, evaluateLiveGate } from "./security.ts";

type Env = Record<string, string | undefined>;
type Severity = "critical" | "high" | "medium" | "low";

export interface StagingCheck {
  id: string;
  ok: boolean;
  severity: Severity;
  detail: string;
}

export interface StagingBlocker {
  id: string;
  severity: Severity;
  detail: string;
}

export interface StagingReport {
  decision: "NO-GO" | "LOCAL-REHEARSAL-ONLY";
  mode: "dry-run";
  executed: false;
  networkDeploy: false;
  networkCalls: 0;
  productionDeployed: false;
  rulesDeployed: false;
  estimatedUsd: 0;
  telemetry: false;
  checks: StagingCheck[];
  blockers: StagingBlocker[];
  plan: readonly string[];
  rollback: RollbackPlan;
  probes: ReturnType<typeof localProbes>;
}

export interface StagingSummary {
  decision: "NO-GO" | "LOCAL-REHEARSAL-ONLY";
  networkDeploy: false;
  productionDeployed: false;
  blockers: number;
}

export interface StagingInput {
  env?: Env;
  rulesDeny?: boolean;
  schemaVersion?: number;
  artifactPresent?: boolean;
  smokeOk?: boolean;
  files?: Record<string, string>;
  fetchImpl?: () => Promise<unknown>;
}

const SECRET_KEYS = [
  "FIREBASE_SERVICE_ACCOUNT_JSON",
  "STAGING_FIREBASE_SERVICE_ACCOUNT_JSON",
  "DATABASE_URL", "LUNA_DATABASE_URL", "BETTER_AUTH_SECRET", "GROK_AUTH_CLIENT_SECRET",
  "FIREBASE_AUTH_TOKEN",
  "NINE_ROUTER_API_KEY",
  "LUNA_BROWSER_COOKIE",
] as const;

export const STAGING_PLAN = [
  "Xác nhận URL, chủ môi trường, chủ credential, ngân sách và phê duyệt an ninh ngoài git.",
  "Chạy preflight. Thiếu một điều kiện thì dừng ở NO-GO.",
  "Giữ Firebase memory hoặc emulator loopback. Rules deny-all và không deploy.",
  "Giữ model mock và browser mock. Chi phí $0.",
  "Đối chiếu schema v1 và artifact local. Không đọc dữ liệu thật.",
  "Health và smoke chỉ ghi nhận kết quả local. URL public không được gọi.",
  "Rollback là local-no-op. Không có lệnh hosting hay firewall.",
] as const;

export function assessStaging(input: StagingInput = {}): StagingReport {
  const env = input.env ?? {};
  const checks: StagingCheck[] = [];
  const fetchImpl = input.fetchImpl;
  if (fetchImpl) {
    // Accepted only so callers can prove this gate does not open a connection.
  }
  const stagingUrl = env.LUNA_STAGING_URL?.trim() ?? "";
  const endpointKey = unexpectedEndpointKey(env);
  const live = evaluateLiveGate(env);
  const rollback = planRollback();
  const probes = localProbes();

  if (!stagingUrl) {
    checks.push(check("staging-url", false, "critical", "Thiếu LUNA_STAGING_URL. Không suy đoán URL."));
  } else if (!isLoopbackUrl(stagingUrl)) {
    checks.push(check("staging-url", false, "critical", "LUNA_STAGING_URL không phải loopback. Không gọi."));
  } else {
    checks.push(check("staging-url", true, "critical", "URL staging là loopback. Phase 8 không mở kết nối."));
  }

  flag(checks, env, "staging-confirmed", "LUNA_STAGING_CONFIRMED", "critical");
  flag(checks, env, "environment-owner", "LUNA_ENVIRONMENT_OWNER_CONFIRMED", "critical");
  flag(checks, env, "credential-owner", "LUNA_CREDENTIAL_OWNER_CONFIRMED", "critical");
  flag(checks, env, "budget", "LUNA_BUDGET_CONFIRMED", "high");
  flag(checks, env, "security-approval", "LUNA_SECURITY_APPROVAL", "high");
  flag(checks, env, "rollback-owner", "LUNA_ROLLBACK_CONFIRMED", "high");
  flag(checks, env, "browser-policy", "LUNA_BROWSER_POLICY_CONFIRMED", "high");
  flag(checks, env, "zalo-eoffice-policy", "LUNA_ZALO_POLICY_CONFIRMED", "high");

  const presentSecrets = SECRET_KEYS.filter((key) => (env[key]?.trim().length ?? 0) > 0);
  checks.push(
    presentSecrets.length === 0
      ? check("credential-absent", true, "critical", "Không có credential Luna trong môi trường được kiểm.")
      : check(
          "credential-absent",
          false,
          "critical",
          `Có giá trị ở ${presentSecrets.join(", ")}. Giá trị không được in hay dùng.`,
        ),
  );

  if (input.rulesDeny === true) {
    checks.push(check("firebase-rules", true, "critical", "Rules mẫu đang deny-all. Không deploy."));
  } else if (input.rulesDeny === false) {
    checks.push(check("firebase-rules", false, "critical", "Rules không còn deny-all. Không deploy."));
  } else {
    checks.push(check("firebase-rules", false, "high", "Chưa xác nhận rules deny-all trong lần chạy này."));
  }

  checks.push(
    live.violations.length === 0
      ? check("live-flags", true, "critical", "Firebase, 9Router, browser và production vẫn khóa.")
      : check("live-flags", false, "critical", `Live flag bị yêu cầu: ${live.violations.join(", ")}.`),
  );

  const production =
    env.LUNA_DEPLOY_TARGET === "production" ||
    env.LUNA_DEPLOY_PRODUCTION_OPT_IN === "true" ||
    endpointKey === "LUNA_PRODUCTION_URL" ||
    endpointKey === "LUNA_PUBLIC_URL" ||
    endpointKey === "VERCEL_URL" ||
    endpointKey === "DEPLOY_URL";
  checks.push(
    production
      ? check("production-locked", false, "critical", "Phát hiện ý định production. Không có hành động nào được chạy.")
      : check("production-locked", true, "critical", "Production deploy vẫn khóa."),
  );

  const version = input.schemaVersion ?? SCHEMA_VERSION;
  checks.push(
    version === SCHEMA_VERSION && DATA_SAFETY.migration === "additive-only" && DATA_SAFETY.realDataAccess === false
      ? check("schema", true, "high", "Schema v1, migration chỉ thêm trường, không đụng dữ liệu thật.")
      : check("schema", false, "high", "Schema không tương thích với v1 hoặc đụng dữ liệu thật."),
  );

  checks.push(
    input.artifactPresent === true
      ? check("artifact", true, "high", "Artifact local được ghi nhận. Không upload.")
      : check("artifact", false, "high", "Chưa có artifact local trong lần đánh giá này."),
  );

  checks.push(
    input.smokeOk === true
      ? check("smoke", true, "medium", "Smoke local được ghi nhận.")
      : check("smoke", false, "medium", "Chưa có smoke local trong lần đánh giá này."),
  );

  checks.push(
    stagingUrl && isLoopbackUrl(stagingUrl)
      ? check("health", true, "high", "Health loopback chỉ được ghi nhận. Fetch không được gọi.")
      : check("health", false, "high", "Không chạy health check vì URL thiếu hoặc không phải loopback."),
  );

  checks.push(
    rollback.network === false && rollback.mutatesProduction === false
      ? check("rollback-plan", true, "high", "Rollback local-no-op, không gọi hosting.")
      : check("rollback-plan", false, "critical", "Rollback không an toàn."),
  );

  checks.push(
    probes.telemetry === false && probes.network === false
      ? check("observability", true, "medium", "Log và probe ở local. Không gửi telemetry.")
      : check("observability", false, "high", "Observability không còn local."),
  );

  const secretFiles = Object.entries(input.files ?? {})
    .filter(([, text]) => containsSecret(text))
    .map(([path]) => path);
  checks.push(
    secretFiles.length === 0
      ? check("secret-files", true, "critical", "File được đưa vào không chứa mẫu credential.")
      : check("secret-files", false, "critical", `File có mẫu credential, giá trị không được in: ${secretFiles.join(", ")}.`),
  );

  const blockers = checks
    .filter((item) => !item.ok)
    .map((item) => ({ id: item.id, severity: item.severity, detail: item.detail }));
  return {
    decision: blockers.length === 0 ? "LOCAL-REHEARSAL-ONLY" : "NO-GO",
    mode: "dry-run",
    executed: false,
    networkDeploy: false,
    networkCalls: 0,
    productionDeployed: false,
    rulesDeployed: false,
    estimatedUsd: 0,
    telemetry: false,
    checks,
    blockers,
    plan: STAGING_PLAN,
    rollback,
    probes,
  };
}

export function summarizeStaging(report: StagingReport): StagingSummary {
  return {
    decision: report.decision,
    networkDeploy: false,
    productionDeployed: false,
    blockers: report.blockers.length,
  };
}

function flag(checks: StagingCheck[], env: Env, id: string, key: string, severity: Severity): void {
  checks.push(
    env[key] === "true"
      ? check(id, false, severity, `${key} chỉ là lời ghi nhận, không phải bằng chứng. Gate vẫn chặn.`)
      : check(id, false, severity, `Thiếu ${key}.`),
  );
}

function check(id: string, ok: boolean, severity: Severity, detail: string): StagingCheck {
  return { id, ok, severity, detail };
}
