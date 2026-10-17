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

export const BUDGET_SERVICES = ["firebase", "nineRouter", "browser"] as const;
export type BudgetService = (typeof BUDGET_SERVICES)[number];

/** Monthly maximums in USD. A proposal above the cap is rejected. These are caps, not spend. */
export const BUDGET_CAPS_USD = {
  firebase: 1,
  nineRouter: 1,
  browser: 1,
} as const;

export const OWNER_DECISIONS = {
  decision: "NO-GO",
  authorization: "not-granted",
  separationOfDuties: "BLOCKED",
  ownerCollision: true,
  license: "MIT",
  copyrightHolder: "Anhtran88",
  budgetStatus: "caps-recorded",
  budgetCurrency: "USD",
  budgetCaps: BUDGET_CAPS_USD,
  chargedUsd: 0,
  stagingStatus: "owner-reported-present",
  stagingName: "luna-staging",
  stagingVerified: false,
  browserAutomation: "staging-only",
  browserProduction: "forbidden",
  browserLaunch: false,
  zaloEoffice: "simulated-readonly",
} as const;

export interface SpendDecision {
  service: BudgetService | "rejected";
  decision: "within-cap" | "rejected";
  ok: boolean;
  capUsd: number | null;
  proposedUsd: number | null;
  chargedUsd: 0;
  networkCalls: 0;
  liveEnabled: false;
  reason: "within-cap" | "over-cap" | "invalid-amount" | "unknown-service" | "non-usd";
}

export interface BrowserLaunchDecision {
  policy: "staging-only";
  production: "forbidden";
  target: "local" | "staging" | "production";
  policyAllows: boolean;
  launch: false;
  executed: false;
  networkCalls: 0;
  unmet: string[];
}

export interface ZaloDecision {
  authorization: "simulated-readonly";
  zalo: "read-only-designated-bi-groups";
  send: "forbidden";
  eoffice: "BM03.2-read-compare";
  edit: "forbidden";
  submit: "forbidden";
  executed: false;
  locked: true;
  login: false;
  networkCalls: 0;
  storagePath: null;
  reason: "live-locked";
}

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

function isBudgetService(service: string): service is BudgetService {
  return (BUDGET_SERVICES as readonly string[]).includes(service);
}

/** Fail closed. A proposal above the monthly cap is rejected and nothing is charged or called. */
export function evaluateMonthlySpend(service: string, proposedUsd: number, currency = "USD"): SpendDecision {
  const fixed = { chargedUsd: 0 as const, networkCalls: 0 as const, liveEnabled: false as const };
  const finite = typeof proposedUsd === "number" && Number.isFinite(proposedUsd) ? proposedUsd : null;
  if (currency !== "USD") {
    return { ...fixed, service: "rejected", decision: "rejected", ok: false, capUsd: null, proposedUsd: finite, reason: "non-usd" };
  }
  if (!isBudgetService(service)) {
    return { ...fixed, service: "rejected", decision: "rejected", ok: false, capUsd: null, proposedUsd: finite, reason: "unknown-service" };
  }
  const capUsd = BUDGET_CAPS_USD[service];
  if (finite === null || finite < 0) {
    return { ...fixed, service, decision: "rejected", ok: false, capUsd, proposedUsd: null, reason: "invalid-amount" };
  }
  if (finite > capUsd) {
    return { ...fixed, service, decision: "rejected", ok: false, capUsd, proposedUsd: finite, reason: "over-cap" };
  }
  return { ...fixed, service, decision: "within-cap", ok: true, capUsd, proposedUsd: finite, reason: "within-cap" };
}

export function evaluateBrowserLaunch(input: {
  target?: "local" | "staging" | "production";
  stagingVerified?: boolean;
  evidenceValid?: boolean;
  ownerCollision?: boolean;
  approvalGatesPassed?: boolean;
} = {}): BrowserLaunchDecision {
  const target = input.target ?? "local";
  const unmet: string[] = [];
  if (target !== "staging") unmet.push("staging-only");
  if (target === "production") unmet.push("production-forbidden");
  if (input.stagingVerified !== true) unmet.push("staging-unverified");
  if (input.evidenceValid !== true) unmet.push("browser-evidence-missing");
  if (input.ownerCollision !== false) unmet.push("owner-collision");
  if (input.approvalGatesPassed !== true) unmet.push("approval-gates");
  const policyAllows = target === "staging" && unmet.length === 0;
  return {
    policy: "staging-only",
    production: "forbidden",
    target,
    policyAllows,
    launch: false,
    executed: false,
    networkCalls: 0,
    unmet: policyAllows ? [] : unmet,
  };
}

/** Live Zalo and eOffice stay locked. Caller-supplied scope or action is ignored and not echoed. */
export function evaluateZaloEoffice(_input: { scope?: string | null; action?: string | null } = {}): ZaloDecision {
  return {
    authorization: "simulated-readonly",
    zalo: "read-only-designated-bi-groups",
    send: "forbidden",
    eoffice: "BM03.2-read-compare",
    edit: "forbidden",
    submit: "forbidden",
    executed: false,
    locked: true,
    login: false,
    networkCalls: 0,
    storagePath: null,
    reason: "live-locked",
  };
}

export function summarizeOwnerPolicy() {
  const proposedUsd = { firebase: 0, nineRouter: 0, browser: 0 } as const;
  const spend = BUDGET_SERVICES.map((service) => evaluateMonthlySpend(service, proposedUsd[service]));
  const browser = evaluateBrowserLaunch({
    target: "staging",
    stagingVerified: false,
    evidenceValid: false,
    ownerCollision: true,
    approvalGatesPassed: false,
  });
  return {
    decision: OWNER_DECISIONS.decision,
    authorization: OWNER_DECISIONS.authorization,
    separationOfDuties: OWNER_DECISIONS.separationOfDuties,
    ownerCollision: OWNER_DECISIONS.ownerCollision,
    budget: {
      status: OWNER_DECISIONS.budgetStatus,
      currency: OWNER_DECISIONS.budgetCurrency,
      capsUsd: BUDGET_CAPS_USD,
      proposedUsd,
      withinCap: spend.every((row) => row.ok),
      chargedUsd: 0 as const,
      overCap: "rejected" as const,
      liveEnabled: false as const,
    },
    staging: {
      name: OWNER_DECISIONS.stagingName,
      status: OWNER_DECISIONS.stagingStatus,
      verified: false as const,
      environment: null,
      independentStagingOwner: false as const,
      probed: false as const,
      deployed: false as const,
      networkCalls: 0 as const,
    },
    browser: {
      policy: browser.policy,
      production: browser.production,
      policyAllows: browser.policyAllows,
      launch: false as const,
      executed: false as const,
      networkCalls: 0 as const,
      monthlyCapUsd: BUDGET_CAPS_USD.browser,
    },
    zaloEoffice: evaluateZaloEoffice(),
    copyrightHolder: OWNER_DECISIONS.copyrightHolder,
  };
}
