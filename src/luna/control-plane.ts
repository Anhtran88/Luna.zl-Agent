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
} from "./domain.ts";
import { createRealtimeDatabase, type RealtimeDatabase } from "./firebase.ts";
import { decideExecution, planRequiresApproval } from "./governance.ts";
import { createModelRouter, type ModelRouter } from "./models.ts";

export interface ControlPlaneDeps {
  clock: Clock;
  ids: Ids;
  firebase: RealtimeDatabase;
  models: ModelRouter;
  browser: BrowserOrchestrator;
  firebaseConfig: FirebasePublicConfig;
  modelConfig: NineRouterPublicConfig;
}

const QUEUE_SEED = { items: [] as string[], phase: LUNA_PHASE };

export class LunaControlPlane {
  private readonly tasks = new Map<string, AgentTask>();
  private readonly approvals = new Map<string, ApprovalRequest>();
  private readonly audits: AuditEvent[] = [];
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
    });
  }

  createTask(input: { title?: string; goal: string; mode?: ExecutionMode }): AgentTask {
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
    this.record({
      actor: "operator",
      action: "task.create",
      outcome: "recorded",
      taskId: task.id,
      detail:
        mode === "live"
          ? "Đã ghi nhận yêu cầu live. Thực thi sẽ bị Phase 0/1 từ chối."
          : "Đã tạo tác vụ ở chế độ dry-run.",
    });
    return task;
  }

  planTask(taskId: string): AgentTask {
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
    this.record({
      actor: "agent",
      action: "task.plan",
      outcome: "recorded",
      taskId: task.id,
      detail: plan.summary,
    });
    return task;
  }

  decideApproval(
    approvalId: string,
    decision: "approved" | "rejected",
    note?: string,
  ): ApprovalRequest {
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
    this.record({
      actor: "operator",
      action: decision === "approved" ? "approval.approve" : "approval.reject",
      outcome: "recorded",
      taskId: task.id,
      detail: approval.note ?? (decision === "approved" ? "Đã duyệt dry-run." : "Đã từ chối."),
    });
    return approval;
  }

  async execute(taskId: string): Promise<AgentTask> {
    const task = this.require(taskId);
    const approval = task.approvalId ? this.approvals.get(task.approvalId) : undefined;
    const gate = decideExecution({ task, approval });
    if (!gate.ok) {
      if (gate.code === "PHASE_LOCK") task.status = "blocked";
      this.record({
        actor: "system",
        action: "task.execute",
        outcome: gate.code === "PHASE_LOCK" ? "refused" : "blocked",
        taskId: task.id,
        detail: gate.message,
      });
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
      this.record({
        actor: "agent",
        action: `step.${step.kind}`,
        outcome: step.outcome === "refused" ? "refused" : "simulated",
        taskId: task.id,
        detail: step.summary,
      });
    }
    this.record({
      actor: "system",
      action: "task.execute",
      outcome: "simulated",
      taskId: task.id,
      detail: "Dry-run hoàn tất. Không có tác động production.",
    });
    return task;
  }

  cancel(taskId: string): AgentTask {
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
    this.record({
      actor: "operator",
      action: "task.cancel",
      outcome: "recorded",
      taskId: task.id,
      detail: "Operator đã hủy tác vụ trước khi có tác động ngoài.",
    });
    return task;
  }

  snapshot(): ControlPlaneSnapshot {
    const { firebaseConfig, modelConfig, firebase } = this.deps;
    return {
      phase: LUNA_PHASE,
      phaseLock: true,
      generatedAt: this.deps.clock.now(),
      modules: moduleCatalog(firebase.mode),
      tasks: [...this.tasks.values()].reverse(),
      approvals: [...this.approvals.values()].reverse(),
      audit: [...this.audits].reverse().slice(0, 40),
      adapters: {
        firebase: {
          mode: firebase.mode,
          liveRequested: firebaseConfig.liveRequested,
          liveEnabled: false,
          credentialConfigured: firebaseConfig.credentialConfigured,
          projectId: firebaseConfig.projectId,
          databaseUrlHost: firebaseConfig.databaseUrlHost,
        },
        models: {
          activeProvider: "mock",
          baseUrl: modelConfig.baseUrl,
          apiKeyConfigured: modelConfig.apiKeyConfigured,
          liveRequested: modelConfig.liveRequested,
          liveEnabled: false,
          aliases: Object.keys(modelConfig.aliases),
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

  private record(input: {
    actor: Actor;
    action: string;
    outcome: AuditOutcome;
    detail: string;
    taskId?: string;
  }): void {
    this.audits.push({
      id: this.deps.ids.next("audit"),
      at: this.deps.clock.now(),
      dryRun: true,
      ...input,
    });
  }
}

function moduleCatalog(firebaseMode: "memory" | "disabled-live"): ModuleStatus[] {
  return [
    {
      id: "web",
      name: "Luna Web",
      state: "ready",
      detail: "Bảng điều khiển và server functions. Không giữ secret.",
    },
    {
      id: "agent",
      name: "Agent Engine",
      state: "ready",
      detail: "Task model, planner và executor tách biệt.",
    },
    {
      id: "router",
      name: "Model Router",
      state: "mock",
      detail: "Tên model kiểu 9Router. Adapter đang chạy là mock.",
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
      detail: "Port + adapter bộ nhớ. Live không mở kết nối.",
    },
    {
      id: "governance",
      name: "Approval & Audit",
      state: "ready",
      detail: "Bước nhạy cảm cần duyệt, dry-run và nhật ký.",
    },
  ];
}
