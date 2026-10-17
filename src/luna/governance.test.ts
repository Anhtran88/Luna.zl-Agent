import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EVIDENCE_FIELDS, evaluateGovernance, SOD_ROLES, summarizeGovernance } from "./policy.ts";

const SECRET = "sk-notarealkey123456";
const PUBLIC = "https://govern.example.test/app";

const OWNERS = Object.fromEntries(SOD_ROLES.map((role) => [role, `handle-${role}`]));
const EVIDENCE = Object.fromEntries(EVIDENCE_FIELDS.map((field) => [field, `record-${field}`]));
const FAKE_ENV = {
  LUNA_STAGING_CONFIRMED: "true",
  LUNA_BUDGET_CONFIRMED: "true",
  LUNA_SECURITY_APPROVAL: "true",
  LUNA_LEGAL_PRIVACY_CONFIRMED: "true",
  LUNA_CREDENTIAL_OWNER_CONFIRMED: "true",
};

describe("phase 11 governance", () => {
  it("rejects normalized claim flags and private references even with otherwise complete records", () => {
    for (const claim of ["yes", " TRUE ", "ok", "confirmed"]) {
      const report = evaluateGovernance({ env: { LUNA_BUDGET_CONFIRMED: claim }, owners: OWNERS, evidence: EVIDENCE, rulesDeny: true });
      assert.equal(report.policy, "blocked");
      assert.equal(report.checks.find((row) => row.id === "fake-sign-off")?.ok, false);
      assert.equal(report.decision, "NO-GO");
    }
    const privatePath = "/Users/SYNTHETIC_FIXTURE/OneDrive/approval";
    const report = evaluateGovernance({ owners: { ...OWNERS, approver: privatePath }, evidence: { ...EVIDENCE, budget: privatePath }, rulesDeny: true });
    assert.equal(report.checks.find((row) => row.id === "owner:approver")?.ok, false);
    assert.equal(report.checks.find((row) => row.id === "evidence:budget")?.ok, false);
    assert.equal(JSON.stringify(report).includes(privatePath), false);
  });
  it("blocks an empty request and does not invent one shared owner", () => {
    const report = evaluateGovernance();
    assert.equal(report.decision, "NO-GO");
    assert.equal(report.authorization, "not-granted");
    assert.equal(report.policy, "blocked");
    assert.equal(report.fakeSignOffAccepted, false);
    assert.equal(report.executed, false);
    assert.equal(report.networkCalls, 0);
    assert.equal(report.productionDeployed, false);
    assert.equal(report.estimatedUsd, 0);
    assert.equal(report.live.browserLaunch, false);
    for (const role of SOD_ROLES) {
      assert.equal(report.checks.find((item) => item.id === `owner:${role}`)?.ok, false, role);
    }
    assert.equal(report.checks.find((item) => item.id === "evidence:budget")?.ok, false);
    assert.equal(report.checks.find((item) => item.id === "owner-collision")?.ok, true);
    assert.equal(report.audit.find((item) => item.action === "deploy.production")?.outcome, "blocked");
    assert.equal(report.audit.every((item) => item.dryRun && item.network === false), true);
    assert.equal(summarizeGovernance(report).decision, "NO-GO");
  });

  it("rejects fake confirmation flags even when every other field is present", async () => {
    let calls = 0;
    const report = evaluateGovernance({
      env: { ...FAKE_ENV, LUNA_PRODUCTION_URL: PUBLIC, FIREBASE_LIVE_ENABLED: "true", LUNA_BROWSER_LAUNCH: "true" },
      owners: OWNERS,
      evidence: EVIDENCE,
      rulesDeny: true,
      fetchImpl: async () => {
        calls += 1;
        return "called";
      },
    });
    assert.equal(calls, 0);
    assert.equal(report.policy, "blocked");
    assert.equal(report.fakeSignOffAccepted, false);
    assert.equal(report.live.firebase, false);
    assert.equal(report.checks.find((item) => item.id === "fake-sign-off")?.ok, false);
    assert.equal(report.checks.find((item) => item.id === "public-endpoint")?.ok, false);
    assert.equal(report.checks.find((item) => item.id === "live-flags")?.ok, false);
    assert.equal(report.audit.find((item) => item.action === "live.bypass")?.outcome, "blocked");
    const body = JSON.stringify(report);
    assert.equal(body.includes(PUBLIC), false);
    assert.equal(body.includes("govern.example"), false);
  });

  it("blocks owner collision, missing budget, open rules, and secret handles without echoing them", () => {
    const collided = Object.fromEntries(SOD_ROLES.map((role) => [role, "same-operator"]));
    const report = evaluateGovernance({
      action: "staging",
      owners: { ...collided, "credential-owner": SECRET },
      evidence: { ...EVIDENCE, budget: "true", "legal-privacy": `token=${SECRET}` },
      rulesDeny: false,
      env: { LUNA_DEPLOY_TARGET: "production", LUNA_DEPLOY_PRODUCTION_OPT_IN: "true" },
    });
    assert.equal(report.decision, "NO-GO");
    assert.equal(report.checks.find((item) => item.id === "owner-collision")?.ok, false);
    assert.equal(report.checks.find((item) => item.id === "evidence:budget")?.ok, false);
    assert.equal(report.checks.find((item) => item.id === "firebase-rules")?.ok, false);
    assert.equal(report.checks.find((item) => item.id === "live-flags")?.ok, false);
    assert.equal(report.checks.find((item) => item.id === "owner:credential-owner")?.ok, false);
    assert.equal(JSON.stringify(report).includes(SECRET), false);
    assert.equal(report.audit.find((item) => item.action === "deploy.staging")?.outcome, "blocked");
  });

  it("records complete local evidence and still grants nothing", () => {
    const report = evaluateGovernance({
      owners: OWNERS,
      evidence: EVIDENCE,
      rulesDeny: true,
      sbom: { directDependencies: 3, lockfilePresent: true },
    });
    assert.equal(report.policy, "recorded");
    assert.equal(report.decision, "NO-GO");
    assert.equal(report.authorization, "not-granted");
    assert.equal(report.executed, false);
    assert.equal(report.networkCalls, 0);
    assert.equal(report.productionDeployed, false);
    assert.equal(report.findings.find((item) => item.id === "license")?.ok, false);
    assert.equal(report.audit.find((item) => item.action === "deploy.production")?.outcome, "blocked");
    assert.equal(report.audit.find((item) => item.action === "dry-run.record")?.outcome, "recorded");
  });

  it("documents RACI and keeps the governance doc from authorizing deploy", () => {
    const text = readFileSync("docs/GOVERNANCE.md", "utf8");
    assert.match(text, /RACI/);
    assert.match(text, /NO-GO/);
    assert.match(text, /không chấp nhận cờ/);
    assert.equal(text.includes(SECRET), false);
  });
});
