import { isLoopbackUrl, planRollback, unexpectedEndpointKey, type RollbackPlan } from "./deploy.ts";
import { DATA_SAFETY } from "./readiness.ts";
import { localProbes } from "./reliability.ts";
import { SCHEMA_VERSION } from "./schema.ts";
import { containsSecret, evaluateLiveGate } from "./security.ts";

type Env = Record<string, string | undefined>;
type Severity = "critical" | "high" | "medium" | "low";

export interface GateCheck {
  id: string;
  ok: boolean;
  severity: Severity;
  detail: string;
}

export interface GateBlocker {
  id: string;
  severity: Severity;
  detail: string;
}

export interface SignOffRow {
  id: string;
  role: string;
  status: "missing" | "claimed";
  authorizesDeploy: false;
}

export interface ProductionReport {
  decision: "NO-GO";
  authorization: "not-granted";
  signOffComplete: boolean;
  mode: "dry-run";
  executed: false;
  networkDeploy: false;
  networkCalls: 0;
  productionDeployed: false;
  rulesDeployed: false;
  estimatedUsd: 0;
  telemetry: false;
  live: { firebase: false; nineRouter: false; browserLaunch: false };
  checks: GateCheck[];
  blockers: GateBlocker[];
  signOff: SignOffRow[];
  checklist: GateCheck[];
  rollback: RollbackPlan;
  probes: ReturnType<typeof localProbes>;
}

export interface ProductionSummary {
  decision: "NO-GO";
  signOffComplete: boolean;
  networkDeploy: false;
  productionDeployed: false;
  blockers: number;
}

