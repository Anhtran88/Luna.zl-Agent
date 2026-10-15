import type { BrowserOrchestrator, BrowserBackendId } from "./browser.ts";
import {
  PhaseLockedError,
  type AgentTask,
  type Clock,
  type ExecutionReport,
  type Ids,
  type Plan,
  type PlanStep,
  type StepResult,
} from "./domain.ts";
import type { RealtimeDatabase } from "./firebase.ts";
import type { ModelRouter } from "./models.ts";

export interface PlannerDeps {
  ids: Ids;
  clock: Clock;
}

export interface ExecutorDeps {
  clock: Clock;
  models: ModelRouter;
  browser: BrowserOrchestrator;
  firebase: RealtimeDatabase;
}

const EXTERNAL =
  /đăng nhập|dang nhap|\blogin\b|gửi tin|gui tin|send message|\bupload\b|\bdownload\b|xóa dữ liệu|xoá dữ liệu|delete data/i;

function withoutNegations(text: string): string {
  return text
    .replace(/không\s+đăng nhập/gi, " ")
    .replace(/khong\s+dang nhap/gi, " ")
    .replace(/không\s+gửi/gi, " ")
    .replace(/khong\s+gui/gi, " ")
    .replace(/không\s+upload/gi, " ")
    .replace(/không\s+download/gi, " ")
    .replace(/không\s+ghi/gi, " ")
    .replace(/khong\s+ghi/gi, " ")
    .replace(/không\s+xóa/gi, " ")
    .replace(/không\s+xoá/gi, " ")
    .replace(/khong\s+xoa/gi, " ")
    .replace(/\bno login\b/gi, " ");
}
const BROWSER =
  /trình duyệt|trinh duyet|\bbrowser\b|playwright|skyvern|browser[- ]use|\bzalo\b|\beoffice\b/i;
const MODEL = /tóm tắt|tom tat|soạn|soan|viết|viet|\bmodel\b|\bllm\b|9router/i;
const FIREBASE = /firebase|realtime|hàng đợi|hang doi/i;
const FIREBASE_WRITE =
  /(ghi|lưu|luu|\bwrite\b|\bset\b).{0,40}(firebase|realtime)|(firebase|realtime).{0,40}(ghi|lưu|luu|\bwrite\b|\bset\b)/i;

function step(deps: PlannerDeps, partial: Omit<PlanStep, "id" | "requiresApproval">): PlanStep {
  return {
    ...partial,
    id: deps.ids.next("step"),
    requiresApproval: partial.sensitivity === "sensitive",
  };
}

/** Deterministic planner. It never calls a model or a browser. */
export function createPlan(goal: string, deps: PlannerDeps): Plan {
  const text = goal.trim();
  const steps: PlanStep[] = [
    step(deps, {
      kind: "analyze",
      sensitivity: "safe",
      title: "Phân tích mục tiêu",
      detail: "Phân rã cục bộ trên control plane. Không gọi mạng.",
    }),
  ];

  const intent = withoutNegations(text);

  if (FIREBASE.test(intent)) {
    steps.push(
      step(deps, {
        kind: "firebase_read",
        sensitivity: "safe",
        title: "Đọc hàng đợi bộ nhớ",
        detail: "Chỉ đọc path /luna/queue trên adapter bộ nhớ hoặc adapter bị khóa.",
      }),
    );
  }

  if (FIREBASE_WRITE.test(intent)) {
    steps.push(
      step(deps, {
        kind: "firebase_write",
        sensitivity: "sensitive",
        title: "Ghi Firebase bị khóa",
        detail: "Không gọi set, update, push hay remove.",
      }),
    );
  }

  if (MODEL.test(intent) || (!BROWSER.test(intent) && !FIREBASE.test(intent))) {
    steps.push(
      step(deps, {
        kind: "model",
        sensitivity: "safe",
        title: "Sinh nháp bằng model mock",
        detail: "Model Router giải alias kiểu 9Router rồi chạy adapter mock.",
      }),
    );
  }

  if (BROWSER.test(intent)) {
    steps.push(
      step(deps, {
        kind: "browser",
        sensitivity: "safe",
        title: "Mô phỏng trình duyệt",
        detail: "Orchestrator ép về mock. Playwright, Skyvern và Browser Use không được gọi.",
      }),
    );
  }

  if (EXTERNAL.test(intent)) {
    steps.push(
      step(deps, {
        kind: "external_mutate",
        sensitivity: "sensitive",
        title: "Thao tác ngoài bị khóa",
        detail: "Không đăng nhập, không gửi tin, không upload và không download.",
      }),
    );
  }

  const sensitive = steps.some((item) => item.sensitivity === "sensitive");
  return {
    id: deps.ids.next("plan"),
    createdAt: deps.clock.now(),
    summary: sensitive
      ? "Kế hoạch có bước nhạy cảm. Dry-run chỉ chạy sau khi được duyệt. Live bị khóa."
      : "Kế hoạch an toàn. Có thể dry-run, không có tác động ngoài.",
    steps,
  };
}

