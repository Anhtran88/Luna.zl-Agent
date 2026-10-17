import { createHash } from "node:crypto";
import { authorizeAccess, type VerifiedAccess } from "./access-policy.ts";
import { SqlWorkspaceStore, type WorkspaceDocument } from "./atomic-store.ts";
import { LunaControlPlane } from "./control-plane.ts";
import { LunaError, type CommandResult, type ControlPlaneSnapshot } from "./domain.ts";
import { redactAuditDetail } from "./security.ts";

export type WorkspaceCommand =
  | { kind: "create"; goal: string; title?: string }
  | { kind: "plan" | "execute" | "cancel"; taskId: string }
  | { kind: "approval"; approvalId: string; decision: "approved" | "rejected"; note?: string };

type Outcome = { ok: true; data: unknown } | { ok: false; code: string; message: string };

function restore(document: WorkspaceDocument | null): {
  plane: LunaControlPlane;
  owners: Record<string, string>;
} {
  if (!document) return { plane: LunaControlPlane.createDefault({}), owners: {} };
  if (document.version !== 1 || !document.taskOwners || typeof document.taskOwners !== "object")
    throw new LunaError("MIGRATION", "Workspace document không tương thích.");
  const plane = LunaControlPlane.restoreCheckpoint(document.plane);
  for (const task of document.plane.tasks) {
    if (!/^better-auth:[a-zA-Z0-9_:-]{1,128}$/.test(document.taskOwners[task.id] ?? ""))
      throw new LunaError("VALIDATION", "Task thiếu verified owner.");
  }
  return { plane, owners: structuredClone(document.taskOwners) };
}

function snapshot(plane: LunaControlPlane): ControlPlaneSnapshot {
  return { ...plane.snapshot(), storeMode: "postgres" };
}

/** All work is deterministic local simulation: no remote adapters or external side effects. */
export class WorkspaceService {
  private readonly store: SqlWorkspaceStore;
  constructor(store: SqlWorkspaceStore) {
    this.store = store;
  }

  async snapshot(access: VerifiedAccess): Promise<ControlPlaneSnapshot> {
    authorizeAccess(access, "read");
    return snapshot(restore(await this.store.read(access.workspace.id)).plane);
  }

  async command(
    access: VerifiedAccess,
    requestId: string,
    command: WorkspaceCommand,
  ): Promise<CommandResult<unknown>> {
    if (!["create", "plan", "approval", "execute", "cancel"].includes(command.kind))
      throw new LunaError("VALIDATION", "Command không hợp lệ.");
    authorizeAccess(access, command.kind);
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(requestId))
      throw new LunaError("VALIDATION", "Cần request id ổn định để retry.");
    const canonical = JSON.stringify(
      Object.fromEntries(
        Object.entries(command)
          .filter(([, value]) => value !== undefined)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    );
    const fingerprint = createHash("sha256").update(canonical).digest("hex");
    const outcome = await this.store.command<Outcome>(
      access.workspace.id,
      requestId,
      access.subject,
      fingerprint,
      () => authorizeAccess(access, command.kind),
      async (document) => {
        // Recheck expiry after waiting for another worker's row lock.
        authorizeAccess(access, command.kind);
        const { plane, owners } = restore(document);
        const before = plane.exportCheckpoint().audits.length;
        let result: Outcome;
        try {
          let taskId: string | undefined;
          if (command.kind === "approval")
            taskId = plane.snapshot().approvals.find((a) => a.id === command.approvalId)?.taskId;
          else if (command.kind !== "create") taskId = command.taskId;
          if (command.kind !== "create") {
            if (!taskId || !Object.hasOwn(owners, taskId))
              throw new LunaError("NOT_FOUND", "Không thấy tác vụ trong workspace.");
            if (
              command.kind === "approval"
                ? owners[taskId] === access.subject
                : owners[taskId] !== access.subject
            )
              throw new LunaError(
                "FORBIDDEN",
                "Không được tự duyệt hoặc thao tác tác vụ của người khác.",
              );
          }
          let data: unknown;
          switch (command.kind) {
            case "create": {
              const task = await plane.createTask({
                goal: command.goal,
                title: command.title,
                mode: "dry-run",
              });
              owners[task.id] = access.subject;
              data = task;
              break;
            }
            case "plan":
              data = await plane.planTask(command.taskId);
              break;
            case "approval":
              data = await plane.decideApproval(command.approvalId, command.decision, command.note);
              break;
            case "execute":
              data = await plane.execute(command.taskId);
              break;
            case "cancel":
              data = await plane.cancel(command.taskId);
              break;
          }
          result = { ok: true, data };
        } catch (error) {
          if (!(error instanceof LunaError)) throw error; // Transaction rollback; no partial state/receipt.
          result = {
            ok: false,
            code: error.code,
            message: redactAuditDetail(error.message),
          };
        }
        const checkpoint = plane.exportCheckpoint();
        for (const event of checkpoint.audits.slice(before)) {
          event.principal = access.subject;
          event.workspaceId = access.workspace.id;
          event.requestId = requestId;
        }
        const next = { version: 1 as const, plane: checkpoint, taskOwners: owners };
        return { document: next, result };
      },
    );
    // Replay preserves the command outcome, then reads a fresh authorized snapshot.
    return { ...outcome, snapshot: await this.snapshot(access), acknowledged: true, requestId };
  }
}
