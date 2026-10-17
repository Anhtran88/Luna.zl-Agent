/** Blank owner pack. No names, secrets, URLs, or confirmation flags. */
import { isOpaqueReference } from "./security.ts";

export const ROLE_PACK = [
  { id: "requester", sod: "requester" },
  { id: "approver", sod: "approver" },
  { id: "staging-owner", sod: "environment-owner" },
  { id: "credential-owner", sod: "credential-owner" },
  { id: "security-reviewer", sod: "security-reviewer" },
  { id: "rollback-owner", sod: "rollback-owner" },
  { id: "incident-owner", sod: "incident-owner" },
] as const;

export const EVIDENCE_SCOPES = {
  "staging-environment": "staging",
  budget: "budget",
  "security-approval": "security",
  "legal-privacy": "legal",
  "browser-policy": "browser",
  "zalo-eoffice-policy": "zalo-eoffice",
  artifact: "artifact",
  migration: "migration",
  backup: "backup",
  health: "health",
  alerting: "alerting",
} as const;

export type EvidenceFieldId = keyof typeof EVIDENCE_SCOPES;
export type RoleSlotStatus = "BLOCKED" | "RECORDED";

export interface RoleSlot {
  id: (typeof ROLE_PACK)[number]["id"];
  sodRole: (typeof ROLE_PACK)[number]["sod"];
  assignee: string | null;
  status: RoleSlotStatus;
}

export interface BlankEvidenceRecord {
  field: EvidenceFieldId;
  evidence_id: null;
  source_type: null;
  created_at: null;
  expires_at: null;
  sha256: null;
  scope: (typeof EVIDENCE_SCOPES)[EvidenceFieldId];
  approval_reference: null;
  status: "BLOCKED";
}

const OWNER_NOTE =
  "Mẫu trống. Điền ngoài repository. Không commit bản đã điền. Không ghi secret, token, cookie, private key, credential hay URL. Cờ xác nhận không phải sign-off. Decision giữ NO-GO.";

export function roleBoard(
  roleOk: (sodRole: string) => boolean,
  collisionOk: boolean,
  names?: Partial<Record<(typeof ROLE_PACK)[number]["id"], string>>,
): RoleSlot[] {
  return ROLE_PACK.map((role) => ({
    id: role.id,
    sodRole: role.sod,
    assignee: isOpaqueReference(names?.[role.id]) ? names![role.id]!.trim() : null,
    status: collisionOk && roleOk(role.sod) && (names?.[role.id] === undefined || isOpaqueReference(names[role.id])) ? "RECORDED" : "BLOCKED",
  }));
}

export function blankEvidence(fields: readonly EvidenceFieldId[]): BlankEvidenceRecord[] {
  return fields.map((field) => ({
    field,
    evidence_id: null,
    source_type: null,
    created_at: null,
    expires_at: null,
    sha256: null,
    scope: EVIDENCE_SCOPES[field],
    approval_reference: null,
    status: "BLOCKED" as const,
  }));
}

export function blankRoleAssignment() {
  return {
    decision: "NO-GO" as const,
    authorization: "not-granted" as const,
    note: OWNER_NOTE,
    roles: ROLE_PACK.map((role) => ({
      id: role.id,
      assignee: null,
      status: "BLOCKED" as const,
    })),
  };
}

export function blankEvidenceTemplate(fields: readonly EvidenceFieldId[]) {
  return {
    decision: "NO-GO" as const,
    authorization: "not-granted" as const,
    note: OWNER_NOTE,
    records: blankEvidence(fields),
  };
}

export const ALL_EVIDENCE_FIELDS = Object.keys(EVIDENCE_SCOPES) as EvidenceFieldId[];
