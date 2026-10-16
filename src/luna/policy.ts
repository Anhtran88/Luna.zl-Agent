import { unexpectedEndpointKey } from "./deploy.ts";
import { correlationId } from "./reliability.ts";
import { containsSecret, evaluateLiveGate, redactAuditDetail } from "./security.ts";

type Env = Record<string, string | undefined>;
type Severity = "critical" | "high" | "medium" | "low";

export const SOD_ROLES = [
  "requester",
  "approver",
  "environment-owner",
  "credential-owner",
  "security-reviewer",
  "rollback-owner",
  "incident-owner",
] as const;

export const EVIDENCE_FIELDS = [
  "staging-environment",
  "budget",
  "security-approval",
  "browser-policy",
  "zalo-eoffice-policy",
  "legal-privacy",
] as const;

export type SodRole = (typeof SOD_ROLES)[number];
export type EvidenceField = (typeof EVIDENCE_FIELDS)[number];

const FAKE_FLAGS = [
  "LUNA_STAGING_CONFIRMED",
  "LUNA_ENVIRONMENT_OWNER_CONFIRMED",
  "LUNA_CREDENTIAL_OWNER_CONFIRMED",
  "LUNA_BUDGET_CONFIRMED",
  "LUNA_SECURITY_APPROVAL",
  "LUNA_ROLLBACK_CONFIRMED",
  "LUNA_INCIDENT_OWNER_CONFIRMED",
  "LUNA_BROWSER_POLICY_CONFIRMED",
  "LUNA_ZALO_POLICY_CONFIRMED",
  "LUNA_LEGAL_PRIVACY_CONFIRMED",
] as const;

const FAKE_VALUES = new Set(["true", "false", "yes", "no", "ok", "confirmed"]);

export interface PolicyCheck {
  id: string;
  ok: boolean;
  severity: Severity;
  detail: string;
}

export interface PolicyAudit {
  action: string;
  outcome: "blocked" | "recorded";
  detail: string;
  dryRun: true;
  correlationId: string;
  network: false;
}

export interface GovernanceReport {
  decision: "NO-GO";
  authorization: "not-granted";
  policy: "blocked" | "recorded";
  fakeSignOffAccepted: false;
  executed: false;
  networkCalls: 0;
  productionDeployed: false;
  rulesDeployed: false;
  estimatedUsd: 0;
  telemetry: false;
  live: { firebase: false; nineRouter: false; browserLaunch: false };
  checks: PolicyCheck[];
  blockers: PolicyCheck[];
  findings: PolicyCheck[];
  audit: PolicyAudit[];
}

export interface GovernanceSummary {
  decision: "NO-GO";
  authorization: "not-granted";
  fakeSignOffAccepted: false;
  networkCalls: 0;
  blockers: number;
}

export interface GovernanceInput {
  env?: Env;
  action?: "staging" | "production" | "rollback";
  owners?: Partial<Record<SodRole, string>>;
  evidence?: Partial<Record<EvidenceField, string>>;
  rulesDeny?: boolean;
  sbom?: { directDependencies: number; lockfilePresent: boolean; license?: string };
  fetchImpl?: () => Promise<unknown>;
}

export function evaluateGovernance(input: GovernanceInput = {}): GovernanceReport {
  const fetchImpl = input.fetchImpl;
  if (fetchImpl) {
    // Accepted only so a test can prove this gate never calls it.
  }
  const env = input.env ?? {};
  const checks: PolicyCheck[] = [];
  const findings: PolicyCheck[] = [];
  const owners = input.owners ?? {};
  const evidence = input.evidence ?? {};
  const usable = new Map<SodRole, string>();

  const fakes = FAKE_FLAGS.filter((key) => env[key] === "true");
  checks.push(
    fakes.length === 0
      ? check("fake-sign-off", true, "critical", "Không có cờ xác nhận được dùng làm bằng chứng.")
      : check("fake-sign-off", false, "critical", `Cờ không phải sign-off: ${fakes.join(", ")}.`),
  );

  for (const role of SOD_ROLES) {
    const raw = owners[role];
    const kind = classify(raw);
    if (kind === "ok" && raw) usable.set(role, raw.trim().toLowerCase());
    checks.push(
      kind === "ok"
        ? check(`owner:${role}`, true, "critical", `${role} có handle riêng. Handle không được in.`)
        : check(`owner:${role}`, false, "critical", ownerDetail(role, kind)),
    );
  }
  checks.push(collisionCheck(usable));

  for (const field of EVIDENCE_FIELDS) {
    const kind = classify(evidence[field]);
    checks.push(
      kind === "ok"
        ? check(`evidence:${field}`, true, "critical", `${field} có mã bằng chứng. Mã không được in.`)
        : check(`evidence:${field}`, false, "critical", evidenceDetail(field, kind)),
    );
  }

  const endpoint = unexpectedEndpointKey(env);
  checks.push(
    endpoint
      ? check("public-endpoint", false, "critical", `Bỏ qua ${endpoint}. Không gọi.`)
      : check("public-endpoint", true, "critical", "Không có endpoint public trong môi trường được kiểm."),
  );

  const live = evaluateLiveGate(env);
  checks.push(
    live.violations.length === 0
      ? check("live-flags", true, "critical", "Firebase, 9Router, browser và production vẫn khóa.")
      : check("live-flags", false, "critical", `Yêu cầu live bị từ chối: ${live.violations.join(", ")}.`),
  );

  if (input.rulesDeny === true) checks.push(check("firebase-rules", true, "critical", "Rules mẫu deny-all. Không deploy."));
  else checks.push(check("firebase-rules", false, "critical", "Chưa có rules deny-all được xác nhận."));

  if (input.sbom?.lockfilePresent && input.sbom.directDependencies > 0) {
    findings.push(check("sbom", true, "medium", "Inventory dependency nằm ở máy local."));
  } else {
    findings.push(check("sbom", false, "medium", "Chưa gắn inventory dependency local."));
  }
  findings.push(
    input.sbom?.license && input.sbom.license !== "unspecified"
      ? check("license", true, "medium", "Package khai báo license.")
      : check("license", false, "medium", "Package chưa khai báo license. Không tự gán."),
  );

  const blockers = checks.filter((item) => !item.ok);
  const policy = blockers.length === 0 ? "recorded" : "blocked";
  const action = input.action ?? "production";
  return {
    decision: "NO-GO",
    authorization: "not-granted",
    policy,
    fakeSignOffAccepted: false,
    executed: false,
    networkCalls: 0,
    productionDeployed: false,
    rulesDeployed: false,
    estimatedUsd: 0,
    telemetry: false,
    live: { firebase: false, nineRouter: false, browserLaunch: false },
    checks,
    blockers,
    findings,
    audit: auditTrail(action, policy, live.violations),
  };
}

