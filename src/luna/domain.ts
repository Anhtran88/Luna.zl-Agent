/** Luna Phase 0/1 domain types. No I/O and no secrets. */

export const LUNA_PHASE = "0.1" as const;

export class LunaError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LunaError";
    this.code = code;
  }
}

export class PhaseLockedError extends LunaError {
  constructor(message: string) {
    super("PHASE_LOCK", message);
    this.name = "PhaseLockedError";
  }
}

export type Sensitivity = "safe" | "sensitive";
export type ExecutionMode = "dry-run" | "live";

export type TaskStatus =
  | "draft"
  | "planned"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "dry_run_completed"
  | "blocked"
  | "cancelled";

export type StepKind =
  "analyze" | "model" | "browser" | "firebase_read" | "firebase_write" | "external_mutate";

export type StepOutcome = "simulated" | "refused";
export type AuditOutcome = "recorded" | "simulated" | "blocked" | "refused";
export type Actor = "system" | "operator" | "agent";

export interface PlanStep {
  id: string;
  kind: StepKind;
  title: string;
  detail: string;
  sensitivity: Sensitivity;
  requiresApproval: boolean;
}

export interface Plan {
  id: string;
  summary: string;
  steps: PlanStep[];
  createdAt: string;
}

export interface StepResult {
  stepId: string;
  kind: StepKind;
  outcome: StepOutcome;
  summary: string;
}

export interface ExecutionReport {
  taskId: string;
  mode: "dry-run";
  outcome: "dry_run_completed";
  steps: StepResult[];
  finishedAt: string;
}

export interface AgentTask {
  id: string;
  title: string;
  goal: string;
  sensitivity: Sensitivity;
  mode: ExecutionMode;
  status: TaskStatus;
  createdAt: string;
  plan?: Plan;
  approvalId?: string;
  lastReport?: ExecutionReport;
}

export interface ApprovalRequest {
  id: string;
  taskId: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  decidedAt?: string;
  note?: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  taskId?: string;
  actor: Actor;
  action: string;
  outcome: AuditOutcome;
  detail: string;
  /** Phase 0/1 invariant: every event is a dry-run. Nothing external ran. */
  dryRun: true;
}

export interface Clock {
  now(): string;
}

export interface Ids {
  next(prefix: string): string;
}

export interface ModuleStatus {
  id: string;
  name: string;
  state: "ready" | "mock" | "memory" | "locked";
  detail: string;
}

export interface ControlPlaneSnapshot {
  phase: typeof LUNA_PHASE;
  phaseLock: true;
  generatedAt: string;
  modules: ModuleStatus[];
  tasks: AgentTask[];
  approvals: ApprovalRequest[];
  audit: AuditEvent[];
  adapters: {
    firebase: {
      mode: "memory" | "disabled-live";
      liveRequested: boolean;
      liveEnabled: false;
      credentialConfigured: boolean;
      projectId: string | null;
      databaseUrlHost: string | null;
    };
    models: {
      activeProvider: "mock";
      baseUrl: string;
      apiKeyConfigured: boolean;
      liveRequested: boolean;
      liveEnabled: false;
      aliases: string[];
    };
    browser: {
      active: "mock";
      stubs: Array<"playwright" | "skyvern" | "browser-use">;
    };
  };
}

export type CommandResult<T> =
  | { ok: true; data: T; snapshot: ControlPlaneSnapshot }
  | { ok: false; code: string; message: string; snapshot: ControlPlaneSnapshot };

export function systemClock(): Clock {
  return { now: () => new Date().toISOString() };
}

export function fixedClock(iso = "2026-10-15T09:00:00.000Z"): Clock {
  return { now: () => iso };
}

export function randomIds(): Ids {
  return {
    next(prefix: string) {
      return `${prefix}_${crypto.randomUUID()}`;
    },
  };
}

export function sequenceIds(): Ids {
  let n = 0;
  return {
    next(prefix: string) {
      n += 1;
      return `${prefix}_${n}`;
    },
  };
}
