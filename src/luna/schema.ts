import {
  LUNA_PHASE,
  LunaError,
  type AgentRun,
  type AgentTask,
  type ApprovalRequest,
  type AuditEvent,
  type ExecutionMode,
  type Sensitivity,
  type TaskStatus,
} from "./domain.ts";

/** First durable layout. Phase 0/1 (schema v0) lived only in process memory. */
export const SCHEMA_VERSION = 1 as const;

export type StoreKind = "task" | "approval" | "audit" | "run" | "settings";

export interface SettingsBody {
  phase: typeof LUNA_PHASE;
  phaseLock: true;
  firebaseLive: false;
  modelsLive: false;
  updatedAt: string;
}

export interface StoredDocument<T> {
  schemaVersion: typeof SCHEMA_VERSION;
  kind: StoreKind;
  record: T;
}

export const STORE_PATHS = {
  settings: "/luna/v1/settings",
  task: (id: string) => `/luna/v1/tasks/${id}`,
  approval: (id: string) => `/luna/v1/approvals/${id}`,
  audit: (id: string) => `/luna/v1/audit/${id}`,
  run: (id: string) => `/luna/v1/runs/${id}`,
} as const;

const TASK_STATUSES = new Set<TaskStatus>([
  "draft",
  "planned",
  "awaiting_approval",
  "approved",
  "rejected",
  "dry_run_completed",
  "blocked",
  "cancelled",
]);

const MODES = new Set<ExecutionMode>(["dry-run", "live"]);
const SENSITIVITIES = new Set<Sensitivity>(["safe", "sensitive"]);

export function schemaCompatible(version: unknown): version is typeof SCHEMA_VERSION {
  return version === SCHEMA_VERSION;
}

export function assertSchemaVersion(version: unknown): void {
  if (version === 0 || version === undefined) {
    throw new LunaError(
      "MIGRATION",
      "Schema v0 chỉ tồn tại trong bộ nhớ Phase 0/1. Không có bản ghi để nâng tự động.",
    );
  }
  if (!schemaCompatible(version)) {
    throw new LunaError(
      "MIGRATION",
      `Schema ${String(version)} không tương thích với bản ghi v${SCHEMA_VERSION}.`,
    );
  }
}

function asRecord(value: unknown, code = "VALIDATION"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LunaError(code, "Tài liệu persistence không phải object.");
  }
  return value as Record<string, unknown>;
}

export function readStoredDocument(raw: unknown, kind: StoreKind): Record<string, unknown> {
  const doc = asRecord(raw);
  assertSchemaVersion(doc.schemaVersion);
  if (doc.kind !== kind) {
    throw new LunaError("VALIDATION", `Kỳ vọng tài liệu ${kind}.`);
  }
  return asRecord(doc.record);
}

function requireString(record: Record<string, unknown>, key: string, pattern?: RegExp): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new LunaError("VALIDATION", `Thiếu ${key}.`);
  }
  if (pattern && !pattern.test(value)) {
    throw new LunaError("VALIDATION", `${key} không đúng dạng.`);
  }
  return value;
}

export function defaultSettings(updatedAt: string): StoredDocument<SettingsBody> {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "settings",
    record: {
      phase: LUNA_PHASE,
      phaseLock: true,
      firebaseLive: false,
      modelsLive: false,
      updatedAt,
    },
  };
}

export function parseSettings(raw: unknown): SettingsBody {
  const record = readStoredDocument(raw, "settings");
  if (record.phase !== LUNA_PHASE) {
    throw new LunaError("MIGRATION", "Phase trong settings không khớp schema v1.");
  }
  if (record.phaseLock !== true) {
    throw new LunaError("VALIDATION", "phaseLock không được tắt trong settings.");
  }
  if (record.firebaseLive !== false || record.modelsLive !== false) {
    throw new LunaError("VALIDATION", "Schema v1 không cho bật Firebase live hoặc model live.");
  }
  requireString(record, "updatedAt");
  return record as unknown as SettingsBody;
}

export function parseTaskRecord(raw: unknown): AgentTask {
  const record = readStoredDocument(raw, "task");
  requireString(record, "id", /^task_[\w-]+$/);
  const goal = requireString(record, "goal");
  const title = requireString(record, "title");
  if (goal.length < 3 || goal.length > 2000) {
    throw new LunaError("VALIDATION", "Mục tiêu trong bản ghi không hợp lệ.");
  }
  if (title.length > 120) throw new LunaError("VALIDATION", "Tiêu đề trong bản ghi quá dài.");
  const mode = requireString(record, "mode");
  const status = requireString(record, "status");
  const sensitivity = requireString(record, "sensitivity");
  if (!MODES.has(mode as ExecutionMode)) throw new LunaError("VALIDATION", "Chế độ không hợp lệ.");
  if (!TASK_STATUSES.has(status as TaskStatus)) {
    throw new LunaError("VALIDATION", "Trạng thái không hợp lệ.");
  }
  if (!SENSITIVITIES.has(sensitivity as Sensitivity)) {
    throw new LunaError("VALIDATION", "Mức nhạy cảm không hợp lệ.");
  }
  requireString(record, "createdAt");
  return record as unknown as AgentTask;
}

export function parseApprovalRecord(raw: unknown): ApprovalRequest {
  const record = readStoredDocument(raw, "approval");
  requireString(record, "id", /^approval_[\w-]+$/);
  requireString(record, "taskId", /^task_[\w-]+$/);
  requireString(record, "reason");
  const status = requireString(record, "status");
  if (status !== "pending" && status !== "approved" && status !== "rejected") {
    throw new LunaError("VALIDATION", "Trạng thái duyệt không hợp lệ.");
  }
  requireString(record, "requestedAt");
  if (typeof record.note === "string" && record.note.length > 280) {
    throw new LunaError("VALIDATION", "Ghi chú duyệt dài hơn 280 ký tự.");
  }
  return record as unknown as ApprovalRequest;
}

export function parseAuditRecord(raw: unknown): AuditEvent {
  const record = readStoredDocument(raw, "audit");
  requireString(record, "id", /^audit_[\w-]+$/);
  requireString(record, "at");
  requireString(record, "actor");
  requireString(record, "action");
  requireString(record, "outcome");
  requireString(record, "detail");
  if (record.dryRun !== true) {
    throw new LunaError("VALIDATION", "Audit persistence chỉ nhận dry-run.");
  }
  return record as unknown as AuditEvent;
}

export function parseRunRecord(raw: unknown): AgentRun {
  const record = readStoredDocument(raw, "run");
  requireString(record, "id", /^run_[\w-]+$/);
  requireString(record, "taskId", /^task_[\w-]+$/);
  const status = requireString(record, "status");
  if (status !== "completed" && status !== "refused" && status !== "blocked") {
    throw new LunaError("VALIDATION", "Trạng thái run không hợp lệ.");
  }
  requireString(record, "startedAt");
  requireString(record, "finishedAt");
  if (record.dryRun !== true) {
    throw new LunaError("VALIDATION", "Agent run persistence chỉ nhận dry-run.");
  }
  if (!Array.isArray(record.stepOutcomes)) {
    throw new LunaError("VALIDATION", "Run thiếu danh sách bước.");
  }
  return record as unknown as AgentRun;
}

export function wrapRecord<T>(kind: StoreKind, record: T): StoredDocument<T> {
  return { schemaVersion: SCHEMA_VERSION, kind, record };
}