export function preferredBrowser(goal: string): BrowserBackendId {
  if (/skyvern/i.test(goal)) return "skyvern";
  if (/browser[- ]use/i.test(goal)) return "browser-use";
  if (/playwright/i.test(goal)) return "playwright";
  return "mock";
}

/**
 * Executor boundary. Assumes the approval gate already passed.
 * Defense in depth: live mode still throws before any adapter call.
 */
export async function executePlan(task: AgentTask, deps: ExecutorDeps): Promise<ExecutionReport> {
  if (task.mode !== "dry-run") {
    throw new PhaseLockedError("Executor từ chối chế độ live ở Phase 0/1.");
  }
  if (!task.plan) {
    throw new PhaseLockedError("Executor cần một kế hoạch.");
  }

  const steps: StepResult[] = [];
  for (const planned of task.plan.steps) {
    steps.push(await runStep(task, planned, deps));
  }

  return {
    taskId: task.id,
    mode: "dry-run",
    outcome: "dry_run_completed",
    steps,
    finishedAt: deps.clock.now(),
  };
}

async function runStep(
  task: AgentTask,
  planned: PlanStep,
  deps: ExecutorDeps,
): Promise<StepResult> {
  switch (planned.kind) {
    case "analyze":
      return {
        stepId: planned.id,
        kind: planned.kind,
        outcome: "simulated",
        summary: `Đã phân tích cục bộ ${task.goal.length} ký tự. Không có tác động ngoài.`,
      };
    case "model": {
      const completion = await deps.models.complete({
        model: "luna-fast",
        messages: [
          { role: "system", content: "Bạn là Luna Phase 0/1. Chỉ mô phỏng." },
          { role: "user", content: task.goal },
        ],
      });
      return {
        stepId: planned.id,
        kind: planned.kind,
        outcome: "simulated",
        summary: completion.content,
      };
    }
    case "browser": {
      const result = await deps.browser.run({
        capability: "snapshot",
        requestedAdapter: preferredBrowser(task.goal),
        target: "about:blank",
      });
      return {
        stepId: planned.id,
        kind: planned.kind,
        outcome: result.outcome,
        summary: result.summary,
      };
    }
    case "firebase_read": {
      try {
        const value = await deps.firebase.get("/luna/queue");
        return {
          stepId: planned.id,
          kind: planned.kind,
          outcome: "simulated",
          summary: `Dry-run đọc /luna/queue: ${JSON.stringify(value)}.`,
        };
      } catch (error) {
        if (error instanceof PhaseLockedError) {
          return {
            stepId: planned.id,
            kind: planned.kind,
            outcome: "refused",
            summary: error.message,
          };
        }
        throw error;
      }
    }
    case "firebase_write":
      return {
        stepId: planned.id,
        kind: planned.kind,
        outcome: "refused",
        summary: "Từ chối ghi Firebase. Không gọi set, update, push hay remove.",
      };
    case "external_mutate":
      return {
        stepId: planned.id,
        kind: planned.kind,
        outcome: "refused",
        summary:
          "Từ chối: Phase 0/1 không đăng nhập, không gửi tin, không upload và không download.",
      };
    default:
      return {
        stepId: planned.id,
        kind: planned.kind,
        outcome: "refused",
        summary: "Bước không được hỗ trợ ở Phase 0/1.",
      };
  }
}
