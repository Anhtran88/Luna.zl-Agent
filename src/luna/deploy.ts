import { PHASE4_ADAPTERS, browserContractsLocked } from "./adapters.ts";
import { LUNAZL_FIREBASE_DATABASE_URL } from "./config.ts";
import { LUNA_RELEASE } from "./domain.ts";

type Env = Record<string, string | undefined>;

export const DEPLOY_TARGETS = ["local", "staging", "production"] as const;
export type DeployTarget = (typeof DEPLOY_TARGETS)[number];

export interface DeployPosture {
  target: DeployTarget;
  mode: "dry-run";
  productionDeployed: false;
  network: false;
  blocked: boolean;
}

export interface PreflightCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface RollbackPlan {
  strategy: "local-no-op";
  previousRelease: "4-controlled";
  network: false;
  mutatesProduction: false;
  steps: readonly string[];
}

export interface HealthCheck {
  status: "skipped" | "local-ok" | "local-failed" | "refused";
  network: false;
  detail: string;
}

export interface DeployDryRunReport {
  target: DeployTarget;
  requestedTarget: string;
  mode: "dry-run";
  release: typeof LUNA_RELEASE;
  ok: boolean;
  productionNetwork: false;
  productionDeployed: false;
  rulesDeployed: false;
  publicPublish: false;
  checks: PreflightCheck[];
  health: HealthCheck;
  rollback: RollbackPlan;
  blockers: string[];
}

export interface DryRunInput {
  env: Env;
  files?: Record<string, string>;
  healthUrl?: string;
  fetchImpl?: typeof fetch;
  artifactPresent?: boolean;
  artifactLabel?: string;
}

const SECRET_ENV_KEYS = [
  "FIREBASE_SERVICE_ACCOUNT_JSON",
  "NINE_ROUTER_API_KEY",
  "FIREBASE_AUTH_TOKEN",
] as const;

const ENDPOINT_KEYS = [
  "LUNA_STAGING_URL",
  "LUNA_PRODUCTION_URL",
  "LUNA_PUBLIC_URL",
  "VERCEL_URL",
  "DEPLOY_URL",
] as const;

const SECRET_PATTERNS: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: "api-key", re: /\bsk-[A-Za-z0-9]{16,}\b/ },
  { id: "firebase-web-key", re: /\bAIza[0-9A-Za-z_-]{20,}\b/ },
  { id: "long-private-key-field", re: /"private_key"\s*:\s*"[^"]{40,}"/ },
];

export function isLoopbackUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:") return false;
  if (url.username || url.password || url.search) return false;
  return url.hostname === "127.0.0.1" || url.hostname === "localhost";
}

export function readDeployTarget(raw: string | undefined): {
  target: DeployTarget;
  requested: string;
  invalid: boolean;
} {
  const requested = raw?.trim() || "local";
  if (requested === "local" || requested === "staging" || requested === "production") {
    return { target: requested, requested, invalid: false };
  }
  return { target: "local", requested, invalid: true };
}

function firebaseLiveRequested(env: Env): boolean {
  return env.FIREBASE_LIVE_ENABLED === "true" || env.LUNA_FIREBASE_LIVE === "true";
}

function populatedSecretKeys(env: Env): string[] {
  return SECRET_ENV_KEYS.filter((key) => (env[key]?.trim().length ?? 0) > 0);
}

/** Name of the first env key that points outside loopback. Never returns the URL. */
export function unexpectedEndpointKey(env: Env): string | null {
  for (const key of ENDPOINT_KEYS) {
    const value = env[key]?.trim();
    if (!value) continue;
    if (isLoopbackUrl(value)) continue;
    return key;
  }
  const firebase = env.FIREBASE_DATABASE_URL?.trim().replace(/\/$/, "");
  if (firebase && firebase !== LUNAZL_FIREBASE_DATABASE_URL) return "FIREBASE_DATABASE_URL";
  const router = env.NINE_ROUTER_BASE_URL?.trim();
  if (router && !isLoopbackUrl(router)) return "NINE_ROUTER_BASE_URL";
  return null;
}

