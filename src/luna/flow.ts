import type { LunaControlPlane } from "./control-plane.ts";
import type { AgentRun, TaskStatus } from "./domain.ts";

const TERMINAL = new Set<TaskStatus>(["rejected", "cancelled", "dry_run_completed", "blocked"]);

export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL.has(status);
}

export interface ControlledFlowInput {
  goal: string;
  /** Applied only when the planner asks for approval. */
  decision?: "approved" | "rejected" | "cancel";
}

export interface ControlledFlowResult {
  taskId: string;
  status: TaskStatus;
  terminal: boolean;
  dryRun: true;
  approvalStatus: "none" | "pending" | "approved" | "rejected";
  runStatus: AgentRun["status"] | null;
  auditCount: number;
}

/**
 * Create, plan, optionally approve, then dry-run. Never enables live mode.
 * A missing decision on a sensitive task stops at the approval gate.
 */
export async function runControlledFlow(
  plane: LunaControlPlane,
  input: ControlledFlowInput,
): Promise<ControlledFlowResult> {
  const created = await plane.createTask({ goal: input.goal, mode: "dry-run" });
  const planned = await plane.planTask(created.id);

  if (planned.status === "awaiting_approval") {
    if (input.decision === "cancel") {
      await plane.cancel(planned.id);
    } else if (input.decision === "approved" || input.decision === "rejected") {
      const approvalId = planned.approvalId;
      if (!approvalId) {
        return report(plane, planned.id);
      }
      await plane.decideApproval(
        approvalId,
        input.decision,
        input.decision === "approved" ? "Duyệt dry-run." : "Từ chối.",
      );
      if (input.decision === "approved") await plane.execute(planned.id);
    }
    return report(plane, planned.id);
  }

  if (input.decision === "cancel") {
    await plane.cancel(planned.id);
    return report(plane, planned.id);
  }

  await plane.execute(planned.id);
  return report(plane, planned.id);
}

function report(plane: LunaControlPlane, taskId: string): ControlledFlowResult {
  const snapshot = plane.snapshot();
  const task = snapshot.tasks.find((item) => item.id === taskId);
  const approval = snapshot.approvals.find((item) => item.taskId === taskId);
  const run = snapshot.runs.find((item) => item.taskId === taskId);
  const status = task?.status ?? "blocked";
  return {
    taskId,
    status,
    terminal: isTerminalStatus(status),
    dryRun: true,
    approvalStatus: approval?.status ?? "none",
    runStatus: run?.status ?? null,
    auditCount: snapshot.audit.filter((event) => event.taskId === taskId).length,
  };
}
