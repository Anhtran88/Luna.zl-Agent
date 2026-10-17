import { LunaError } from "./domain.ts";

type Env = Record<string, string | undefined>;

export interface FirebasePublicConfig {
  projectId: string | null;
  databaseUrlHost: string | null;
  /** Origin only. No userinfo, path, query, or credential. */
  databaseUrl: string | null;
  credentialEnvVar: "FIREBASE_SERVICE_ACCOUNT_JSON" | "STAGING_FIREBASE_SERVICE_ACCOUNT_JSON";
  credentialConfigured: boolean;
  liveRequested: boolean;
  /** Recorded only. The server factory never opens an emulator socket. */
  emulatorRequested: boolean;
  /** Always false here. A live flag does not open a socket by itself. */
  liveEnabled: false;
}

export interface NineRouterPublicConfig {
  baseUrl: string;
  apiKeyEnvVar: "NINE_ROUTER_API_KEY";
  apiKeyConfigured: boolean;
  liveRequested: boolean;
  liveEnabled: false;
  aliases: Record<string, string>;
  combos: Record<string, string[]>;
  timeoutMs: number;
  maxRetries: number;
}

/** Public project coordinates. Not a credential. */
export const LUNAZL_FIREBASE_PROJECT_ID = "lunazl-agent";
export const LUNAZL_FIREBASE_DATABASE_URL =
  "https://lunazl-agent-default-rtdb.asia-southeast1.firebasedatabase.app";

export const STAGING_FIREBASE_PROJECT_ID = "lunazl-agent-staging-6dd7a";
export const STAGING_FIREBASE_DATABASE_URL =
  "https://lunazl-agent-staging-6dd7a-default-rtdb.asia-southeast1.firebasedatabase.app";
export const STAGING_FIREBASE_REGION = "asia-southeast1";

export const DEFAULT_NINE_ROUTER_BASE_URL = "http://127.0.0.1:20128/v1";

export const DEFAULT_MODEL_ALIASES: Record<string, string> = {
  "luna-fast": "mock/luna-planner",
  "luna-careful": "mock/luna-planner-fallback",
};

export const DEFAULT_MODEL_COMBOS: Record<string, string[]> = {
  "luna-resilient": ["mock/luna-planner", "mock/luna-planner-fallback"],
};

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function hasSecret(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

function assertPublicHttpUrl(raw: string, envName: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LunaError("CONFIG", `${envName} không phải URL hợp lệ.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new LunaError("CONFIG", `${envName} chỉ chấp nhận http hoặc https.`);
  }
  if (url.username || url.password || url.search) {
    throw new LunaError("CONFIG", `${envName} không được chứa secret, userinfo hoặc query.`);
  }
  return url;
}

export function loadFirebasePublicConfig(env: Env): FirebasePublicConfig {
  const environment = blankToNull(env.LUNA_FIREBASE_ENVIRONMENT) ?? "local";
  if (environment !== "local" && environment !== "staging") {
    throw new LunaError("CONFIG", "LUNA_FIREBASE_ENVIRONMENT chỉ nhận local hoặc staging.");
  }
  if (environment === "staging") {
    // No fallback to generic/production bindings, including credentials and flags.
    if (
      blankToNull(env.STAGING_FIREBASE_PROJECT_ID) !== STAGING_FIREBASE_PROJECT_ID ||
      blankToNull(env.STAGING_FIREBASE_DATABASE_URL) !== STAGING_FIREBASE_DATABASE_URL
    ) {
      throw new LunaError("CONFIG", "Staging cần đúng project và RTDB origin riêng đã ghi nhận.");
    }
    return {
      projectId: STAGING_FIREBASE_PROJECT_ID,
      databaseUrl: STAGING_FIREBASE_DATABASE_URL,
      databaseUrlHost: new URL(STAGING_FIREBASE_DATABASE_URL).host,
      credentialEnvVar: "STAGING_FIREBASE_SERVICE_ACCOUNT_JSON",
      credentialConfigured: hasSecret(env.STAGING_FIREBASE_SERVICE_ACCOUNT_JSON),
      liveRequested: env.STAGING_FIREBASE_LIVE_ENABLED === "true",
      emulatorRequested: false,
      liveEnabled: false,
    };
  }
  const projectId = blankToNull(env.FIREBASE_PROJECT_ID);
  const databaseUrlRaw = blankToNull(env.FIREBASE_DATABASE_URL);
  const databaseUrl = databaseUrlRaw
    ? assertPublicHttpUrl(databaseUrlRaw, "FIREBASE_DATABASE_URL").origin
    : null;

  return {
    projectId,
    databaseUrlHost: databaseUrl ? new URL(databaseUrl).host : null,
    databaseUrl,
    credentialEnvVar: "FIREBASE_SERVICE_ACCOUNT_JSON",
    credentialConfigured: hasSecret(env.FIREBASE_SERVICE_ACCOUNT_JSON),
    liveRequested: env.FIREBASE_LIVE_ENABLED === "true" || env.LUNA_FIREBASE_LIVE === "true",
    emulatorRequested: env.LUNA_FIREBASE_EMULATOR === "true",
    liveEnabled: false,
  };
}

export function loadNineRouterPublicConfig(env: Env): NineRouterPublicConfig {
  const rawBase = blankToNull(env.NINE_ROUTER_BASE_URL) ?? DEFAULT_NINE_ROUTER_BASE_URL;
  const url = assertPublicHttpUrl(rawBase, "NINE_ROUTER_BASE_URL");
  const baseUrl = `${url.origin}${url.pathname.replace(/\/$/, "")}`;

  return {
    baseUrl,
    apiKeyEnvVar: "NINE_ROUTER_API_KEY",
    apiKeyConfigured: hasSecret(env.NINE_ROUTER_API_KEY),
    liveRequested: env.LUNA_ALLOW_LIVE_MODELS === "true",
    liveEnabled: false,
    aliases: { ...DEFAULT_MODEL_ALIASES },
    combos: { ...DEFAULT_MODEL_COMBOS },
    timeoutMs: clampInt(env.LUNA_MODEL_TIMEOUT_MS, 15_000, 1_000, 60_000),
    maxRetries: clampInt(env.LUNA_MODEL_MAX_RETRIES, 0, 0, 2),
  };
}
