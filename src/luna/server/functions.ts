import { createServerFn } from "@tanstack/react-start";
import { runOperatorCommand } from "../authorization.ts";
import { LunaControlPlane } from "../control-plane.ts";
import { LunaError, type CommandResult } from "../domain.ts";
import { guardLocalRequest, parseCreateTaskInput, redactAuditDetail } from "../security.ts";
import { workspaceRuntime, trustedAuthEnabled } from "./runtime.server.ts";
import type { WorkspaceCommand } from "../workspace-service.ts";

let plane: LunaControlPlane | undefined;

export const getAuthStatusFn = createServerFn({ method: "GET" }).handler(() => ({
  configured: trustedAuthEnabled(),
}));

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
        message: redactAuditDetail(error.message).slice(0, 240) || "Không xử lý được yêu cầu.",
        snapshot: current.snapshot(),
      };
    }
    return {
      ok: false,
      code: "INTERNAL",
      message: "Không xử lý được yêu cầu.",
      snapshot: current.snapshot(),
    };
  }
}

async function dispatch<T>(
  command: WorkspaceCommand,
  requestId: string,
  demo: (current: LunaControlPlane) => Promise<T>,
): Promise<CommandResult<T>> {
  let submitted = false;
  try {
    const runtime = await workspaceRuntime();
    if (runtime) {
      submitted = true;
      return (await runtime.service.command(
        runtime.access,
        requestId,
        command,
      )) as CommandResult<T>;
    }
    return run(demo);
  } catch (error) {
    if (
      submitted &&
      (!(error instanceof LunaError) ||
        ![
          "VALIDATION",
          "ROLE_REQUIRED",
          "OWNER_COLLISION",
          "FORBIDDEN",
          "REPLAY_CONFLICT",
        ].includes(error.code))
    ) {
      return {
        ok: false,
        code: "PERSISTENCE_UNCERTAIN",
        message:
          "Chưa xác nhận được kết quả lưu. Giữ request id và retry sau khi kết nối/quyền được khôi phục.",
        snapshot: LunaControlPlane.createDefault({}).snapshot(),
      };
    }
    // Never return another user's/global demo state when identity, policy or persistence fails.
    return {
      ok: false,
      code: error instanceof LunaError ? error.code : "INTERNAL",
      message:
        error instanceof LunaError ? redactAuditDetail(error.message) : "Không xử lý được yêu cầu.",
      snapshot: LunaControlPlane.createDefault({}).snapshot(),
    };
  }
}

function requestId(input: unknown): string {
  const value = readObject(input).requestId;
  return typeof value === "string" ? value : ""; // Required by the verified path; demo has no durable identity.
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
  guardLocalRequest("snapshot");
  try {
    const runtime = await workspaceRuntime();
    if (runtime) return await runtime.service.snapshot(runtime.access);
    return getControlPlane().snapshot();
  } catch (error) {
    if (error instanceof LunaError)
      throw new LunaError(error.code, redactAuditDetail(error.message));
    throw new LunaError(
      "AUTH_UNAVAILABLE",
      "Không xác minh hoặc đọc được workspace. Không fallback demo.",
    );
  }
});

export const createTaskFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    guardLocalRequest("create-task");
    return { ...parseCreateTaskInput(input), requestId: requestId(input) };
  })
  .handler(async ({ data }) => {
    return dispatch(
      { kind: "create", goal: data.goal, title: data.title || undefined },
      data.requestId,
      (current) =>
        current.createTask({
          goal: data.goal,
          title: data.title || undefined,
          mode: "dry-run",
        }),
    );
  });

export const planTaskFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    guardLocalRequest("plan-task");
    return { taskId: readId(input, "taskId", /^task_[\w-]+$/), requestId: requestId(input) };
  })
  .handler(async ({ data }) =>
    dispatch({ kind: "plan", taskId: data.taskId }, data.requestId, (current) =>
      current.planTask(data.taskId),
    ),
  );

export const decideApprovalFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = readObject(input);
    guardLocalRequest("decide-approval");
    const approvalId = readId(body, "approvalId", /^approval_[\w-]+$/);
    const decision = approvalDecision(body.decision);
    const note =
      typeof body.note === "string" ? redactAuditDetail(body.note).slice(0, 280) : undefined;
    return { approvalId, decision, note, requestId: requestId(input) };
  })
  .handler(async ({ data }) => {
    return dispatch(
      { kind: "approval", approvalId: data.approvalId, decision: data.decision, note: data.note },
      data.requestId,
      (current) =>
        runOperatorCommand(current, "approval", () =>
          current.decideApproval(data.approvalId, data.decision, data.note),
        ),
    );
  });

export const executeTaskFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    guardLocalRequest("execute-task");
    return { taskId: readId(input, "taskId", /^task_[\w-]+$/), requestId: requestId(input) };
  })
  .handler(async ({ data }) =>
    dispatch({ kind: "execute", taskId: data.taskId }, data.requestId, (current) =>
      runOperatorCommand(current, "execute", () => current.execute(data.taskId)),
    ),
  );

export const cancelTaskFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    guardLocalRequest("cancel-task");
    return { taskId: readId(input, "taskId", /^task_[\w-]+$/), requestId: requestId(input) };
  })
  .handler(async ({ data }) =>
    dispatch({ kind: "cancel", taskId: data.taskId }, data.requestId, (current) =>
      current.cancel(data.taskId),
    ),
  );
