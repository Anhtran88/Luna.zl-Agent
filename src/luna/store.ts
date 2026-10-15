import {
  LunaError,
  type AgentRun,
  type AgentTask,
  type ApprovalRequest,
  type AuditEvent,
} from "./domain.ts";
import type { RealtimeDatabase } from "./firebase.ts";
import {
  STORE_PATHS,
  defaultSettings,
  parseApprovalRecord,
  parseAuditRecord,
  parseRunRecord,
  parseSettings,
  parseTaskRecord,
  wrapRecord,
  type SettingsBody,
} from "./schema.ts";

export interface LunaStore {
  readonly mode: "memory" | "firebase";
  ensureSettings(now: string): Promise<SettingsBody>;
  saveTask(task: AgentTask): Promise<void>;
  saveApproval(approval: ApprovalRequest): Promise<void>;
  appendAudit(event: AuditEvent): Promise<void>;
  saveRun(run: AgentRun): Promise<void>;
  readTask(id: string): Promise<AgentTask | null>;
  readSettings(): Promise<SettingsBody | null>;
}

export class MemoryLunaStore implements LunaStore {
  readonly mode = "memory" as const;
  private settings: SettingsBody | null = null;
  private readonly tasks = new Map<string, AgentTask>();
  private readonly approvals = new Map<string, ApprovalRequest>();
  private readonly audits: AuditEvent[] = [];
  private readonly runs = new Map<string, AgentRun>();

  async ensureSettings(now: string): Promise<SettingsBody> {
    if (!this.settings) this.settings = defaultSettings(now).record;
    return this.settings;
  }

  async saveTask(task: AgentTask): Promise<void> {
    this.tasks.set(task.id, parseTaskRecord(wrapRecord("task", task)));
  }

  async saveApproval(approval: ApprovalRequest): Promise<void> {
    this.approvals.set(approval.id, parseApprovalRecord(wrapRecord("approval", approval)));
  }

  async appendAudit(event: AuditEvent): Promise<void> {
    this.audits.push(parseAuditRecord(wrapRecord("audit", event)));
  }

  async saveRun(run: AgentRun): Promise<void> {
    this.runs.set(run.id, parseRunRecord(wrapRecord("run", run)));
  }

  async readTask(id: string): Promise<AgentTask | null> {
    return this.tasks.get(id) ?? null;
  }

  async readSettings(): Promise<SettingsBody | null> {
    return this.settings;
  }

  async readRun(id: string): Promise<AgentRun | null> {
    return this.runs.get(id) ?? null;
  }
}

/**
 * Persistence adapter over the Realtime Database port.
 * It does not open a socket itself. A locked port fails closed.
 */
export class FirebaseLunaStore implements LunaStore {
  readonly mode = "firebase" as const;
  private readonly db: RealtimeDatabase;

  constructor(db: RealtimeDatabase) {
    this.db = db;
  }

  async ensureSettings(now: string): Promise<SettingsBody> {
    const current = await this.readSettings();
    if (current) return current;
    const created = defaultSettings(now);
    await this.db.set(STORE_PATHS.settings, created);
    return created.record;
  }

  async saveTask(task: AgentTask): Promise<void> {
    assertStorePathId(task.id);
    const document = wrapRecord("task", task);
    parseTaskRecord(document);
    await this.db.set(STORE_PATHS.task(task.id), document);
  }

  async saveApproval(approval: ApprovalRequest): Promise<void> {
    const document = wrapRecord("approval", approval);
    parseApprovalRecord(document);
    await this.db.set(STORE_PATHS.approval(approval.id), document);
  }

  async appendAudit(event: AuditEvent): Promise<void> {
    const document = wrapRecord("audit", event);
    parseAuditRecord(document);
    await this.db.set(STORE_PATHS.audit(event.id), document);
  }

  async saveRun(run: AgentRun): Promise<void> {
    const document = wrapRecord("run", run);
    parseRunRecord(document);
    await this.db.set(STORE_PATHS.run(run.id), document);
  }

  async readTask(id: string): Promise<AgentTask | null> {
    const raw = await this.db.get(STORE_PATHS.task(id));
    if (raw === null) return null;
    return parseTaskRecord(raw);
  }

  async readSettings(): Promise<SettingsBody | null> {
    const raw = await this.db.get(STORE_PATHS.settings);
    if (raw === null) return null;
    return parseSettings(raw);
  }
}

export function assertStorePathId(id: string): void {
  if (!/^[\w-]+$/.test(id)) throw new LunaError("VALIDATION", "Mã bản ghi không hợp lệ.");
}
