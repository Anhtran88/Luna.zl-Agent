import { LunaError } from "./domain.ts";

type Env = Record<string, string | undefined>;

export interface FirebasePublicConfig {
  projectId: string | null;
  databaseUrlHost: string | null;
  credentialEnvVar: "FIREBASE_SERVICE_ACCOUNT_JSON";
  credentialConfigured: boolean;
  liveRequested: boolean;
  /** Always false in Phase 0/1. A request to go live does not open a client. */
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
}

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
  const projectId = blankToNull(env.FIREBASE_PROJECT_ID);
  const databaseUrl = blankToNull(env.FIREBASE_DATABASE_URL);
  const databaseUrlHost = databaseUrl
    ? assertPublicHttpUrl(databaseUrl, "FIREBASE_DATABASE_URL").host
    : null;

  return {
    projectId,
    databaseUrlHost,
    credentialEnvVar: "FIREBASE_SERVICE_ACCOUNT_JSON",
    credentialConfigured: hasSecret(env.FIREBASE_SERVICE_ACCOUNT_JSON),
    liveRequested: env.LUNA_FIREBASE_LIVE === "true",
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
  };
}
