import type { AgentTask, ApprovalRequest, Plan } from "./domain.ts";

export function planRequiresApproval(plan: Plan): boolean {
  return plan.steps.some((step) => step.requiresApproval);
}

export type ExecutionGate =
  | { ok: true; dryRun: true }
  | {
      ok: false;
      code: "NO_PLAN" | "TERMINAL" | "PHASE_LOCK" | "APPROVAL_REQUIRED" | "BAD_STATUS";
      message: string;
    };

/**
 * Pure gate. Live mode is refused before an approval can authorize it,
 * so Phase 0/1 never asks the operator to approve a real side effect.
 */
export function decideExecution(input: {
  task: AgentTask;
  approval?: ApprovalRequest;
}): ExecutionGate {
  const { task, approval } = input;

  if (
    task.status === "cancelled" ||
    task.status === "rejected" ||
    task.status === "dry_run_completed"
  ) {
    return { ok: false, code: "TERMINAL", message: "Tác vụ đã kết thúc." };
  }

  if (!task.plan) {
    return { ok: false, code: "NO_PLAN", message: "Chưa có kế hoạch để thực thi." };
  }

  if (task.mode === "live") {
    return {
      ok: false,
      code: "PHASE_LOCK",
      message:
        "Phase 0/1 từ chối thực thi live. Không đăng nhập, không gửi tin, không ghi dữ liệu thật.",
    };
  }

  if (planRequiresApproval(task.plan) && approval?.status !== "approved") {
    return {
      ok: false,
      code: "APPROVAL_REQUIRED",
      message: "Bước nhạy cảm cần được duyệt trước khi dry-run.",
    };
  }

  if (task.status !== "planned" && task.status !== "approved") {
    return {
      ok: false,
      code: "BAD_STATUS",
      message: `Không chạy được từ trạng thái ${task.status}.`,
    };
  }

  return { ok: true, dryRun: true };
}
