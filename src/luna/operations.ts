import { unexpectedEndpointKey } from "./deploy.ts";
import { evaluateMonthlySpend, type BudgetService } from "./owner-decisions.ts";
import { EVIDENCE_FIELDS, evaluateGovernance, SOD_ROLES, type SodRole } from "./policy.ts";
import { correlationId } from "./reliability.ts";
import { EVIDENCE_SCOPES, roleBoard, type EvidenceFieldId, type RoleSlot } from "./readiness-pack.ts";
import { containsSecret, evaluateLiveGate, redactAuditDetail } from "./security.ts";

type Env = Record<string, string | undefined>;
type Severity = "critical" | "high" | "medium" | "low";

/** Local evidence that can be recorded. Health and alerting never count as present. */
export const SCORE_FIELDS = [
  ...EVIDENCE_FIELDS,
  "artifact",
  "migration",
  "backup",
] as const;

export const TRACKED_FIELDS = [...SCORE_FIELDS, "health", "alerting"] as const;

export const DRILL_IDS = [
  "incident",
  "rollback",
  "backup-restore",
  "dependency-outage",
  "secret-config-missing",
  "audit-redaction",
] as const;

export const GO_CONDITIONS = [
  "Bảy vai khác nhau. Handle không lấy từ cờ môi trường và không được trùng.",
  "Staging, ngân sách, phê duyệt an ninh, pháp lý, policy browser và Zalo/eOffice là mã opaque, còn hạn, digest khớp.",
  "Artifact, migration và backup có biên bản local đã đối chiếu digest. Không phải cờ true.",
  "Health production và alerting ngoài được xác nhận bằng quy trình riêng. Phase này không probe.",
  "Package khai báo license. SBOM local không đủ để chuyển GO.",
  "Không có risk acceptance nào mở production lock.",
  "Cap tháng không phải quyền chi. Vượt cap thì từ chối và không gọi dịch vụ.",
  "Staging được báo đã có nhưng chưa verified không phải xác nhận. Browser launch và Zalo/eOffice vẫn khóa.",
  "Chủ repo ký ngoài repository. Phase 12 không chuyển GO.",
] as const;

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
const PERMANENT = new Set([
  "production-health",
  "production-alerting",
  "evidence:health",
  "evidence:alerting",
]);

export type EvidenceSource = "local-file" | "owner-record" | "drill" | "missing";
export type EvidenceStatus =
  | "present"
  | "missing"
  | "expired"
  | "tampered"
  | "rejected"
  | "local-only"
  | "wrong-scope"
  | "incomplete";
export type EvidenceGate = "BLOCKED" | "RECORDED";

export interface ChecklistItem {
  id: string;
  ok: boolean;
  severity: Severity;
  detail: string;
}

export interface EvidenceRecord {
  id: string;
  evidence_id: string;
  field: string;
  sourceType: EvidenceSource;
  source_type: EvidenceSource;
  recordedAt: string;
  created_at: string;
  expiresAt: string | null;
  expires_at: string | null;
  digest: string;
  sha256: string;
  scope: string | null;
  approval_reference: string | null;
  status: EvidenceStatus;
  gate: EvidenceGate;
  redacted: true;
}

export interface ComplianceCheck {
  id: string;
  ok: boolean;
  severity: Severity;
  detail: string;
}

export interface RiskDecision {
  id: string;
  scope: string;
  status: "open" | "accepted" | "rejected" | "expired";
  expiresAt: string | null;
  distinctApprover: boolean;
  bypassesProduction: false;
  detail: string;
}

export interface DrillResult {
  id: (typeof DRILL_IDS)[number];
  status: "rehearsed" | "blocked";
  network: false;
  realData: false;
  applied: false;
  detail: string;
}

export interface OpsAudit {
  action: string;
  outcome: "blocked" | "recorded";
  detail: string;
  dryRun: true;
  correlationId: string;
  network: false;
}

