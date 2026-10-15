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
    approval.note = note?.trim().slice(0, 280) || undefined;
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
      modules: moduleCatalog(firebase.mode),
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

function moduleCatalog(firebaseMode: "memory" | "disabled-live" | "rest"): ModuleStatus[] {
  return [
    {
      id: "web",
      name: "Luna Web",
      state: "ready",
      detail: "Bảng điều khiển Phase 4. Adapter locked hoặc mock. Không có nút tắt khóa.",
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
  ];
}
