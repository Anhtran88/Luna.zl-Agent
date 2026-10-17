import { LUNAZL_FIREBASE_DATABASE_URL } from "./config.ts";
import { BROWSER_CONTRACTS } from "./browser.ts";
import { PHASE4_ADAPTERS } from "./adapters.ts";
import { SECURITY_HEADERS, SESSION_COOKIE_POSTURE } from "./security-headers.ts";

export { SECURITY_HEADERS, SESSION_COOKIE_POSTURE };

const SECRET_PATTERNS: ReadonlyArray<{ rule: string; severity: Severity; re: RegExp }> = [
  { rule: "private-key", severity: "critical", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { rule: "private-key-field", severity: "critical", re: /"private_key"\s*:\s*"[^"]{12,}"/ },
  { rule: "api-key", severity: "high", re: /\bsk-[A-Za-z0-9]{12,}\b/ },
  { rule: "scoped-api-key", severity: "high", re: /\bsk-(?:proj-|svcacct-)[A-Za-z0-9_-]{12,}\b/ },
  { rule: "github-token", severity: "high", re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/ },
  { rule: "credential-field", severity: "high", re: /(?:^|[\s{,])["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|cookie)["']?\s*[=:]\s*(?:"(?:\\.|[^"\\])+"|'(?:\\.|[^'\\])+')/i },
  { rule: "private-storage-path", severity: "high", re: /(?:[A-Z]:\\+(?:Users|OneDrive)\\+|\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/OneDrive(?:\/|\b)|https?:\/\/(?:[^/\s]+\.)?(?:1drv\.ms|onedrive\.live\.com)\b)/i },
  { rule: "firebase-web-key", severity: "high", re: /\bAIza[0-9A-Za-z_-]{20,}\b/ },
  { rule: "bearer", severity: "high", re: /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i },
];

const ALLOWED_HOSTS = new Set([
  "github.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "lunazl-agent-default-rtdb.asia-southeast1.firebasedatabase.app",
  "localhost",
  "127.0.0.1",
  "grok.com",
  "www.grok.com",
  "og.grok.me",
  "gate.grok.me",
  "auth.grok.me",
  "gate.app-builder-testing.com",
  "preview.invalid",
]);

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface SecurityFinding {
  severity: Severity;
  path: string;
  rule: string;
}

export interface SecurityAuditRecord {
  action: string;
  outcome: "recorded" | "blocked" | "simulated";
  detail: string;
  dryRun: true;
}

export interface AbuseDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  network: false;
}

export interface LiveGate {
  firebaseLive: false;
  nineRouterLive: false;
  browserLaunch: false;
  productionDeploy: false;
  blocked: true;
}

export const SECURITY_POSTURE = {
  phaseLock: true as const,
  firebaseRules: "deny-all" as const,
  rateLimit: "local" as const,
  liveEnabled: false as const,
  productionDeploy: false as const,
};

const REDACTORS: ReadonlyArray<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted]"],
  [/"private_key"\s*:\s*"[^"]*"/g, '"private_key":"[redacted]"'],
  [/\bsk-[A-Za-z0-9]{8,}\b/g, "[redacted]"],
  [/\bsk-(?:proj-|svcacct-)[A-Za-z0-9_-]{8,}\b/g, "[redacted]"],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/g, "[redacted]"],
  [/\bAIza[0-9A-Za-z_-]{10,}\b/g, "[redacted]"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{8,}/gi, "Bearer [redacted]"],
  [/((?:api[_-]?key|token|secret|password|cookie)[ \t]*[=:][ \t]*)(["']?)[^\s"',;]{6,}/gi, "$1$2[redacted]"],
  [/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|cookie)["']?\s*[=:]\s*)"(?:\\.|[^"\\])*"/gi, '$1"[redacted]"'],
  [/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|cookie)["']?\s*[=:]\s*)'(?:\\.|[^'\\])*'/gi, "$1'[redacted]'"],
  [/(https?:\/\/)[^/\s@]+@/gi, "$1[redacted]@"],
  [/(?:[A-Z]:\\+(?:Users|OneDrive)\\+|\/Users\/|\/home\/[^/\s]+\/OneDrive(?:\/|\b))[^\s"'<>]*/gi, "[redacted-path]"],
  [/https?:\/\/(?:[^/\s]+\.)?(?:1drv\.ms|onedrive\.live\.com)\b[^\s"'<>]*/gi, "[redacted-path]"],
];

export function redactAuditDetail(value: string): string {
  let text = value;
  for (const [pattern, replacement] of REDACTORS) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

export function containsSecret(value: string): boolean {
  for (const pattern of SECRET_PATTERNS) {
    pattern.re.lastIndex = 0;
    if (pattern.re.test(value)) return true;
  }
  return /[^\s:]+:[^\s@]+@/.test(value) || /(?:api[_-]?key|token|secret|password|cookie)[ \t]*[=:][ \t]*\S{6,}/i.test(value);
}

export function sanitizePublicMessage(value: string): string {
  const cleaned = redactAuditDetail(value);
  if (!cleaned) return "Không xử lý được yêu cầu.";
  return cleaned.slice(0, 240);
}

/** Only opaque references belong in public governance metadata, never paths or prose. */
export function isOpaqueReference(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(value.trim()) && !containsSecret(value);
}

export function scanText(path: string, text: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  if (/\.env(?:\.[^/]*)?$/.test(path)) {
    for (const line of text.split(/\r?\n/)) {
      const assignment = /^\s*([a-z_][a-z0-9_]*)\s*=\s*(.*)$/i.exec(line);
      if (assignment && (/(?:TOKEN|SECRET|PASSWORD|COOKIE|API_?KEY|SERVICE_ACCOUNT_JSON)$/i.test(assignment[1]) || /^(?:LUNA_)?DATABASE_URL$/i.test(assignment[1])) && assignment[2].replace(/#.*$/, "").replace(/["'\s]/g, "")) {
        findings.push({ severity: "high", path, rule: "populated-secret-template" });
      }
    }
  }
  for (const pattern of SECRET_PATTERNS) {
    pattern.re.lastIndex = 0;
    if (pattern.re.test(text)) {
      findings.push({ severity: pattern.severity, path, rule: pattern.rule });
    }
  }
  const urls = text.match(/https?:\/\/[^\s"'`)<>]+/g) ?? [];
  const hosts = new Set<string>();
  for (const raw of urls) {
    if (raw.includes("$") || raw.includes("{") || raw.includes("*")) continue;
    try {
      const url = new URL(raw);
      const secretQuery = /(?:^|[?&])(?:auth|token|key|password|secret|sig)=/i.test(url.search);
      if (url.username || url.password || secretQuery) {
        findings.push({ severity: "high", path, rule: "url-userinfo" });
      }
      if (url.hostname.includes("*") || url.hostname.includes("$") || url.hostname === "[::1]") continue;
      hosts.add(url.hostname);
    } catch {
      findings.push({ severity: "medium", path, rule: "malformed-url" });
    }
  }
  for (const host of hosts) {
    if (host === "lunazl-agent-default-rtdb.asia-southeast1.firebasedatabase.app") {
      findings.push({ severity: "info", path, rule: "recorded-firebase-host" });
    } else if (!ALLOWED_HOSTS.has(host)) {
      findings.push({ severity: "medium", path, rule: `unexpected-host:${host}` });
    }
  }
  return findings;
}

export function rulesDenyByDefault(document: unknown): boolean {
  if (!document || typeof document !== "object" || !("rules" in document)) return false;
  const rules = (document as { rules: unknown }).rules;
  if (!rules || typeof rules !== "object") return false;
  const root = rules as Record<string, unknown>;
  if (root[".read"] !== false || root[".write"] !== false) return false;
  return walkRules(root);
}

function walkRules(node: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(node)) {
    if (key === ".read" || key === ".write") {
      if (value !== false) return false;
      continue;
    }
    if (key.startsWith(".")) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    if (!walkRules(value as Record<string, unknown>)) return false;
  }
  return true;
}

export function evaluateLiveGate(env: Record<string, string | undefined>): {
  gate: LiveGate;
  violations: string[];
} {
  const violations: string[] = [];
  if (env.FIREBASE_LIVE_ENABLED === "true" || env.LUNA_FIREBASE_LIVE === "true" || env.STAGING_FIREBASE_LIVE_ENABLED === "true") {
    violations.push("firebase-live");
  }
  if (env.LUNA_ALLOW_LIVE_MODELS === "true") violations.push("nine-router-live");
  if (env.LUNA_BROWSER_LAUNCH === "true") violations.push("browser-launch");
  if (env.LUNA_DEPLOY_TARGET === "production" || env.LUNA_DEPLOY_PRODUCTION_OPT_IN === "true") {
    violations.push("production-deploy");
  }
  const browsersLocked = BROWSER_CONTRACTS.every((contract) => contract.liveLaunch === false);
  const adaptersLocked = PHASE4_ADAPTERS.every((adapter) => adapter.liveEnabled === false);
  if (!browsersLocked || !adaptersLocked) violations.push("contract-unlocked");
  return {
    gate: {
      firebaseLive: false,
      nineRouterLive: false,
      browserLaunch: false,
      productionDeploy: false,
      blocked: true,
    },
    violations,
  };
}

export function preflightAudit(input: {
  ok: boolean;
  blockers: readonly string[];
}): SecurityAuditRecord[] {
  return [
    {
      action: "deploy.preflight",
      outcome: input.ok ? "simulated" : "blocked",
      detail: redactAuditDetail(
        input.ok ? "Preflight local đạt. Không deploy." : `Preflight bị chặn: ${input.blockers.join(",")}.`,
      ),
      dryRun: true,
    },
  ];
}

export class LocalRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(limit: number, windowMs: number, now: () => number = () => Date.now()) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  decide(rawKey: string): AbuseDecision {
    const key = containsSecret(rawKey) ? "redacted" : rawKey.replace(/[^\w:.-]/g, "").slice(0, 80) || "anonymous";
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, this.windowMs - (now - recent[0])),
        network: false,
      };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true, remaining: this.limit - recent.length, retryAfterMs: 0, network: false };
  }
}

const sharedLimiter = new LocalRateLimiter(180, 60_000);

export function guardLocalRequest(scope: string): void {
  const decision = sharedLimiter.decide(scope);
  if (!decision.allowed) throw new Error("Quá nhiều yêu cầu cục bộ.");
}

export function parseCreateTaskInput(input: unknown): { goal: string; title: string } {
  if (!input || typeof input !== "object") throw new Error("Payload không hợp lệ.");
  const body = input as Record<string, unknown>;
  if (
    body.mode === "live" ||
    body.firebaseLive === true ||
    body.nineRouterLive === true ||
    body.browserLaunch === true ||
    body.productionDeploy === true
  ) {
    throw new Error("API không bật được live, browser thật hoặc production.");
  }
  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (containsSecret(goal) || containsSecret(title)) {
    throw new Error("Nội dung không được chứa credential.");
  }
  if (goal.length < 3 || goal.length > 2000) throw new Error("Mục tiêu cần từ 3 đến 2000 ký tự.");
  if (title.length > 120) throw new Error("Tiêu đề quá dài.");
  return {
    goal: stripControls(goal, true),
    title: stripControls(title, false),
  };
}

function stripControls(value: string, keepNewline: boolean): string {
  let out = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code >= 32 || code === 9 || (keepNewline && (code === 10 || code === 13))) out += char;
  }
  return out;
}

export const RECORDED_FIREBASE_URL = LUNAZL_FIREBASE_DATABASE_URL;