export interface OperationsReport {
  decision: "NO-GO";
  authorization: "not-granted";
  posture: "blocked" | "recorded";
  evidenceScore: number;
  goEligible: false;
  fakeSignOffAccepted: false;
  executed: false;
  networkCalls: 0;
  alertsSent: 0;
  telemetry: false;
  productionDeployed: false;
  rulesDeployed: false;
  estimatedUsd: 0;
  live: { firebase: false; nineRouter: false; browserLaunch: false };
  checklist: ChecklistItem[];
  registry: EvidenceRecord[];
  compliance: ComplianceCheck[];
  risks: RiskDecision[];
  drills: DrillResult[];
  blockers: ChecklistItem[];
  roles: RoleSlot[];
  goConditions: readonly string[];
  audit: OpsAudit[];
}

export interface OperationsSummary {
  decision: "NO-GO";
  authorization: "not-granted";
  evidenceScore: number;
  goEligible: false;
  networkCalls: 0;
  blockers: number;
  rolesBlocked: number;
  ownerCollision: boolean;
}

export interface EvidenceInput {
  field: string;
  sourceType?: Exclude<EvidenceSource, "missing">;
  body?: string;
  digest?: string;
  recordedAt?: string;
  expiresAt?: string;
  scope?: string;
  approvalReference?: string;
}

export interface RiskInput {
  id?: string;
  scope?: string;
  requester?: string;
  approver?: string;
  expiresAt?: string;
  evidenceRef?: string;
  bypassProduction?: boolean;
}

export interface OperationsInput {
  env?: Env;
  now?: string;
  owners?: Partial<Record<SodRole, string>>;
  evidence?: EvidenceInput[];
  risks?: RiskInput[];
  rulesDeny?: boolean;
  sbom?: { directDependencies: number; lockfilePresent: boolean; license?: string };
  redactionSample?: string;
  fetchImpl?: () => Promise<unknown>;
  roleNames?: Partial<Record<RoleSlot["id"], string>>;
  proposedSpend?: Partial<Record<BudgetService, number>>;
}

export function evidenceDigest(field: string, sourceType: string, body: string): string {
  return sha256Hex(`${field}\n${sourceType}\n${body.trim()}`);
}

