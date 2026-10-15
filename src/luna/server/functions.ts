import { createServerFn } from "@tanstack/react-start";
import { LunaControlPlane } from "../control-plane.ts";
import { LunaError, type CommandResult } from "../domain.ts";

let plane: LunaControlPlane | undefined;

export function getControlPlane(): LunaControlPlane {
  if (!plane) plane = LunaControlPlane.createDefault(process.env);
  return plane;
}

async function run<T>(
  work: (current: LunaControlPlane) => Promise<T> | T,
): Promise<CommandResult<T>> {
  const current = getControlPlane();
  try {
    const data = await work(current);
    return { ok: true, data, snapshot: current.snapshot() };
  } catch (error) {
    if (error instanceof LunaError) {
      return {
        ok: false,
        code: error.code,
        message: error.message,
        snapshot: current.snapshot(),
      };
    }
    throw error;
  }
}

function readObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") throw new Error("Payload không hợp lệ.");
  return input as Record<string, unknown>;
}

function approvalDecision(value: unknown): "approved" | "rejected" {
  if (value === "approved" || value === "rejected") return value;
  throw new Error("Quyết định duyệt không hợp lệ.");
}

function readId(input: unknown, key: string, pattern: RegExp): string {
  const body = readObject(input);
  const value = body[key];
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error("Mã không hợp lệ.");
  }
  return value;
}

export const getSnapshotFn = createServerFn({ method: "GET" }).handler(async () => {
  return getControlPlane().snapshot();
});

export const createTaskFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = readObject(input);
    if (body.mode === "live") {
      throw new Error("API Phase 0/1 không nhận chế độ live.");
    }
    const goal = typeof body.goal === "string" ? body.goal.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (goal.length < 3 || goal.length > 2000) {
      throw new Error("Mục tiêu cần từ 3 đến 2000 ký tự.");
    }
    if (title.length > 120) throw new Error("Tiêu đề quá dài.");
    return { goal, title };
  })
  .handler(async ({ data }) => {
    return run((current) =>
      current.createTask({
        goal: data.goal,
        title: data.title || undefined,
        mode: "dry-run",
      }),
    );
  });

export const planTaskFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ taskId: readId(input, "taskId", /^task_[\w-]+$/) }))
  .handler(async ({ data }) => run((current) => current.planTask(data.taskId)));

export const decideApprovalFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = readObject(input);
    const approvalId = readId(body, "approvalId", /^approval_[\w-]+$/);
    const decision = approvalDecision(body.decision);
    const note = typeof body.note === "string" ? body.note.slice(0, 280) : undefined;
    return { approvalId, decision, note };
  })
  .handler(async ({ data }) => {
    return run((current) => current.decideApproval(data.approvalId, data.decision, data.note));
  });

export const executeTaskFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ taskId: readId(input, "taskId", /^task_[\w-]+$/) }))
  .handler(async ({ data }) => run((current) => current.execute(data.taskId)));

export const cancelTaskFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ taskId: readId(input, "taskId", /^task_[\w-]+$/) }))
  .handler(async ({ data }) => run((current) => current.cancel(data.taskId)));
