import { createPlan, executePlan } from "./agent.ts";
import { createBrowserOrchestrator, type BrowserOrchestrator } from "./browser.ts";
import {
  loadFirebasePublicConfig,
  loadNineRouterPublicConfig,
  type FirebasePublicConfig,
  type NineRouterPublicConfig,
} from "./config.ts";
import {
  LunaError,
  randomIds,
  systemClock,
  LUNA_PHASE,
  LUNA_RELEASE,
  type AgentRun,
  type AgentTask,
  type ApprovalRequest,
  type AuditEvent,
  type AuditOutcome,
  type Actor,
  type Clock,
  type ControlPlaneSnapshot,
  type ExecutionMode,
  type Ids,
  type ModuleStatus,
  type StepResult,
} from "./domain.ts";
import { describeDeployPosture, type DeployPosture } from "./deploy.ts";
import { assessReadiness, summarizeReadiness, type ReadinessSummary } from "./readiness.ts";
import { assessStaging, summarizeStaging, type StagingSummary } from "./staging.ts";
import { assessProduction, summarizeProduction, type ProductionSummary } from "./production-gate.ts";
import { simulateValidation, summarizeValidation, type ValidationSummary } from "./validation.ts";
import { evaluateGovernance, summarizeGovernance, type GovernanceSummary } from "./policy.ts";
import { assessOperations, summarizeOperations, type OperationsSummary } from "./operations.ts";
import { redactAuditDetail, SECURITY_POSTURE, containsSecret } from "./security.ts";
import { createRealtimeDatabase, type RealtimeDatabase } from "./firebase.ts";
import { decideExecution, planRequiresApproval } from "./governance.ts";
import { createModelRouter, type ModelRouter } from "./models.ts";
import { SCHEMA_VERSION } from "./schema.ts";
import { MemoryLunaStore, type LunaStore } from "./store.ts";

export interface ControlPlaneDeps {
  clock: Clock;
  ids: Ids;
  firebase: RealtimeDatabase;
  models: ModelRouter;
  browser: BrowserOrchestrator;
  firebaseConfig: FirebasePublicConfig;
  modelConfig: NineRouterPublicConfig;
  store: LunaStore;
  deployment: DeployPosture;
  readiness: ReadinessSummary;
  staging: StagingSummary;
  production: ProductionSummary;
  validation: ValidationSummary;
  governance: GovernanceSummary;
  operations: OperationsSummary;
}

const QUEUE_SEED = { items: [] as string[], phase: LUNA_PHASE };

export class LunaControlPlane {
  private readonly tasks = new Map<string, AgentTask>();
  private readonly approvals = new Map<string, ApprovalRequest>();
  private readonly audits: AuditEvent[] = [];
  private readonly runs: AgentRun[] = [];
  private readonly deps: ControlPlaneDeps;

  constructor(deps: ControlPlaneDeps) {
    this.deps = deps;
  }

  static createDefault(
    env: Record<string, string | undefined>,
    partial?: Partial<ControlPlaneDeps>,
  ): LunaControlPlane {
    const firebaseConfig = partial?.firebaseConfig ?? loadFirebasePublicConfig(env);
    const modelConfig = partial?.modelConfig ?? loadNineRouterPublicConfig(env);
    const firebase =
      partial?.firebase ?? createRealtimeDatabase(firebaseConfig, { "/luna/queue": QUEUE_SEED });
    return new LunaControlPlane({
      clock: partial?.clock ?? systemClock(),
      ids: partial?.ids ?? randomIds(),
      firebase,
      models: partial?.models ?? createModelRouter(modelConfig),
      browser: partial?.browser ?? createBrowserOrchestrator(),
      firebaseConfig,
      modelConfig,
      store: partial?.store ?? new MemoryLunaStore(),
      deployment: partial?.deployment ?? describeDeployPosture(env),
      readiness: partial?.readiness ?? summarizeReadiness(assessReadiness({ env })),
      staging: partial?.staging ?? summarizeStaging(assessStaging({ env })),
      production: partial?.production ?? summarizeProduction(assessProduction({ env })),
      validation: partial?.validation ?? summarizeValidation(simulateValidation({ env })),
      governance: partial?.governance ?? summarizeGovernance(evaluateGovernance({ env })),
      operations: partial?.operations ?? summarizeOperations(assessOperations({ env })),
    });
  }