export function assessOperations(input: OperationsInput = {}): OperationsReport {
  if (input.fetchImpl) {
    // Accepted only so a test can prove this gate never calls it.
  }
  const now = input.now ?? "2026-10-16T06:00:00.000Z";
  const env = input.env ?? {};
  const owners = input.owners ?? {};
  const checklist: ChecklistItem[] = [];
  const usable = new Map<SodRole, string>();

  const fakes = FAKE_FLAGS.filter((key) => isFakeFlag(env[key]));
  checklist.push(
    item(
      "fake-sign-off",
      fakes.length === 0,
      "critical",
      fakes.length === 0
        ? "Không có cờ xác nhận được dùng làm sign-off."
        : `Cờ không phải sign-off: ${fakes.join(", ")}.`,
    ),
  );

  for (const role of SOD_ROLES) {
    const kind = classify(owners[role]);
    if (kind === "ok" && owners[role]) usable.set(role, owners[role].trim().toLowerCase());
    checklist.push(item(`role:${role}`, kind === "ok", "critical", roleDetail(role, kind)));
  }
  checklist.push(collisionItem(usable));
  checklist.push(budgetCapItem(input.proposedSpend));

  const registry = TRACKED_FIELDS.map((field) => recordEvidence(field, input.evidence ?? [], now));
  for (const row of registry) {
    const permanent = row.field === "health" || row.field === "alerting";
    checklist.push(
      item(
        `evidence:${row.field}`,
        !permanent && row.status === "present",
        row.field === "health" || row.field === "alerting" ? "high" : "critical",
        evidenceDetail(row),
      ),
    );
  }

  const endpoint = unexpectedEndpointKey(env);
  const live = evaluateLiveGate(env);
  const governance = evaluateGovernance({
    env,
    owners,
    evidence: governanceEvidence(input.evidence ?? [], now),
    rulesDeny: input.rulesDeny,
    sbom: input.sbom,
  });
  const separated = SOD_ROLES.every((role) => checklist.find((row) => row.id === `role:${role}`)?.ok) &&
    checklist.find((row) => row.id === "owner-collision")?.ok === true;

  const compliance: ComplianceCheck[] = [
    item("security-phase-lock", true, "critical", "Phase lock không tắt từ checklist này."),
    item(
      "firebase-rules",
      input.rulesDeny === true,
      "critical",
      input.rulesDeny === true ? "Rules mẫu deny-all. Không deploy." : "Chưa xác nhận rules deny-all.",
    ),
    item(
      "live-flags",
      live.violations.length === 0,
      "critical",
      live.violations.length === 0
        ? "Firebase, 9Router, browser và production vẫn khóa."
        : `Yêu cầu live bị từ chối: ${live.violations.join(", ")}.`,
    ),
    item(
      "browser-launch",
      !live.violations.includes("browser-launch"),
      "critical",
      "Browser launch giữ tắt. Không mở trình duyệt.",
    ),
    item(
      "policy-gate",
      governance.policy === "recorded" && governance.fakeSignOffAccepted === false,
      "critical",
      governance.policy === "recorded"
        ? "Policy chỉ ghi nhận. Không cấp quyền."
        : "Policy gate đang chặn. Cờ giả không được nhận.",
    ),
    item(
      "owner-separation",
      separated,
      "critical",
      separated ? "Bảy vai có handle khác nhau." : "Thiếu vai hoặc hai vai dùng cùng một handle.",
    ),
    item(
      "sbom",
      Boolean(input.sbom?.lockfilePresent && input.sbom.directDependencies > 0),
      "medium",
      input.sbom?.lockfilePresent ? "Inventory dependency nằm ở máy local." : "Chưa gắn inventory dependency local.",
    ),
    item(
      "license",
      Boolean(input.sbom?.license && input.sbom.license !== "unspecified"),
      "medium",
      input.sbom?.license && input.sbom.license !== "unspecified"
        ? "Package khai báo license."
        : "Package chưa khai báo license. Không tự gán.",
    ),
    item("artifact", present("artifact", registry), "high", evidenceCompliance("artifact", registry)),
    item("migration", present("migration", registry), "high", evidenceCompliance("migration", registry)),
    item("backup", present("backup", registry), "high", evidenceCompliance("backup", registry)),
    item("production-health", false, "critical", "Không probe health production. Không gọi mạng."),
    item("production-alerting", false, "high", "Không gửi alerting. Kênh ngoài chưa có."),
    item(
      "public-endpoint",
      endpoint === null,
      "critical",
      endpoint ? `Bỏ qua ${endpoint}. Không gọi.` : "Không có endpoint public trong môi trường được kiểm.",
    ),
  ];

  const collisionOk = checklist.find((row) => row.id === "owner-collision")?.ok === true;
  const roles = roleBoard(
    (sod) => checklist.find((row) => row.id === `role:${sod}`)?.ok === true,
    collisionOk,
    input.roleNames,
  );
  const risks = [standingRisk(), ...(input.risks ?? []).map((risk, index) => decideRisk(risk, index, now))];
  const drills = runDrills(registry, input.redactionSample);
  const blockers = [
    ...checklist.filter((row) => !row.ok && row.severity !== "medium" && row.severity !== "low"),
    ...compliance.filter((row) => !row.ok && row.severity !== "medium" && row.severity !== "low"),
  ];
  const closable = blockers.filter((row) => !PERMANENT.has(row.id));
  const posture = closable.length === 0 ? "recorded" : "blocked";
  const presentCount = SCORE_FIELDS.filter((field) => present(field, registry)).length;
  const evidenceScore = Math.round((presentCount / SCORE_FIELDS.length) * 100);

  return {
    decision: "NO-GO",
    authorization: "not-granted",
    posture,
    evidenceScore,
    goEligible: false,
    fakeSignOffAccepted: false,
    executed: false,
    networkCalls: 0,
    alertsSent: 0,
    telemetry: false,
    productionDeployed: false,
    rulesDeployed: false,
    estimatedUsd: 0,
    live: { firebase: false, nineRouter: false, browserLaunch: false },
    checklist,
    registry,
    compliance,
    risks,
    drills,
    blockers,
    roles,
    goConditions: GO_CONDITIONS,
    audit: auditTrail(posture, live.violations, risks),
  };
}

