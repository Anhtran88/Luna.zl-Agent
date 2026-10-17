import { LunaError } from "./domain.ts";
import type { LunaControlPlane } from "./control-plane.ts";

export type OperatorCommand = "approval" | "execute";
/** Server-resolved context only. Never deserialize this from a request body/header. */
export interface OperatorContext {
  principal: { authenticated: boolean; roles: readonly string[] } | null;
  ownerAuthorized: boolean;
  ownerCollision: boolean;
}

export function assertOperatorAccess(action: OperatorCommand, context: OperatorContext): void {
  if (context.principal?.authenticated !== true) {
    throw new LunaError(
      "AUTH_REQUIRED",
      "Chưa có xác thực operator đáng tin cậy. Không duyệt hoặc thực thi.",
    );
  }
  const role = action === "approval" ? "approver" : "executor";
  if (!context.principal.roles.includes(role))
    throw new LunaError("ROLE_REQUIRED", "Thiếu vai trò operator cần thiết.");
  if (context.ownerCollision !== false)
    throw new LunaError("OWNER_COLLISION", "Owner collision chưa được giải quyết.");
  if (context.ownerAuthorized !== true)
    throw new LunaError("OWNER_AUTHORIZATION", "Chưa có owner authorization hợp lệ.");
}

/** No trusted identity/role resolver exists yet. Do not trust auth-off or a client claim. */
export async function runOperatorCommand<T>(
  plane: LunaControlPlane,
  action: OperatorCommand,
  work: () => Promise<T>,
): Promise<T> {
  assertOperatorAccess(action, {
    principal: null,
    ownerAuthorized: false,
    ownerCollision: plane.snapshot().operations.ownerCollision,
  });
  return work();
}