  async createTask(input: { title?: string; goal: string; mode?: ExecutionMode }): Promise<AgentTask> {
    const goal = input.goal.trim();
    const title = (input.title?.trim() || goal.slice(0, 72)).trim();
    if (goal.length < 3 || goal.length > 2000) {
      throw new LunaError("VALIDATION", "Mục tiêu cần từ 3 đến 2000 ký tự.");
    }
    if (title.length < 1 || title.length > 120) {
      throw new LunaError("VALIDATION", "Tiêu đề cần từ 1 đến 120 ký tự.");
    }
    if (containsSecret(goal) || containsSecret(title)) {
      throw new LunaError("VALIDATION", "Nội dung không được chứa credential.");
    }
    const mode = input.mode ?? "dry-run";
    if (mode !== "dry-run" && mode !== "live") {
      throw new LunaError("VALIDATION", "Chế độ thực thi không hợp lệ.");
    }
    await this.deps.store.ensureSettings(this.deps.clock.now());

    const task: AgentTask = {
      id: this.deps.ids.next("task"),
      title,
      goal,
      sensitivity: "safe",
      mode,
      status: "draft",
      createdAt: this.deps.clock.now(),
    };
    this.tasks.set(task.id, task);
    await this.deps.store.saveTask(task);
    await this.record({
      actor: "operator",
      action: "task.create",
      outcome: "recorded",
      taskId: task.id,
      detail:
        mode === "live"
          ? "Đã ghi nhận yêu cầu live. Thực thi sẽ bị phase lock từ chối."
          : "Đã tạo tác vụ ở chế độ dry-run.",
    });
    return task;
  }

  async planTask(taskId: string): Promise<AgentTask> {
    const task = this.require(taskId);
    if (task.status !== "draft") {
      throw new LunaError("BAD_STATUS", "Chỉ lập kế hoạch từ trạng thái nháp.");
    }
    const plan = createPlan(task.goal, { ids: this.deps.ids, clock: this.deps.clock });
    task.plan = plan;
    task.sensitivity = plan.steps.some((item) => item.sensitivity === "sensitive")
      ? "sensitive"
      : "safe";
    if (planRequiresApproval(plan)) {
      const approval: ApprovalRequest = {
        id: this.deps.ids.next("approval"),
        taskId: task.id,
        reason: plan.steps
          .filter((item) => item.requiresApproval)
          .map((item) => item.title)
          .join("; "),
        status: "pending",
        requestedAt: this.deps.clock.now(),
      };
      this.approvals.set(approval.id, approval);
      task.approvalId = approval.id;
      task.status = "awaiting_approval";
    } else {
      task.status = "planned";
    }
    await this.record({
      actor: "agent",
      action: "task.plan",
      outcome: "recorded",
      taskId: task.id,
      detail: plan.summary,
    });
    await this.deps.store.saveTask(task);
    if (task.approvalId) {
      const approval = this.approvals.get(task.approvalId);
      if (approval) await this.deps.store.saveApproval(approval);
    }
    return task;
  }

  async decideApproval(
    approvalId: string,
    decision: "approved" | "rejected",
    note?: string,
  ): Promise<ApprovalRequest> {
    const approval = this.approvals.get(approvalId);
    if (!approval) throw new LunaError("NOT_FOUND", "Không thấy yêu cầu duyệt.");
    if (approval.status !== "pending") {
      throw new LunaError("BAD_STATUS", "Yêu cầu duyệt đã được quyết định.");
    }
    const task = this.require(approval.taskId);
    if (task.status !== "awaiting_approval") {
      throw new LunaError("BAD_STATUS", "Tác vụ không đang chờ duyệt.");
    }
    approval.status = decision;
    approval.decidedAt = this.deps.clock.now();
    approval.note = note ? redactAuditDetail(note).slice(0, 280) || undefined : undefined;
    task.status = decision === "approved" ? "approved" : "rejected";
    await this.record({
      actor: "operator",
      action: decision === "approved" ? "approval.approve" : "approval.reject",
      outcome: "recorded",
      taskId: task.id,
      detail: approval.note ?? (decision === "approved" ? "Đã duyệt dry-run." : "Đã từ chối."),
    });
    await this.deps.store.saveApproval(approval);
    await this.deps.store.saveTask(task);
    return approval;
  }