export function describeDeployPosture(env: Env): DeployPosture {
  const read = readDeployTarget(env.LUNA_DEPLOY_TARGET);
  const blocked =
    read.invalid ||
    read.target === "production" ||
    firebaseLiveRequested(env) ||
    env.LUNA_ALLOW_LIVE_MODELS === "true" ||
    unexpectedEndpointKey(env) !== null ||
    populatedSecretKeys(env).length > 0;
  return {
    target: read.target,
    mode: "dry-run",
    productionDeployed: false,
    network: false,
    blocked,
  };
}

export function planRollback(): RollbackPlan {
  return {
    strategy: "local-no-op",
    previousRelease: "4-controlled",
    network: false,
    mutatesProduction: false,
    steps: [
      "Nếu preflight thất bại, không đổi process đang chạy.",
      "Không gọi hosting, không deploy Firebase rules, không publish.",
      "Muốn quay lại baseline thì dùng commit local của Phase 4 hoặc main. Không có lệnh remote.",
    ],
  };
}

function scanFiles(files: Record<string, string>): PreflightCheck {
  const hits: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.re.test(text)) hits.push(`${path}:${pattern.id}`);
    }
  }
  if (hits.length === 0) {
    return { id: "secrets", ok: true, detail: "Không thấy private key hay API key trong file đã quét." };
  }
  return {
    id: "secrets",
    ok: false,
    detail: `Phát hiện mẫu secret, giá trị không được in: ${hits.join(", ")}.`,
  };
}

async function probeHealth(url: string | undefined, fetchImpl?: typeof fetch): Promise<HealthCheck> {
  if (!url?.trim()) {
    return { status: "skipped", network: false, detail: "Không yêu cầu health check." };
  }
  if (!isLoopbackUrl(url)) {
    return {
      status: "refused",
      network: false,
      detail: "Health check chỉ nhận http loopback. URL public không được gọi.",
    };
  }
  if (!fetchImpl) {
    return {
      status: "skipped",
      network: false,
      detail: "URL loopback hợp lệ nhưng không có fetch được tiêm, nên không gọi.",
    };
  }
  try {
    const response = await fetchImpl(url, { method: "GET" });
    if (response.ok) {
      return { status: "local-ok", network: false, detail: "Health loopback trả trạng thái thành công." };
    }
    return {
      status: "local-failed",
      network: false,
      detail: `Health loopback trả HTTP ${response.status}.`,
    };
  } catch {
    return { status: "local-failed", network: false, detail: "Health loopback không trả lời." };
  }
}