export interface ProductionInput {
  env?: Env;
  rulesDeny?: boolean;
  schemaVersion?: number;
  artifact?: { sha256: string; expectedSha256: string };
  sbom?: { directDependencies: number; lockfilePresent: boolean };
  backup?: { restoreDrill: boolean };
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

const SIGN_OFFS: ReadonlyArray<{ id: string; role: string; env: string; severity: Severity }> = [
  { id: "staging-confirmed", role: "staging", env: "LUNA_STAGING_CONFIRMED", severity: "critical" },
  { id: "environment-owner", role: "environment owner", env: "LUNA_ENVIRONMENT_OWNER_CONFIRMED", severity: "critical" },
  { id: "credential-owner", role: "credential owner", env: "LUNA_CREDENTIAL_OWNER_CONFIRMED", severity: "critical" },
  { id: "budget", role: "budget", env: "LUNA_BUDGET_CONFIRMED", severity: "critical" },
  { id: "security-approval", role: "security", env: "LUNA_SECURITY_APPROVAL", severity: "critical" },
  { id: "rollback-owner", role: "rollback owner", env: "LUNA_ROLLBACK_CONFIRMED", severity: "critical" },
  { id: "incident-owner", role: "incident owner", env: "LUNA_INCIDENT_OWNER_CONFIRMED", severity: "critical" },
  { id: "browser-policy", role: "browser policy", env: "LUNA_BROWSER_POLICY_CONFIRMED", severity: "high" },
  { id: "zalo-eoffice-policy", role: "Zalo/eOffice policy", env: "LUNA_ZALO_POLICY_CONFIRMED", severity: "high" },
  { id: "legal-privacy", role: "legal/privacy", env: "LUNA_LEGAL_PRIVACY_CONFIRMED", severity: "critical" },
];

export const CHANGE_RECORD = {
  release: "9-production",
  decision: "NO-GO" as const,
  network: false as const,
  productionDeployed: false as const,
  summary: "Hồ sơ go/no-go production. Không deploy và không gọi mạng.",
};

export const RELEASE_CHECKLIST = [
  "Staging URL và xác nhận của chủ repo.",
  "Chủ môi trường và chủ credential ngoài git.",
  "Ngân sách, phê duyệt an ninh, chủ rollback và chủ sự cố.",
  "Policy browser, Zalo/eOffice và legal/privacy.",
  "Artifact, SBOM local, schema v1 và biên bản backup/restore.",
  "Health production, alerting và deploy vẫn mở. Phase 9 không tự đóng các mục này.",
] as const;

export function assessProduction(input: ProductionInput = {}): ProductionReport {
  const env = input.env ?? {};
  const fetchImpl = input.fetchImpl;
  if (fetchImpl) {
    // Accepted only so a test can prove this gate never calls it.
  }
  const checks: GateCheck[] = [];
  const stagingUrl = env.LUNA_STAGING_URL?.trim() ?? "";
  const endpointKey = unexpectedEndpointKey(env);
  const live = evaluateLiveGate(env);
  const signOff: SignOffRow[] = SIGN_OFFS.map((row) => ({
    id: row.id,
    role: row.role,
    status: env[row.env] === "true" ? "claimed" : "missing",
    authorizesDeploy: false,
  }));

  for (const row of SIGN_OFFS) {
    const claimed = env[row.env] === "true";
    checks.push(
      check(
        row.id,
        false,
        row.severity,
        claimed ? `${row.env} chỉ là lời ghi nhận, không phải sign-off. Gate vẫn chặn.` : `Thiếu ${row.env}.`,
      ),
    );
  }

  if (!stagingUrl) {
    checks.push(check("staging-url", false, "critical", "Thiếu URL staging. Không suy đoán."));
  } else if (!isLoopbackUrl(stagingUrl)) {
    checks.push(check("staging-url", false, "critical", "URL staging không phải loopback. Không gọi."));
  } else {
    checks.push(check("staging-url", true, "critical", "URL staging là loopback. Không mở kết nối."));
  }

  const presentSecrets = SECRET_KEYS.filter((key) => (env[key]?.trim().length ?? 0) > 0);
  checks.push(
    presentSecrets.length === 0
      ? check("credential-absent", true, "critical", "Không có credential Luna trong môi trường được kiểm.")
      : check("credential-absent", false, "critical", `Có giá trị ở ${presentSecrets.join(", ")}. Giá trị không được in.`),
  );

  if (input.rulesDeny === true) checks.push(check("firebase-rules", true, "critical", "Rules mẫu deny-all. Không deploy."));
  else if (input.rulesDeny === false) checks.push(check("firebase-rules", false, "critical", "Rules không còn deny-all."));
  else checks.push(check("firebase-rules", false, "high", "Chưa xác nhận rules deny-all."));

  checks.push(
    live.violations.length === 0
      ? check("live-flags", true, "critical", "Firebase, 9Router và browser vẫn tắt.")
      : check("live-flags", false, "critical", `Có yêu cầu live: ${live.violations.join(", ")}. Yêu cầu bị từ chối.`),
  );

  const productionIntent =
    env.LUNA_DEPLOY_TARGET === "production" ||
    env.LUNA_DEPLOY_PRODUCTION_OPT_IN === "true" ||
    endpointKey === "LUNA_PRODUCTION_URL" ||
    endpointKey === "LUNA_PUBLIC_URL" ||
    endpointKey === "VERCEL_URL" ||
    endpointKey === "DEPLOY_URL";
  checks.push(
    productionIntent
      ? check("production-locked", false, "critical", "Có dấu hiệu production. Không có hành động nào được chạy.")
      : check("production-locked", true, "critical", "Production deploy vẫn khóa."),
  );

  const version = input.schemaVersion ?? SCHEMA_VERSION;
  checks.push(
    version === SCHEMA_VERSION && DATA_SAFETY.realDataAccess === false && DATA_SAFETY.migration === "additive-only"
      ? check("schema", true, "high", "Schema v1, chỉ thêm trường, không đụng dữ liệu thật.")
      : check("schema", false, "critical", "Schema không tương thích với v1."),
  );

  if (!input.artifact) {
    checks.push(check("artifact", false, "high", "Chưa có hash artifact. Không tạo hash giả."));
  } else if (!/^[a-f0-9]{64}$/i.test(input.artifact.sha256) ||
      !/^[a-f0-9]{64}$/i.test(input.artifact.expectedSha256) ||
      input.artifact.sha256.toLowerCase() !== input.artifact.expectedSha256.toLowerCase()) {
    checks.push(check("artifact", false, "high", "Hash artifact không khớp. Hash không được in."));
  } else {
    checks.push(check("artifact", true, "high", "Hash artifact khớp. Không upload."));
  }

  const sbom = input.sbom;
  checks.push(
    sbom && sbom.lockfilePresent && sbom.directDependencies > 0
      ? check("sbom", true, "medium", "Inventory local từ lockfile. Không tải thêm gói.")
      : check("sbom", false, "high", "Chưa có inventory dependency local."),
  );

  checks.push(
    input.backup?.restoreDrill === true
      ? check("backup", true, "high", "Có biên bản restore mock. Không đọc dữ liệu thật.")
      : check("backup", false, "high", "Chưa có biên bản backup/restore. Tài liệu không thay thế drill."),
  );

  const rollback = planRollback();
  checks.push(
    rollback.network === false && rollback.mutatesProduction === false
      ? check("rollback-plan", true, "high", "Rollback local-no-op.")
      : check("rollback-plan", false, "critical", "Rollback không an toàn."),
  );

  const probes = localProbes();
  checks.push(
    probes.network === false && probes.telemetry === false
      ? check("local-observability", true, "medium", "Probe và log chỉ ở local.")
      : check("local-observability", false, "high", "Observability không còn local."),
  );
  checks.push(check("production-health", false, "critical", "Không probe production và không gọi hosting."));
  checks.push(check("production-alerting", false, "high", "Không có alerting ngoài. Không gửi telemetry."));
  checks.push(check("phase-lock", true, "critical", "Approval, audit và phase lock không bypass được."));

  const secretFiles = Object.entries(input.files ?? {})
    .filter(([, text]) => containsSecret(text))
    .map(([path]) => path);
  checks.push(
    secretFiles.length === 0
      ? check("secret-files", true, "critical", "File được đưa vào không chứa credential.")
      : check("secret-files", false, "critical", `File có mẫu credential, giá trị không được in: ${secretFiles.join(", ")}.`),
  );

  const blockers = checks.filter((item) => !item.ok).map((item) => ({ id: item.id, severity: item.severity, detail: item.detail }));
  const ownerOpen = signOff.some((row) => row.status === "missing");
  const localOpen = checks.some((item) => !item.ok && item.id !== "production-health" && item.id !== "production-alerting");
  return {
    decision: "NO-GO",
    authorization: "not-granted",
    signOffComplete: !ownerOpen && !localOpen,
    mode: "dry-run",
    executed: false,
    networkDeploy: false,
    networkCalls: 0,
    productionDeployed: false,
    rulesDeployed: false,
    estimatedUsd: 0,
    telemetry: false,
    live: { firebase: false, nineRouter: false, browserLaunch: false },
    checks,
    blockers,
    signOff,
    checklist: checks,
    rollback,
    probes,
  };
}

export function summarizeProduction(report: ProductionReport): ProductionSummary {
  return {
    decision: "NO-GO",
    signOffComplete: report.signOffComplete,
    networkDeploy: false,
    productionDeployed: false,
    blockers: report.blockers.length,
  };
}

function check(id: string, ok: boolean, severity: Severity, detail: string): GateCheck {
  return { id, ok, severity, detail };
}
