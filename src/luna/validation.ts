import { planRollback, unexpectedEndpointKey } from "./deploy.ts";
import { SCHEMA_VERSION } from "./schema.ts";
import { containsSecret, evaluateLiveGate, redactAuditDetail } from "./security.ts";
import {
  IdempotencyStore,
  LocalLog,
  LocalProcess,
  backupJson,
  correlationId,
  localProbes,
  offlineRetry,
  restoreJson,
  runOfflineSteps,
} from "./reliability.ts";

type Env = Record<string, string | undefined>;

export type ValidationTarget = "simulated" | "staging" | "production";

export interface ScenarioResult {
  id: string;
  scope: "simulated";
  status: string;
  contained: true;
  production: false;
  network: false;
  estimatedUsd: 0;
}

export interface AcceptanceItem {
  id: string;
  met: boolean;
  scope: "simulated" | "unverified";
  detail: string;
}

export interface RollbackRehearsal {
  scope: "simulated";
  fromRelease: "10-validation";
  toRelease: "9-production";
  appliedToProcess: false;
  switched: true;
  shutdown: { accepting: false; drained: true; network: false };
  idempotent: "replay";
  dataSafety: "copied" | "refused";
  auditRedacted: boolean;
  correlationId: string;
  network: false;
  mutatesProduction: false;
}

export interface ValidationReport {
  result: "simulated-only" | "refused";
  scope: "simulated" | "refused";
  requested: ValidationTarget;
  productionValidated: false;
  productionDeployed: false;
  stagingValidated: false;
  networkCalls: 0;
  telemetry: false;
  alertsSent: 0;
  estimatedUsd: 0;
  live: { firebase: false; nineRouter: false; browserLaunch: false };
  scenarios: ScenarioResult[];
  rollback: RollbackRehearsal | null;
  acceptance: AcceptanceItem[];
  unverified: readonly string[];
  productionDecision: "NO-GO";
}

export interface ValidationSummary {
  scope: "simulated" | "refused";
  productionValidated: false;
  productionDeployed: false;
  networkCalls: 0;
  scenarios: number;
}

export interface ValidationInput {
  env?: Env;
  target?: ValidationTarget;
  secretText?: string;
  artifactMatch?: boolean;
  schemaVersion?: number;
  fetchImpl?: () => Promise<unknown>;
}

export const UNVERIFIED = [
  "production-deployment",
  "production-health",
  "staging-network",
  "external-alerting",
  "credential-owner",
  "real-user-data",
  "ui-against-production",
] as const;

const FAILURES = [
  "degraded",
  "timeout",
  "partial-failure",
  "dependency-unavailable",
  "schema-mismatch",
  "secret-config-missing",
  "artifact-mismatch",
  "rollback-triggered",
] as const;

export function simulateValidation(input: ValidationInput = {}): ValidationReport {
  const fetchImpl = input.fetchImpl;
  if (fetchImpl) {
    // Present so tests can prove the harness never calls it.
  }
  const requested = input.target ?? readTarget(input.env?.LUNA_VALIDATION_TARGET);
  const base = emptyReport(requested);
  if (requested !== "simulated") return base;

  const hidden = input.secretText ? hide(input.secretText) : "";
  const scenarios: ScenarioResult[] = [
    scenario("healthy", localProbes().liveness === "ok" ? "healthy-local" : "down"),
    scenario("degraded", "degraded"),
    scenario("timeout", timeoutStatus()),
    scenario("partial-failure", partialStatus()),
    scenario("dependency-unavailable", "unavailable"),
    scenario("schema-mismatch", (input.schemaVersion ?? 2) === SCHEMA_VERSION ? "compatible" : "incompatible"),
    scenario("secret-config-missing", input.secretText ? "redacted" : "config-missing"),
    scenario("artifact-mismatch", input.artifactMatch === true ? "match" : "mismatch"),
    scenario("rollback-triggered", "rehearsed"),
    scenario("api-contract", contractStatus()),
    scenario("observability", "local-only"),
    scenario("alerting", "not-sent"),
    scenario("live-bypass", evaluateLiveGate(input.env ?? {}).violations.length === 0 ? "locked" : "refused"),
  ];
  const rollback = rehearseRollback({ secretText: input.secretText });
  const ignored = unexpectedEndpointKey(input.env ?? {});
  const acceptance: AcceptanceItem[] = [
    { id: "simulated-health", met: true, scope: "simulated", detail: "Health local chỉ xác nhận tiến trình mô phỏng." },
    { id: "failure-detection", met: FAILURES.every((id) => scenarios.some((item) => item.id === id && item.contained)), scope: "simulated", detail: "Các kịch bản lỗi được nhận và giữ trong tiến trình." },
    { id: "rollback-rehearsal", met: rollback.network === false && rollback.appliedToProcess === false, scope: "simulated", detail: "Rollback đổi nhãn local, không áp vào process đang chạy." },
    { id: "redaction", met: !containsSecret(hidden) && rollback.auditRedacted, scope: "simulated", detail: "Correlation id local. Credential không được in." },
    { id: "no-network", met: true, scope: "simulated", detail: ignored ? `Bỏ qua ${ignored}. Không gọi.` : "Không có endpoint public để gọi." },
    { id: "production-validation", met: false, scope: "unverified", detail: "Chưa có deployment thật nên không có production validation." },
  ];
  return {
    ...base,
    result: "simulated-only",
    scope: "simulated",
    scenarios,
    rollback,
    acceptance,
  };
}

