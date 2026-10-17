/** Luna Phase 0/1 domain types. No I/O and no secrets. */

export const LUNA_PHASE = "2-foundations" as const;
/** Visible release. Stored schema phase stays v1-compatible. */
export const LUNA_RELEASE = "12-operations" as const;

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

export interface AgentRun {
  id: string;
  taskId: string;
  status: "completed" | "refused" | "blocked";
  startedAt: string;
  finishedAt: string;
  /** Phase 2 foundations never execute a live run. */
  dryRun: true;
  stepOutcomes: StepResult[];
}

export interface AuditEvent {
  id: string;
  at: string;
  taskId?: string;
  actor: Actor;
  action: string;
  outcome: AuditOutcome;
  detail: string;
  /** Every persisted event is a dry-run. Nothing external ran. */
  dryRun: true;
  /** Server-verified provenance, populated by the transactional command service. */
  principal?: string;
  workspaceId?: string;
  requestId?: string;
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
  release: typeof LUNA_RELEASE;
  phaseLock: true;
  schemaVersion: 1;
  storeMode: "memory" | "firebase" | "postgres";
  generatedAt: string;
  modules: ModuleStatus[];
  tasks: AgentTask[];
  approvals: ApprovalRequest[];
  runs: AgentRun[];
  audit: AuditEvent[];
  adapters: {
    firebase: {
      mode: "memory" | "disabled-live" | "rest";
      liveRequested: boolean;
      liveEnabled: false;
      credentialConfigured: boolean;
      projectId: string | null;
      databaseUrlHost: string | null;
      emulatorRequested: boolean;
    };
    models: {
      activeProvider: "mock";
      baseUrl: string;
      apiKeyConfigured: boolean;
      liveRequested: boolean;
      liveEnabled: false;
      aliases: string[];
      timeoutMs: number;
      maxRetries: number;
      estimatedCostUsd: 0;
    };
    browser: {
      active: "mock";
      stubs: Array<"playwright" | "skyvern" | "browser-use">;
    };
  };
  deployment: {
    target: "local" | "staging" | "production";
    mode: "dry-run";
    productionDeployed: false;
    network: false;
    blocked: boolean;
  };
  security: {
    phaseLock: true;
    firebaseRules: "deny-all";
    rateLimit: "local";
    liveEnabled: false;
    productionDeploy: false;
  };
  readiness: {
    decision: "NO-GO";
    technicalScore: number;
    ownerMissing: number;
    network: false;
    productionDeployed: false;
  };
  staging: {
    decision: "NO-GO" | "LOCAL-REHEARSAL-ONLY";
    networkDeploy: false;
    productionDeployed: false;
    blockers: number;
  };
  production: {
    decision: "NO-GO";
    signOffComplete: boolean;
    networkDeploy: false;
    productionDeployed: false;
    blockers: number;
  };
  validation: {
    scope: "simulated" | "refused";
    productionValidated: false;
    productionDeployed: false;
    networkCalls: 0;
    scenarios: number;
  };
  governance: {
    decision: "NO-GO";
    authorization: "not-granted";
    fakeSignOffAccepted: false;
    networkCalls: 0;
    blockers: number;
  };
  operations: {
    decision: "NO-GO";
    authorization: "not-granted";
    evidenceScore: number;
    goEligible: false;
    networkCalls: 0;
    blockers: number;
    rolesBlocked: number;
    ownerCollision: boolean;
  };
}

export type CommandResult<T> =
  | {
      ok: true;
      data: T;
      snapshot: ControlPlaneSnapshot;
      acknowledged?: boolean;
      requestId?: string;
    }
  | {
      ok: false;
      code: string;
      message: string;
      snapshot: ControlPlaneSnapshot;
      acknowledged?: boolean;
      requestId?: string;
    };

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
  const counts = new Map<string, number>();
  return {
    next(prefix: string) {
      const n = (counts.get(prefix) ?? 0) + 1;
      counts.set(prefix, n);
      return `${prefix}_${n}`;
    },
  };
}
