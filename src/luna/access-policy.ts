import { importJWK, jwtVerify, type JWK } from "jose";
import { LunaError } from "./domain.ts";

export const DUTIES = [
  "requester",
  "approver",
  "environment-owner",
  "credential-owner",
  "security-reviewer",
  "rollback-owner",
  "incident-owner",
] as const;
export type Duty = (typeof DUTIES)[number];
export interface WorkspacePolicy {
  id: string;
  duties: Record<Duty, string | null>;
}
export interface AccessPolicy {
  version: 1;
  workspaces: WorkspacePolicy[];
}
export interface VerifiedAccess {
  subject: string;
  workspace: WorkspacePolicy;
  expiresAt: number;
}
export type SessionVerifier = () => Promise<{ id: string } | null>;

/** A verified session id only; email, client roles and client workspace ids are not authority. */
export async function verifiedSubject(verify: SessionVerifier): Promise<string> {
  try {
    const user = await verify();
    if (user && typeof user.id === "string" && /^[a-zA-Z0-9_:-]{1,128}$/.test(user.id))
      return `better-auth:${user.id}`;
  } catch {
    /* Failed verification never falls back to the shared dev user. */
  }
  throw new LunaError("AUTH_REQUIRED", "Cần session hợp lệ đã được server xác minh.");
}

export function parseAccessPolicy(value: unknown): AccessPolicy {
  const raw = value as AccessPolicy;
  if (!raw || raw.version !== 1 || !Array.isArray(raw.workspaces) || raw.workspaces.length > 100)
    throw new LunaError("POLICY_INVALID", "Policy không hợp lệ.");
  const ids = new Set<string>();
  const subjects = new Set<string>();
  for (const workspace of raw.workspaces) {
    if (
      !workspace ||
      typeof workspace.id !== "string" ||
      !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(workspace.id) ||
      ids.has(workspace.id) ||
      !workspace.duties ||
      typeof workspace.duties !== "object"
    )
      throw new LunaError("POLICY_INVALID", "Workspace policy không hợp lệ.");
    ids.add(workspace.id);
    const local = new Set<string>();
    if (Object.keys(workspace.duties).some((key) => !(DUTIES as readonly string[]).includes(key)))
      throw new LunaError("POLICY_INVALID", "Policy chứa vai trò không hợp lệ.");
    for (const duty of DUTIES) {
      const subject = workspace.duties[duty];
      if (
        subject !== null &&
        (typeof subject !== "string" || !/^better-auth:[a-zA-Z0-9_:-]{1,128}$/.test(subject))
      )
        throw new LunaError("POLICY_INVALID", "Policy thiếu hoặc sai principal.");
      if (subject) local.add(subject);
    }
    // No client workspace selector: each account has exactly one server-assigned workspace.
    for (const subject of local) {
      if (subjects.has(subject))
        throw new LunaError("POLICY_INVALID", "Principal có nhiều workspace chưa được hỗ trợ.");
      subjects.add(subject);
    }
  }
  return structuredClone(raw);
}

/** Trust anchor comes from server configuration, never JWS jku/x5u or request headers. */
export async function verifySignedPolicy(
  token: string,
  publicKey: JWK,
  issuer: string,
  now = new Date(),
): Promise<{ policy: AccessPolicy; expiresAt: number }> {
  try {
    if (!issuer || publicKey.kty !== "OKP" || publicKey.crv !== "Ed25519" || publicKey.d)
      throw new Error("invalid trust anchor");
    const key = await importJWK(publicKey, "EdDSA");
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["EdDSA"],
      issuer,
      audience: "luna-local-access",
      subject: "luna-access-policy",
      requiredClaims: ["exp", "iat", "sub"],
      maxTokenAge: "24 hours",
      currentDate: now,
    });
    if (!payload.exp || !payload.iat || payload.exp - payload.iat > 86400)
      throw new Error("invalid policy lifetime");
    return { policy: parseAccessPolicy(payload.policy), expiresAt: payload.exp * 1000 };
  } catch {
    throw new LunaError(
      "POLICY_INVALID",
      "Policy thiếu chữ ký tin cậy, hết hạn hoặc không hợp lệ.",
    );
  }
}

export function bindAccess(
  subject: string,
  signed: { policy: AccessPolicy; expiresAt: number },
): VerifiedAccess {
  const workspace = signed.policy.workspaces.find((w) => Object.values(w.duties).includes(subject));
  if (!workspace) throw new LunaError("FORBIDDEN", "Tài khoản chưa được cấp workspace.");
  return { subject, workspace: structuredClone(workspace), expiresAt: signed.expiresAt };
}

export function authorizeAccess(
  access: VerifiedAccess,
  action: "read" | "create" | "plan" | "cancel" | "approval" | "execute",
  now = Date.now(),
): void {
  if (now >= access.expiresAt) throw new LunaError("POLICY_EXPIRED", "Policy đã hết hạn.");
  if (!Object.values(access.workspace.duties).includes(access.subject))
    throw new LunaError("FORBIDDEN", "Không thuộc workspace.");
  if (action === "read") return;
  const duty = action === "approval" ? "approver" : "requester";
  if (access.workspace.duties[duty] !== access.subject)
    throw new LunaError("ROLE_REQUIRED", "Thiếu vai trò cho hành động này.");
  if (action === "approval" || action === "execute") {
    const principals = DUTIES.map((role) => access.workspace.duties[role]);
    if (principals.some((p) => !p) || new Set(principals).size !== DUTIES.length)
      throw new LunaError(
        "OWNER_COLLISION",
        "Bảy vai trò độc lập và đầy đủ vẫn chưa được xác nhận.",
      );
  }
}