export function summarizeOperations(report: OperationsReport): OperationsSummary {
  return {
    decision: "NO-GO",
    authorization: "not-granted",
    evidenceScore: report.evidenceScore,
    goEligible: false,
    networkCalls: 0,
    blockers: report.blockers.length,
    rolesBlocked: report.roles.filter((role) => role.status === "BLOCKED").length,
    ownerCollision: report.checklist.find((row) => row.id === "owner-collision")?.ok === false,
  };
}

function recordEvidence(field: string, rows: EvidenceInput[], now: string): EvidenceRecord {
  const submitted = rows.find((row) => row.field === field);
  const recordedAt = submitted?.recordedAt ?? now;
  const expiresAt = submitted?.expiresAt ?? null;
  if (!submitted || classify(submitted.body) === "missing") {
    return schemaRecord({
      field,
      recordedAt,
      expiresAt,
      sourceType: "missing",
      digest: "absent",
      status: "missing",
      scope: null,
      approval: null,
    });
  }
  const sourceType = submitted.sourceType ?? "owner-record";
  const kind = classify(submitted.body);
  if (kind === "fake" || kind === "secret") {
    return schemaRecord({
      field,
      recordedAt,
      expiresAt,
      sourceType,
      digest: "redacted",
      status: "rejected",
      scope: null,
      approval: null,
    });
  }
  const approvalKind = classify(submitted.approvalReference);
  if (approvalKind === "fake" || approvalKind === "secret") {
    return schemaRecord({
      field,
      recordedAt,
      expiresAt,
      sourceType,
      digest: "redacted",
      status: "rejected",
      scope: null,
      approval: null,
    });
  }
  const body = submitted.body?.trim() ?? "";
  const computed = evidenceDigest(field, sourceType, body);
  const claimed = submitted.digest?.trim();
  if (claimed && !/^[a-f0-9]{64}$/i.test(claimed)) {
    return schemaRecord({
      field,
      recordedAt,
      expiresAt,
      sourceType,
      digest: "redacted",
      status: "tampered",
      scope: safeScopeToken(submitted.scope),
      approval: null,
    });
  }
  if (claimed && claimed.toLowerCase() !== computed) {
    return schemaRecord({
      field,
      recordedAt,
      expiresAt,
      sourceType,
      digest: "mismatch",
      status: "tampered",
      scope: safeScopeToken(submitted.scope),
      approval: null,
    });
  }
  if (submitted.expiresAt && submitted.expiresAt <= now) {
    return schemaRecord({
      field,
      recordedAt,
      expiresAt,
      sourceType,
      digest: computed,
      status: "expired",
      scope: safeScopeToken(submitted.scope),
      approval: approvalKind === "ok" ? submitted.approvalReference?.trim() ?? null : null,
    });
  }
  const expected = EVIDENCE_SCOPES[field as EvidenceFieldId];
  const given = submitted.scope?.trim().toLowerCase() ?? "";
  if (!expected || given !== expected) {
    return schemaRecord({
      field,
      recordedAt,
      expiresAt,
      sourceType,
      digest: computed,
      status: "wrong-scope",
      scope: safeScopeToken(given),
      approval: approvalKind === "ok" ? submitted.approvalReference?.trim() ?? null : null,
    });
  }
  if (approvalKind !== "ok") {
    return schemaRecord({
      field,
      recordedAt,
      expiresAt,
      sourceType,
      digest: computed,
      status: "incomplete",
      scope: expected,
      approval: null,
    });
  }
  if (field === "health" || field === "alerting") {
    return schemaRecord({
      field,
      recordedAt,
      expiresAt,
      sourceType,
      digest: computed,
      status: "local-only",
      scope: expected,
      approval: submitted.approvalReference?.trim() ?? null,
    });
  }
  return schemaRecord({
    field,
    recordedAt,
    expiresAt,
    sourceType,
    digest: computed,
    status: "present",
    scope: expected,
    approval: submitted.approvalReference?.trim() ?? null,
  });
}