  async execute(taskId: string): Promise<AgentTask> {
    const task = this.require(taskId);
    const startedAt = this.deps.clock.now();
    const approval = task.approvalId ? this.approvals.get(task.approvalId) : undefined;
    const gate = decideExecution({ task, approval });
    if (!gate.ok) {
      if (gate.code === "PHASE_LOCK") task.status = "blocked";
      await this.record({
        actor: "system",
        action: "task.execute",
        outcome: gate.code === "PHASE_LOCK" ? "refused" : "blocked",
        taskId: task.id,
        detail: gate.message,
      });
      await this.persistRun(
        task.id,
        gate.code === "PHASE_LOCK" ? "refused" : "blocked",
        [],
        startedAt,
      );
      await this.deps.store.saveTask(task);
      throw new LunaError(gate.code, gate.message);
    }

    const report = await executePlan(task, {
      clock: this.deps.clock,
      models: this.deps.models,
      browser: this.deps.browser,
      firebase: this.deps.firebase,
    });
    task.lastReport = report;
    task.status = "dry_run_completed";
    for (const step of report.steps) {
      await this.record({
        actor: "agent",
        action: `step.${step.kind}`,
        outcome: step.outcome === "refused" ? "refused" : "simulated",
        taskId: task.id,
        detail: step.summary,
      });
    }
    await this.record({
      actor: "system",
      action: "task.execute",
      outcome: "simulated",
      taskId: task.id,
      detail: "Dry-run hoàn tất. Không có tác động production.",
    });
    await this.persistRun(task.id, "completed", report.steps, startedAt);
    await this.deps.store.saveTask(task);
    return task;
  }

  async cancel(taskId: string): Promise<AgentTask> {
    const task = this.require(taskId);
    if (
      task.status === "dry_run_completed" ||
      task.status === "blocked" ||
      task.status === "rejected" ||
      task.status === "cancelled"
    ) {
      throw new LunaError("TERMINAL", "Tác vụ đã kết thúc, không hủy được.");
    }
    task.status = "cancelled";
    await this.record({
      actor: "operator",
      action: "task.cancel",
      outcome: "recorded",
      taskId: task.id,
      detail: "Operator đã hủy tác vụ trước khi có tác động ngoài.",
    });
    await this.deps.store.saveTask(task);
    return task;
  }

  snapshot(): ControlPlaneSnapshot {
    const { firebaseConfig, modelConfig, firebase, store } = this.deps;
    return {
      phase: LUNA_PHASE,
      release: LUNA_RELEASE,
      phaseLock: true,
      schemaVersion: SCHEMA_VERSION,
      storeMode: store.mode,
      generatedAt: this.deps.clock.now(),
      modules: moduleCatalog(
        firebase.mode,
        this.deps.deployment,
        this.deps.readiness,
        this.deps.staging,
        this.deps.production,
        this.deps.validation,
        this.deps.governance,
        this.deps.operations,
      ),
      tasks: [...this.tasks.values()].reverse(),
      approvals: [...this.approvals.values()].reverse(),
      runs: [...this.runs].reverse().slice(0, 20),
      audit: [...this.audits].reverse().slice(0, 40),
      adapters: {
        firebase: {
          mode: firebase.mode,
          liveRequested: firebaseConfig.liveRequested,
          liveEnabled: false,
          credentialConfigured: firebaseConfig.credentialConfigured,
          projectId: firebaseConfig.projectId,
          databaseUrlHost: firebaseConfig.databaseUrlHost,
          emulatorRequested: firebaseConfig.emulatorRequested,
        },
        models: {
          activeProvider: "mock",
          baseUrl: modelConfig.baseUrl,
          apiKeyConfigured: modelConfig.apiKeyConfigured,
          liveRequested: modelConfig.liveRequested,
          liveEnabled: false,
          aliases: Object.keys(modelConfig.aliases),
          timeoutMs: modelConfig.timeoutMs,
          maxRetries: modelConfig.maxRetries,
          estimatedCostUsd: 0,
        },
        browser: {
          active: "mock",
          stubs: ["playwright", "skyvern", "browser-use"],
        },
      },
      deployment: this.deps.deployment,
      security: SECURITY_POSTURE,
      readiness: this.deps.readiness,
      staging: this.deps.staging,
      production: this.deps.production,
      validation: this.deps.validation,
      governance: this.deps.governance,
      operations: this.deps.operations,
    };
  }

