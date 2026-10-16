import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BROWSER_CONTRACTS } from "./browser.ts";
import { OWNER_DECISIONS, OWNER_HANDLE, OWNER_ROLE_NAMES, ownerDecisionOwners } from "./owner-decisions.ts";
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
    assert.equal(ops.checklist.find((item) => item.id === "evidence:budget")?.ok, false);
    assert.equal(ops.checklist.find((item) => item.id === "evidence:staging-environment")?.ok, false);
    assert.equal(ops.compliance.find((item) => item.id === "license")?.ok, true);
    assert.equal(ops.compliance.find((item) => item.id === "owner-separation")?.ok, false);
    assert.equal(ops.compliance.find((item) => item.id === "production-health")?.ok, false);
    assert.equal(ops.compliance.find((item) => item.id === "backup")?.ok, false);
    assert.equal(ops.roles.every((role) => role.status === "BLOCKED" && role.assignee === OWNER_HANDLE), true);
    assert.equal(ops.live.browserLaunch, false);
    assert.equal(ops.networkCalls, 0);
    assert.equal(ops.estimatedUsd, 0);

    assert.equal(OWNER_DECISIONS.separationOfDuties, "BLOCKED");
    assert.equal(OWNER_DECISIONS.budgetStatus, "unapproved");
    assert.equal(OWNER_DECISIONS.budgetCaps.firebase, null);
    assert.equal(OWNER_DECISIONS.budgetCaps.nineRouter, null);
    assert.equal(OWNER_DECISIONS.budgetCaps.browser, null);
    assert.equal(OWNER_DECISIONS.stagingStatus, "absent");
    assert.equal(OWNER_DECISIONS.browserAutomation, "forbidden");
    assert.equal(OWNER_DECISIONS.zaloEoffice, "forbidden");
    assert.equal(OWNER_DECISIONS.license, "MIT");
    assert.equal(BROWSER_CONTRACTS.every((contract) => contract.liveLaunch === false), true);

    const recorded = JSON.parse(readFileSync("config/readiness/owner-decisions.json", "utf8")) as {
      ownerCollision: boolean;
      separationOfDuties: string;
      budget: { caps: Array<{ monthlyCap: null }> };
      staging: { environment: null };
      browserPolicy: { launch: boolean; realAutomation: string };
      zaloEofficePolicy: { actions: string };
    };
    assert.equal(recorded.ownerCollision, true);
    assert.equal(recorded.separationOfDuties, "BLOCKED");
    assert.equal(recorded.budget.caps.every((row) => row.monthlyCap === null), true);
    assert.equal(recorded.staging.environment, null);
    assert.equal(recorded.browserPolicy.realAutomation, "forbidden");
    assert.equal(recorded.browserPolicy.launch, false);
    assert.equal(recorded.zaloEofficePolicy.actions, "forbidden");
    const license = readFileSync("LICENSE", "utf8");
    assert.match(license, /MIT License/);
    assert.match(license, /Copyright \(c\) 2026 Anhtran88/);
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { license?: string };
    assert.equal(pkg.license, "MIT");
  });
});