function schemaRecord(input: {
  field: string;
  recordedAt: string;
  expiresAt: string | null;
  sourceType: EvidenceSource;
  digest: string;
  status: EvidenceStatus;
  scope: string | null;
  approval: string | null;
}): EvidenceRecord {
  const id = `evidence:${input.field}`;
  return {
    id,
    evidence_id: id,
    field: input.field,
    sourceType: input.sourceType,
    source_type: input.sourceType,
    recordedAt: input.recordedAt,
    created_at: input.recordedAt,
    expiresAt: input.expiresAt,
    expires_at: input.expiresAt,
    digest: input.digest,
    sha256: input.digest,
    scope: input.scope,
    approval_reference: input.approval,
    status: input.status,
    gate: input.status === "present" ? "RECORDED" : "BLOCKED",
    redacted: true,
  };
}

function safeScopeToken(value: string | undefined): string | null {
  const text = value?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9-]{1,32}$/.test(text)) return null;
  return text;
}

function decideRisk(risk: RiskInput, index: number, now: string): RiskDecision {
  const id = safeId(risk.id) ?? `risk-${index + 1}`;
  const requester = classify(risk.requester);
  const approver = classify(risk.approver);
  const evidence = classify(risk.evidenceRef);
  const scopeKind = classify(risk.scope);
  const scope = scopeKind === "ok" ? (risk.scope?.trim().toLowerCase() ?? "") : "redacted";
  const distinct =
    requester === "ok" &&
    approver === "ok" &&
    risk.requester?.trim().toLowerCase() !== risk.approver?.trim().toLowerCase();
  const expired = Boolean(risk.expiresAt && risk.expiresAt <= now);
  const productionAttempt =
    risk.bypassProduction === true || scope === "production" || scope === "staging" || scopeKind === "secret";
  const complete = distinct && evidence === "ok" && scope === "local" && Boolean(risk.expiresAt) && !expired;
  if (productionAttempt || scopeKind === "fake" || evidence === "fake" || evidence === "secret") {
    return riskRow(id, scopeKind === "ok" ? scope : "redacted", "rejected", risk.expiresAt ?? null, false, "Không mở production lock.");
  }
  if (!distinct || requester !== "ok" || approver !== "ok") {
    return riskRow(id, scope === "local" ? "local" : "redacted", "rejected", risk.expiresAt ?? null, false, "Approver phải khác requester. Handle không được in.");
  }
  if (expired) {
    return riskRow(id, "local", "expired", risk.expiresAt ?? null, distinct, "Ngoại lệ đã hết hạn.");
  }
  if (!complete) {
    return riskRow(id, "redacted", "rejected", risk.expiresAt ?? null, distinct, "Thiếu scope local, hạn hoặc mã bằng chứng.");
  }
  return riskRow(id, "local", "accepted", risk.expiresAt ?? null, true, "Chấp nhận local. Không bypass production.");
}

function standingRisk(): RiskDecision {
  return riskRow("production-lock", "production", "open", null, false, "Khóa production còn mở như một rủi ro. Không có người chấp nhận.");
}

function riskRow(
  id: string,
  scope: string,
  status: RiskDecision["status"],
  expiresAt: string | null,
  distinctApprover: boolean,
  detail: string,
): RiskDecision {
  return {
    id,
    scope,
    status,
    expiresAt,
    distinctApprover,
    bypassesProduction: false,
    detail: safeDetail(detail),
  };
}

