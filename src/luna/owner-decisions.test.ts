import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BROWSER_CONTRACTS } from "./browser.ts";
import {
  BUDGET_CAPS_USD,
  OWNER_DECISIONS,
  OWNER_HANDLE,
  OWNER_ROLE_NAMES,
  evaluateBrowserLaunch,
  evaluateMonthlySpend,
  evaluateZaloEoffice,
  ownerDecisionOwners,
  summarizeOwnerPolicy,
} from "./owner-decisions.ts";
import { assessOperations } from "./operations.ts";
import { evaluateGovernance, SOD_ROLES } from "./policy.ts";

describe("phase 12 owner decisions", () => {
  it("records one handle on every role and keeps separation of duties blocked", () => {
    const owners = ownerDecisionOwners();
    assert.equal(new Set(Object.values(owners)).size, 1);
    assert.equal(owners.requester, OWNER_HANDLE);
    assert.equal(owners.approver, OWNER_HANDLE);
    assert.equal(owners["environment-owner"], OWNER_HANDLE);
    assert.equal(owners["credential-owner"], OWNER_HANDLE);
    assert.equal(owners["security-reviewer"], OWNER_HANDLE);
    for (const role of SOD_ROLES) assert.equal(owners[role], OWNER_HANDLE);

    const governance = evaluateGovernance({ owners, rulesDeny: true });
    assert.equal(governance.decision, "NO-GO");
    assert.equal(governance.authorization, "not-granted");
    assert.equal(governance.fakeSignOffAccepted, false);
    assert.equal(governance.checks.find((item) => item.id === "owner-collision")?.ok, false);
    assert.equal(governance.policy, "blocked");
    assert.equal(governance.networkCalls, 0);

    const ops = assessOperations({
      owners,
      roleNames: OWNER_ROLE_NAMES,
      rulesDeny: true,
      sbom: { directDependencies: 3, lockfilePresent: true, license: "MIT" },
    });
    assert.equal(ops.decision, "NO-GO");
    assert.equal(ops.goEligible, false);
    assert.equal(ops.authorization, "not-granted");
    assert.equal(ops.checklist.find((item) => item.id === "owner-collision")?.ok, false);
    assert.equal(ops.checklist.find((item) => item.id === "budget-cap")?.ok, true);
    assert.equal(ops.checklist.find((item) => item.id === "evidence:budget")?.ok, false);
    assert.equal(ops.checklist.find((item) => item.id === "evidence:staging-environment")?.ok, false);
    assert.equal(ops.compliance.find((item) => item.id === "license")?.ok, true);
    assert.equal(ops.compliance.find((item) => item.id === "owner-separation")?.ok, false);
    assert.equal(ops.compliance.find((item) => item.id === "production-health")?.ok, false);
    assert.equal(ops.compliance.find((item) => item.id === "backup")?.ok, false);
    assert.equal(ops.roles.every((role) => role.status === "BLOCKED" && role.assignee === OWNER_HANDLE), true);
    assert.equal(ops.live.firebase, false);
    assert.equal(ops.live.nineRouter, false);
    assert.equal(ops.live.browserLaunch, false);
    assert.equal(ops.networkCalls, 0);
    assert.equal(ops.estimatedUsd, 0);
    assert.equal(ops.alertsSent, 0);

    assert.equal(OWNER_DECISIONS.separationOfDuties, "BLOCKED");
    assert.equal(OWNER_DECISIONS.budgetStatus, "caps-recorded");
    assert.equal(OWNER_DECISIONS.budgetCaps.firebase, 1);
    assert.equal(OWNER_DECISIONS.budgetCaps.nineRouter, 1);
    assert.equal(OWNER_DECISIONS.budgetCaps.browser, 1);
    assert.equal(OWNER_DECISIONS.chargedUsd, 0);
    assert.equal(OWNER_DECISIONS.stagingStatus, "owner-reported-present");
    assert.equal(OWNER_DECISIONS.stagingName, "luna-staging");
    assert.equal(OWNER_DECISIONS.stagingVerified, false);
    assert.equal(OWNER_DECISIONS.browserAutomation, "staging-only");
    assert.equal(OWNER_DECISIONS.browserProduction, "forbidden");
    assert.equal(OWNER_DECISIONS.browserLaunch, false);
    assert.equal(OWNER_DECISIONS.zaloEoffice, "simulated-readonly");
    assert.equal(OWNER_DECISIONS.license, "MIT");
    assert.equal(OWNER_DECISIONS.copyrightHolder, "Anhtran88");
    assert.equal(BROWSER_CONTRACTS.every((contract) => contract.liveLaunch === false), true);

    const policy = summarizeOwnerPolicy();
    assert.equal(policy.decision, "NO-GO");
    assert.equal(policy.budget.withinCap, true);
    assert.equal(policy.budget.chargedUsd, 0);
    assert.equal(policy.staging.verified, false);
    assert.equal(policy.staging.name, "luna-staging");
    assert.equal(policy.staging.environment, null);
    assert.equal(policy.staging.probed, false);
    assert.equal(policy.staging.deployed, false);
    assert.equal(policy.browser.launch, false);
    assert.equal(policy.browser.policyAllows, false);
    assert.equal(policy.zaloEoffice.executed, false);
    assert.equal(policy.zaloEoffice.send, "forbidden");
    assert.equal(policy.zaloEoffice.storagePath, null);
    assert.equal(policy.zaloEoffice.login, false);

    const recorded = JSON.parse(readFileSync("config/readiness/owner-decisions.json", "utf8")) as {
      ownerCollision: boolean;
      separationOfDuties: string;
      budget: { caps: Array<{ service: string; monthlyCap: number; currency: string }> };
      staging: { name: string; status: string; verified: boolean; environment: null };
      browserPolicy: { launch: boolean; realAutomation: string; production: string };
      zaloEofficePolicy: {
        authorization: string;
        zalo: { send: string };
        eoffice: { edit: string; submit: string };
        attachments: {
          storagePath: null;
          namingRule: string;
          storageRoot: string;
          stored: boolean;
        };
        executed: boolean;
        login: boolean;
      };
    };
    assert.equal(recorded.ownerCollision, true);
    assert.equal(recorded.separationOfDuties, "BLOCKED");
    assert.deepEqual(
      recorded.budget.caps.map((row) => [row.service, row.monthlyCap, row.currency]),
      [
        ["firebase", 1, "USD"],
        ["nineRouter", 1, "USD"],
        ["browser", 1, "USD"],
      ],
    );
    assert.equal(recorded.staging.status, "owner-reported-present");
    assert.equal(recorded.staging.name, "luna-staging");
    assert.equal(recorded.staging.verified, false);
    assert.equal(recorded.staging.environment, null);
    assert.equal(recorded.browserPolicy.realAutomation, "staging-only");
    assert.equal(recorded.browserPolicy.production, "forbidden");
    assert.equal(recorded.browserPolicy.launch, false);
    assert.equal(recorded.zaloEofficePolicy.authorization, "simulated-readonly");
    assert.equal(recorded.zaloEofficePolicy.zalo.send, "forbidden");
    assert.equal(recorded.zaloEofficePolicy.eoffice.edit, "forbidden");
    assert.equal(recorded.zaloEofficePolicy.eoffice.submit, "forbidden");
    assert.equal(recorded.zaloEofficePolicy.attachments.namingRule, "P.GIAO_[VATTU]_[dd.mm.yyyy]_[DUAN].pdf");
    assert.equal(recorded.zaloEofficePolicy.attachments.storageRoot, "unset");
    assert.equal(recorded.zaloEofficePolicy.attachments.storagePath, null);
    assert.equal(recorded.zaloEofficePolicy.attachments.stored, false);
    assert.equal(recorded.zaloEofficePolicy.executed, false);
    assert.equal(recorded.zaloEofficePolicy.login, false);
    const license = readFileSync("LICENSE", "utf8");
    assert.match(license, /MIT License/);
    assert.match(license, /Copyright \(c\) 2026 Anhtran88/);
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { license?: string };
    assert.equal(pkg.license, "MIT");
    assert.equal(JSON.stringify(recorded).includes("https://"), false);
  });

  it("rejects spend above the monthly cap and charges nothing", () => {
    assert.equal(BUDGET_CAPS_USD.firebase, 1);
    assert.equal(evaluateMonthlySpend("firebase", 0).ok, true);
    assert.equal(evaluateMonthlySpend("firebase", 1).ok, true);
    assert.equal(evaluateMonthlySpend("firebase", 1.01).reason, "over-cap");
    assert.equal(evaluateMonthlySpend("nineRouter", 1).ok, true);
    assert.equal(evaluateMonthlySpend("nineRouter", 1.01).ok, false);
    assert.equal(evaluateMonthlySpend("browser", 1).decision, "within-cap");
    assert.equal(evaluateMonthlySpend("browser", 2).reason, "over-cap");
    for (const rejected of [
      evaluateMonthlySpend("firebase", -1),
      evaluateMonthlySpend("nineRouter", Number.NaN),
      evaluateMonthlySpend("browser", Number.POSITIVE_INFINITY),
      evaluateMonthlySpend("other", 0),
      evaluateMonthlySpend("firebase", 0, "EUR"),
    ]) {
      assert.equal(rejected.ok, false);
      assert.equal(rejected.decision, "rejected");
      assert.equal(rejected.chargedUsd, 0);
      assert.equal(rejected.networkCalls, 0);
      assert.equal(rejected.liveEnabled, false);
    }

    let calls = 0;
    const over = assessOperations({
      proposedSpend: { firebase: 1.01, nineRouter: 2, browser: 1 },
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve();
      },
    });
    assert.equal(calls, 0);
    assert.equal(over.decision, "NO-GO");
    assert.equal(over.goEligible, false);
    assert.equal(over.checklist.find((item) => item.id === "budget-cap")?.ok, false);
    assert.equal(over.estimatedUsd, 0);
    assert.equal(over.networkCalls, 0);
    assert.equal(over.alertsSent, 0);
    assert.equal(over.live.firebase, false);
    assert.equal(over.live.nineRouter, false);
    assert.equal(over.live.browserLaunch, false);
    assert.equal(over.productionDeployed, false);
  });

  it("keeps browser launch off and locks Zalo until a real scope exists", () => {
    const held = evaluateBrowserLaunch();
    assert.equal(held.launch, false);
    assert.equal(held.policyAllows, false);
    assert.equal(held.executed, false);
    assert.ok(held.unmet.includes("staging-only"));
    assert.ok(held.unmet.includes("owner-collision"));

    const production = evaluateBrowserLaunch({
      target: "production",
      stagingVerified: true,
      evidenceValid: true,
      ownerCollision: false,
      approvalGatesPassed: true,
    });
    assert.equal(production.policyAllows, false);
    assert.equal(production.launch, false);
    assert.ok(production.unmet.includes("production-forbidden"));

    const readyButNotLaunched = evaluateBrowserLaunch({
      target: "staging",
      stagingVerified: true,
      evidenceValid: true,
      ownerCollision: false,
      approvalGatesPassed: true,
    });
    assert.equal(readyButNotLaunched.policyAllows, true);
    assert.equal(readyButNotLaunched.launch, false);
    assert.equal(readyButNotLaunched.executed, false);
    assert.equal(readyButNotLaunched.networkCalls, 0);

    const missingOne = evaluateBrowserLaunch({
      target: "staging",
      stagingVerified: true,
      evidenceValid: true,
      ownerCollision: true,
      approvalGatesPassed: true,
    });
    assert.equal(missingOne.policyAllows, false);
    assert.equal(missingOne.launch, false);

    const zalo = evaluateZaloEoffice({ scope: "https://secret.example/token=abc", action: "login" });
    assert.equal(zalo.authorization, "simulated-readonly");
    assert.equal(zalo.send, "forbidden");
    assert.equal(zalo.edit, "forbidden");
    assert.equal(zalo.submit, "forbidden");
    assert.equal(zalo.locked, true);
    assert.equal(zalo.executed, false);
    assert.equal(zalo.login, false);
    assert.equal(zalo.networkCalls, 0);
    assert.equal(zalo.storagePath, null);
    const body = JSON.stringify(zalo);
    assert.equal(body.includes("secret.example"), false);
    assert.equal(body.includes("token"), false);
  });
});