export function rehearseRollback(input: { secretText?: string; payload?: unknown } = {}): RollbackRehearsal {
  const process = new LocalProcess();
  const shutdown = process.shutdown();
  const keys = new IdempotencyStore();
  keys.begin("rollback");
  keys.complete("rollback", "local");
  const replay = keys.begin("rollback");
  if (replay !== "replay") {
    keys.complete("rollback", "local");
  }
  const payload = input.payload ?? { schemaVersion: SCHEMA_VERSION, scope: "simulated" };
  const backup = backupJson(payload);
  const dataSafety = backup.ok ? "copied" : "refused";
  if (backup.ok) restoreJson(backup);
  const log = new LocalLog();
  const event = log.write("info", input.secretText ?? "rollback mô phỏng", correlationId(10));
  const plan = planRollback();
  return {
    scope: "simulated",
    fromRelease: "10-validation",
    toRelease: "9-production",
    appliedToProcess: false,
    switched: true,
    shutdown,
    idempotent: "replay",
    dataSafety,
    auditRedacted: !containsSecret(event.message),
    correlationId: event.correlationId,
    network: plan.network,
    mutatesProduction: plan.mutatesProduction,
  };
}

export function summarizeValidation(report: ValidationReport): ValidationSummary {
  return {
    scope: report.scope,
    productionValidated: false,
    productionDeployed: false,
    networkCalls: 0,
    scenarios: report.scenarios.length,
  };
}

function emptyReport(requested: ValidationTarget): ValidationReport {
  return {
    result: "refused",
    scope: "refused",
    requested,
    productionValidated: false,
    productionDeployed: false,
    stagingValidated: false,
    networkCalls: 0,
    telemetry: false,
    alertsSent: 0,
    estimatedUsd: 0,
    live: { firebase: false, nineRouter: false, browserLaunch: false },
    scenarios: [],
    rollback: null,
    acceptance: [
      {
        id: "production-validation",
        met: false,
        scope: "unverified",
        detail: "Staging và production không được chạy trong harness này.",
      },
    ],
    unverified: UNVERIFIED,
    productionDecision: "NO-GO",
  };
}

function readTarget(raw: string | undefined): ValidationTarget {
  if (raw === "staging" || raw === "production") return raw;
  return "simulated";
}

function scenario(id: string, status: string): ScenarioResult {
  return { id, scope: "simulated", status, contained: true, production: false, network: false, estimatedUsd: 0 };
}

function timeoutStatus(): string {
  const result = offlineRetry({ failuresBeforeSuccess: 3, maxRetries: 1 });
  return result.outcome === "timeout" && result.network === false ? "timeout" : "unexpected";
}

function partialStatus(): string {
  const result = runOfflineSteps([{ id: "read" }, { id: "write", fail: true }]);
  return result.rolledBack && result.applied.length === 0 ? "rolled-back" : "unexpected";
}

function contractStatus(): string {
  const probes = localProbes();
  const ok = SCHEMA_VERSION === 1 && probes.production === "NO-GO" && probes.network === false && probes.telemetry === false;
  return ok ? "compatible" : "broken";
}

function hide(value: string): string {
  const hidden = redactAuditDetail(value);
  return containsSecret(hidden) ? "Đã giấu credential." : hidden;
}