function runDrills(registry: EvidenceRecord[], sample: string | undefined): DrillResult[] {
  const backup = registry.find((row) => row.field === "backup");
  const hidden = sample ? safeDetail(sample) : "Không có mẫu. Config thiếu được diễn tập, không đọc dữ liệu thật.";
  const details: Record<(typeof DRILL_IDS)[number], string> = {
    incident: "Diễn tập sự cố trong tiến trình. Không gửi alert.",
    rollback: "Rollback rehearsal local-no-op. Không đổi process đang chạy.",
    "backup-restore":
      backup?.status === "present"
        ? "Đối chiếu digest backup trong bộ nhớ. Không restore dữ liệu thật."
        : "Backup chưa có. Diễn tập không tạo bản sao và không đọc dữ liệu thật.",
    "dependency-outage": "Giả lập Firebase, 9Router và browser không sẵn sàng. Không gọi mạng.",
    "secret-config-missing": hidden,
    "audit-redaction": hidden,
  };
  return DRILL_IDS.map((id) => ({
    id,
    status: "rehearsed" as const,
    network: false as const,
    realData: false as const,
    applied: false as const,
    detail: details[id],
  }));
}

function auditTrail(posture: "blocked" | "recorded", violations: string[], risks: RiskDecision[]): OpsAudit[] {
  const rows: Array<{ action: string; outcome: "blocked" | "recorded"; detail: string }> = [
    {
      action: "ops.decide",
      outcome: posture === "recorded" ? "recorded" : "blocked",
      detail: posture === "recorded" ? "Checklist local chỉ được ghi nhận. Không chuyển GO." : "Checklist còn thiếu. Không chuyển GO.",
    },
    { action: "evidence.register", outcome: posture === "recorded" ? "recorded" : "blocked", detail: "Sổ bằng chứng không lưu secret." },
    { action: "compliance.scan", outcome: "blocked", detail: "Health và alerting production vẫn không đạt." },
    {
      action: "risk.decide",
      outcome: risks.some((risk) => risk.status === "rejected") ? "blocked" : "recorded",
      detail: "Risk acceptance không mở production lock.",
    },
    { action: "drill.rehearse", outcome: "recorded", detail: "Sáu diễn tập ở trong tiến trình." },
    { action: "deploy.production", outcome: "blocked", detail: "Không deploy và không gọi mạng." },
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

function governanceEvidence(
  rows: EvidenceInput[],
  now: string,
): Partial<Record<(typeof EVIDENCE_FIELDS)[number], string>> {
  const evidence: Partial<Record<(typeof EVIDENCE_FIELDS)[number], string>> = {};
  for (const field of EVIDENCE_FIELDS) {
    const row = rows.find((item) => item.field === field);
    if (!row?.body || classify(row.body) !== "ok") continue;
    if (row.expiresAt && row.expiresAt <= now) continue;
    if ((row.scope?.trim().toLowerCase() ?? "") !== EVIDENCE_SCOPES[field]) continue;
    if (classify(row.approvalReference) !== "ok") continue;
    const sourceType = row.sourceType ?? "owner-record";
    const body = row.body.trim();
    const claimed = row.digest?.trim();
    if (claimed && (!/^[a-f0-9]{64}$/i.test(claimed) || claimed.toLowerCase() !== evidenceDigest(field, sourceType, body))) {
      continue;
    }
    evidence[field] = body;
  }
  return evidence;
}

function present(field: string, registry: EvidenceRecord[]): boolean {
  return registry.find((row) => row.field === field)?.status === "present";
}

function evidenceCompliance(field: string, registry: EvidenceRecord[]): string {
  const status = registry.find((row) => row.field === field)?.status ?? "missing";
  if (status === "present") return `${field} có mã local và digest khớp.`;
  if (status === "expired") return `${field} đã hết hạn.`;
  if (status === "tampered") return `${field} lệch digest. Không in nội dung.`;
  if (status === "wrong-scope") return `${field} sai scope. Không nhận.`;
  if (status === "incomplete") return `${field} thiếu approval reference an toàn.`;
  if (status === "rejected") return `${field} bị từ chối vì cờ giả hoặc dữ liệu nhạy cảm.`;
  return `Thiếu bằng chứng ${field}.`;
}

function evidenceDetail(row: EvidenceRecord): string {
  if (row.field === "health" || row.field === "alerting") {
    return row.status === "missing"
      ? `Thiếu ${row.field} production. Không gọi mạng.`
      : `${row.field} chỉ là ghi chú local. Không phải probe.`;
  }
  return evidenceCompliance(row.field, [row]);
}

function budgetCapItem(proposed: Partial<Record<BudgetService, number>> | undefined): ChecklistItem {
  const services = ["firebase", "nineRouter", "browser"] as const;
  const ok = services.every((service) => evaluateMonthlySpend(service, proposed?.[service] ?? 0).ok);
  return item(
    "budget-cap",
    ok,
    "critical",
    ok
      ? "Đề xuất nằm trong cap tháng. Lần này không phát sinh phí. Vượt cap thì từ chối."
      : "Đề xuất vượt cap hoặc không hợp lệ. Từ chối và không gọi dịch vụ.",
  );
}

function collisionItem(owners: Map<SodRole, string>): ChecklistItem {
  const groups = new Map<string, SodRole[]>();
  for (const [role, id] of owners) {
    const list = groups.get(id) ?? [];
    list.push(role);
    groups.set(id, list);
  }
  const collided = [...groups.values()].filter((roles) => roles.length > 1);
  if (collided.length === 0) {
    return item("owner-collision", true, "critical", "Không gán các vai bắt buộc cho cùng một handle.");
  }
  return item("owner-collision", false, "critical", `Trùng vai: ${collided.flat().join(", ")}. Handle không được in.`);
}

function roleDetail(role: string, kind: "missing" | "fake" | "secret" | "ok"): string {
  if (role === "environment-owner" && kind === "missing") return "Thiếu chủ staging. Không mặc định về cùng một người.";
  if (role === "credential-owner" && kind === "missing") return "Thiếu chủ credential. Không ghi secret vào sổ.";
  if (kind === "missing") return `Thiếu ${role}. Không mặc định về cùng một người.`;
  if (kind === "fake") return `${role} chỉ có cờ hoặc từ xác nhận. Không chấp nhận.`;
  if (kind === "secret") return `${role} có dữ liệu nhạy cảm và đã được giấu.`;
  return `${role} có handle riêng. Handle không được in.`;
}

function classify(value: string | undefined): "missing" | "fake" | "secret" | "ok" {
  const text = value?.trim() ?? "";
  if (!text) return "missing";
  if (FAKE_VALUES.has(text.toLowerCase())) return "fake";
  if (containsSecret(text) || /^https?:\/\//i.test(text)) return "secret";
  return "ok";
}

function isFakeFlag(value: string | undefined): boolean {
  const text = value?.trim().toLowerCase();
  return text === "true" || text === "yes" || text === "ok" || text === "confirmed";
}

function item(id: string, ok: boolean, severity: Severity, detail: string): ChecklistItem {
  return { id, ok, severity, detail: safeDetail(detail) };
}

function safeId(value: string | undefined): string | null {
  const text = value?.trim() ?? "";
  if (!/^[a-z0-9-]{1,40}$/i.test(text)) return null;
  return text;
}

function safeDetail(value: string): string {
  const hidden = redactAuditDetail(value);
  return containsSecret(hidden) ? "Đã giấu credential." : hidden;
}

function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  const padLen = (64 - ((bytes.length + 9) % 64)) % 64;
  const data = new Uint8Array(bytes.length + 1 + padLen + 8);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(data.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(data.length - 4, bitLen >>> 0);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15] ?? 0, 7) ^ rotr(w[i - 15] ?? 0, 18) ^ ((w[i - 15] ?? 0) >>> 3);
      const s1 = rotr(w[i - 2] ?? 0, 17) ^ rotr(w[i - 2] ?? 0, 19) ^ ((w[i - 2] ?? 0) >>> 10);
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + (K[i] ?? 0) + (w[i] ?? 0)) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((part) => part.toString(16).padStart(8, "0")).join("");
}

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
] as const;