  private require(taskId: string): AgentTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new LunaError("NOT_FOUND", "Không thấy tác vụ.");
    return task;
  }

  private async record(input: {
    actor: Actor;
    action: string;
    outcome: AuditOutcome;
    detail: string;
    taskId?: string;
  }): Promise<void> {
    const event: AuditEvent = {
      id: this.deps.ids.next("audit"),
      at: this.deps.clock.now(),
      dryRun: true,
      ...input,
      detail: redactAuditDetail(input.detail),
    };
    this.audits.push(event);
    await this.deps.store.appendAudit(event);
  }

  private async persistRun(
    taskId: string,
    status: AgentRun["status"],
    steps: StepResult[],
    startedAt: string,
  ): Promise<void> {
    const run: AgentRun = {
      id: this.deps.ids.next("run"),
      taskId,
      status,
      startedAt,
      finishedAt: this.deps.clock.now(),
      dryRun: true,
      stepOutcomes: steps,
    };
    this.runs.push(run);
    await this.deps.store.saveRun(run);
  }
}

function moduleCatalog(
  firebaseMode: "memory" | "disabled-live" | "rest",
  deployment: DeployPosture,
  readiness: ReadinessSummary,
  staging: StagingSummary,
  production: ProductionSummary,
  validation: ValidationSummary,
  governance: GovernanceSummary,
  operations: OperationsSummary,
): ModuleStatus[] {
  return [
    {
      id: "web",
      name: "Luna Web",
      state: "ready",
      detail: "Bảng điều khiển Phase 12. Compliance local vẫn NO-GO.",
    },
    {
      id: "agent",
      name: "Agent Engine",
      state: "ready",
      detail: "Planner, executor và run được ghi qua persistence port.",
    },
    {
      id: "router",
      name: "Model Router",
      state: "mock",
      detail: "Registry, alias, timeout và retry. Adapter đang chạy là mock, chi phí $0.",
    },
    {
      id: "browser",
      name: "Browser Orchestrator",
      state: "mock",
      detail: "Playwright, Skyvern và Browser Use chỉ là stub.",
    },
    {
      id: "firebase",
      name: "Firebase RTDB",
      state: firebaseMode === "memory" ? "memory" : "locked",
      detail:
        firebaseMode === "rest"
          ? "REST client chỉ chạy khi test tiêm transport. App này không tự kết nối."
          : "Schema v1. Mặc định là bộ nhớ. Live không mở socket.",
    },
    {
      id: "governance",
      name: "Approval & Audit",
      state: "ready",
      detail: "Bước nhạy cảm cần duyệt, dry-run và nhật ký. phaseLock không ghi tắt được.",
    },
    {
      id: "deploy",
      name: "Deployment",
      state: deployment.blocked ? "locked" : "ready",
      detail: deployment.blocked
        ? `${deployment.target} bị chặn. Không publish, không rules, không mạng production.`
        : `${deployment.target} dry-run. Chưa production và không gọi mạng ngoài.`,
    },
    {
      id: "security",
      name: "Security",
      state: "locked",
      detail: "Rules deny-all, header an toàn, rate-limit local. Live và production vẫn khóa.",
    },
    {
      id: "readiness",
      name: "Readiness",
      state: "locked",
      detail: `NO-GO. Điểm kỹ thuật ${readiness.technicalScore}. Còn ${readiness.ownerMissing} điều kiện chủ repo.`,
    },
    {
      id: "staging",
      name: "Staging",
      state: "locked",
      detail: `${staging.decision}. ${staging.blockers} điều kiện còn mở. Không gọi mạng.`,
    },
    {
      id: "production",
      name: "Production gate",
      state: "locked",
      detail: `NO-GO. Sign-off ${production.signOffComplete ? "đủ trên giấy" : "chưa đủ"}. Không cấp quyền deploy.`,
    },
    {
      id: "validation",
      name: "Validation",
      state: "mock",
      detail: `${validation.scope}. ${validation.scenarios} kịch bản local. Không phải production validation.`,
    },
    {
      id: "policy",
      name: "Governance",
      state: "locked",
      detail: `NO-GO. ${governance.blockers} điều kiện policy còn mở. Cờ xác nhận không được chấp nhận.`,
    },
    {
      id: "operations",
      name: "Operations",
      state: "locked",
      detail: `NO-GO. Evidence ${operations.evidenceScore}/100. ${operations.blockers} điều kiện vận hành còn mở.`,
    },
  ];
}