export async function dryRunDeploy(input: DryRunInput): Promise<DeployDryRunReport> {
  const env = input.env;
  const read = readDeployTarget(env.LUNA_DEPLOY_TARGET);
  const checks: PreflightCheck[] = [];

  checks.push(
    read.invalid
      ? {
          id: "target",
          ok: false,
          detail: "LUNA_DEPLOY_TARGET chỉ được là local, staging hoặc production.",
        }
      : {
          id: "target",
          ok: true,
          detail: `Môi trường ${read.target} chỉ được kiểm tra bằng dry-run.`,
        },
  );

  checks.push({
    id: "phase-lock",
    ok: true,
    detail: `Phase lock bật. Release ${LUNA_RELEASE}. Không có nút tắt.`,
  });

  checks.push(
    firebaseLiveRequested(env)
      ? {
          id: "firebase-live",
          ok: false,
          detail: "FIREBASE_LIVE_ENABLED phải là false. Dry-run không mở socket.",
        }
      : {
          id: "firebase-live",
          ok: true,
          detail: "Firebase live tắt. Adapter mặc định là memory. Emulator không được deploy.",
        },
  );

  checks.push(
    env.LUNA_ALLOW_LIVE_MODELS === "true"
      ? {
          id: "nine-router-live",
          ok: false,
          detail: "9Router live bị từ chối. Chi phí giữ ở $0 và không gọi API.",
        }
      : {
          id: "nine-router-live",
          ok: true,
          detail: "9Router live tắt. Model đang chạy là mock.",
        },
  );

  const browsersLocked =
    browserContractsLocked().length > 0 &&
    PHASE4_ADAPTERS.every((adapter) => adapter.liveEnabled === false && adapter.network === false);
  checks.push({
    id: "browser-launch",
    ok: browsersLocked,
    detail: browsersLocked
      ? "Browser liveLaunch tắt. Playwright, Skyvern và Browser Use chỉ là stub."
      : "Một contract browser không còn khóa. Dry-run dừng.",
  });

  const endpoint = unexpectedEndpointKey(env);
  checks.push(
    endpoint
      ? {
          id: "production-endpoint",
          ok: false,
          detail: `${endpoint} không phải loopback hoặc URL Firebase đã ghi nhận. Không gọi endpoint đó.`,
        }
      : {
          id: "production-endpoint",
          ok: true,
          detail: "Không có endpoint production mới. URL lunazl-agent chỉ được ghi nhận, không kết nối.",
        },
  );

  const secretKeys = populatedSecretKeys(env);
  checks.push(
    secretKeys.length > 0
      ? {
          id: "secret-env",
          ok: false,
          detail: `Các biến có giá trị và không được in hay dùng: ${secretKeys.join(", ")}.`,
        }
      : {
          id: "secret-env",
          ok: true,
          detail: "Không có service account hay API key trong môi trường dry-run.",
        },
  );

  checks.push(scanFiles(input.files ?? {}));

  if (read.target === "production") {
    const optedIn = env.LUNA_DEPLOY_PRODUCTION_OPT_IN === "true";
    checks.push({
      id: "production-opt-in",
      ok: false,
      detail: optedIn
        ? "Đã thấy opt-in nhưng Phase 5 vẫn khóa production. Không deploy."
        : "Thiếu opt-in production. Dù có opt-in, Phase 5 vẫn không deploy.",
    });
  } else if (read.target === "staging") {
    const staging = env.LUNA_STAGING_URL?.trim();
    const localOnly = !staging || isLoopbackUrl(staging);
    checks.push({
      id: "staging-network",
      ok: localOnly,
      detail: localOnly
        ? "Staging chỉ là dry-run local. Chưa có mạng staging cho đến khi chủ repo xác nhận."
        : "Staging URL public cần chủ repo xác nhận môi trường, credential và ngân sách. Không gọi.",
    });
  }

  checks.push({
    id: "firebase-rules",
    ok: true,
    detail: "Không deploy rules. Không mở read/write public.",
  });

  if (input.artifactPresent === undefined) {
    checks.push({
      id: "artifact",
      ok: true,
      detail: "Không chọn artifact. Không có gì được upload.",
    });
  } else if (input.artifactPresent) {
    checks.push({
      id: "artifact",
      ok: true,
      detail: `Artifact local ${input.artifactLabel ?? "unnamed"} chỉ được kiểm tra. Không upload.`,
    });
  } else {
    checks.push({
      id: "artifact",
      ok: false,
      detail: "Artifact được yêu cầu nhưng không có trên máy local.",
    });
  }

  const health = await probeHealth(input.healthUrl, input.fetchImpl);
  if (health.status === "refused" || health.status === "local-failed") {
    checks.push({ id: "health", ok: false, detail: health.detail });
  } else {
    checks.push({ id: "health", ok: true, detail: health.detail });
  }

  const blockers = checks.filter((check) => !check.ok).map((check) => check.id);
  return {
    target: read.target,
    requestedTarget: read.requested,
    mode: "dry-run",
    release: LUNA_RELEASE,
    ok: blockers.length === 0,
    productionNetwork: false,
    productionDeployed: false,
    rulesDeployed: false,
    publicPublish: false,
    checks,
    health,
    rollback: planRollback(),
    blockers,
  };
}
