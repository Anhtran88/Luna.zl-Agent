import type { SodRole } from "./policy.ts";

/** Owner-supplied handle. The same value on every role is a collision, not separation of duties. */
export const OWNER_HANDLE = "kenbi";

export const OWNER_ROLE_NAMES = {
  requester: OWNER_HANDLE,
  approver: OWNER_HANDLE,
  "staging-owner": OWNER_HANDLE,
  "credential-owner": OWNER_HANDLE,
  "security-reviewer": OWNER_HANDLE,
  "rollback-owner": OWNER_HANDLE,
  "incident-owner": OWNER_HANDLE,
} as const;

export const OWNER_DECISIONS = {
  decision: "NO-GO",
  authorization: "not-granted",
  separationOfDuties: "BLOCKED",
  ownerCollision: true,
  license: "MIT",
  copyrightHolder: "Anhtran88",
  budgetStatus: "unapproved",
  budgetPreference: "cost-saving",
  budgetCaps: { firebase: null, nineRouter: null, browser: null },
  stagingStatus: "absent",
  browserAutomation: "forbidden",
  zaloEoffice: "forbidden",
} as const;

export function ownerDecisionOwners(): Record<SodRole, string> {
  return {
    requester: OWNER_HANDLE,
    approver: OWNER_HANDLE,
    "environment-owner": OWNER_HANDLE,
    "credential-owner": OWNER_HANDLE,
    "security-reviewer": OWNER_HANDLE,
    "rollback-owner": OWNER_HANDLE,
    "incident-owner": OWNER_HANDLE,
  };
}