export function summarizeGovernance(report: GovernanceReport): GovernanceSummary {
  return {
    decision: "NO-GO",
    authorization: "not-granted",
    fakeSignOffAccepted: false,
    networkCalls: 0,
    blockers: report.blockers.length,
  };
}

function classify(value: string | undefined): "missing" | "fake" | "secret" | "ok" {
  const text = value?.trim() ?? "";
  if (!text) return "missing";
  if (FAKE_VALUES.has(text.toLowerCase())) return "fake";
  if (containsSecret(text) || /^https?:\/\//i.test(text)) return "secret";
  return "ok";
}

function collisionCheck(owners: Map<SodRole, string>): PolicyCheck {
  const groups = new Map<string, SodRole[]>();
  for (const [role, id] of owners) {
    const list = groups.get(id) ?? [];
    list.push(role);
    groups.set(id, list);
  }
  const collided = [...groups.values()].filter((roles) => roles.length > 1);
  if (collided.length === 0) {
    return check("owner-collision", true, "critical", "Không gán các vai bắt buộc cho cùng một handle.");
  }
  return check("owner-collision", false, "critical", `Trùng vai: ${collided.flat().join(", ")}. Handle không được in.`);
}

function ownerDetail(role: string, kind: "missing" | "fake" | "secret" | "ok"): string {
  if (kind === "missing") return `Thiếu ${role}. Không mặc định về cùng một người.`;
  if (kind === "fake") return `${role} chỉ có cờ hoặc từ xác nhận. Không chấp nhận.`;
  if (kind === "secret") return `${role} có dữ liệu nhạy cảm và đã được giấu.`;
  return `${role} có handle riêng.`;
}

function evidenceDetail(field: string, kind: "missing" | "fake" | "secret" | "ok"): string {
  if (kind === "missing") return `Thiếu bằng chứng ${field}.`;
  if (kind === "fake") return `${field} không được chứng minh bằng cờ true.`;
  if (kind === "secret") return `${field} có dữ liệu nhạy cảm hoặc URL và đã được giấu.`;
  return `${field} có mã bằng chứng.`;
}

function auditTrail(action: string, policy: "blocked" | "recorded", violations: string[]): PolicyAudit[] {
  const policyOutcome = policy === "blocked" ? "blocked" : "recorded";
  const rows: Array<{ action: string; outcome: "blocked" | "recorded"; detail: string }> = [
    {
      action: "policy.decide",
      outcome: policyOutcome,
      detail: policyOutcome === "blocked" ? "Policy từ chối vì thiếu bằng chứng thật." : "Policy chỉ ghi nhận. Không cấp quyền.",
    },
    { action: `deploy.${action}`, outcome: "blocked", detail: "Hành động bị chặn. Không deploy và không gọi mạng." },
    {
      action: "approval.decide",
      outcome: policyOutcome,
      detail:
        policyOutcome === "blocked"
          ? "Không có approver tách biệt được chấp nhận."
          : "Approver chỉ được ghi nhận. Không cấp quyền deploy.",
    },
    { action: "dry-run.record", outcome: "recorded", detail: "Dry-run giữ trong tiến trình." },
    {
      action: "rollback.rehearse",
      outcome: "recorded",
      detail: "Rollback rehearsal không ra mạng và không đổi process đang chạy.",
    },
  ];
  if (violations.length > 0) {
    rows.push({
      action: "live.bypass",
      outcome: "blocked",
      detail: `Live bypass bị từ chối: ${violations.join(", ")}.`,
    });
  }
  return rows.map((row, index) => ({
    action: row.action,
    outcome: row.outcome,
    detail: safeDetail(row.detail),
    dryRun: true,
    correlationId: correlationId(index + 1),
    network: false,
  }));
}

function safeDetail(value: string): string {
  const hidden = redactAuditDetail(value);
  return containsSecret(hidden) ? "Đã giấu credential." : hidden;
}

function check(id: string, ok: boolean, severity: Severity, detail: string): PolicyCheck {
  return { id, ok, severity, detail: safeDetail(detail) };
}
