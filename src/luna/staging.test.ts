import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessStaging, summarizeStaging } from "./staging.ts";

const SECRET = "sk-notarealkey123456";
const PUBLIC = "https://staging.example.test/app";

const OWNER = {
  LUNA_STAGING_CONFIRMED: "true",
  LUNA_ENVIRONMENT_OWNER_CONFIRMED: "true",
  LUNA_CREDENTIAL_OWNER_CONFIRMED: "true",
  LUNA_BUDGET_CONFIRMED: "true",
  LUNA_SECURITY_APPROVAL: "true",
  LUNA_ROLLBACK_CONFIRMED: "true",
  LUNA_BROWSER_POLICY_CONFIRMED: "true",
  LUNA_ZALO_POLICY_CONFIRMED: "true",
  LUNA_DEPLOY_TARGET: "staging",
  LUNA_STAGING_URL: "http://127.0.0.1:8080",
  FIREBASE_LIVE_ENABLED: "false",
  LUNA_ALLOW_LIVE_MODELS: "false",
  LUNA_BROWSER_LAUNCH: "false",
};

describe("phase 8 staging readiness", () => {
  it("is NO-GO by default and names the missing owner gates", () => {
    const report = assessStaging();
    assert.equal(report.decision, "NO-GO");
    assert.equal(report.executed, false);
    assert.equal(report.networkDeploy, false);
    assert.equal(report.networkCalls, 0);
    assert.equal(report.productionDeployed, false);
    assert.equal(report.estimatedUsd, 0);
    assert.equal(report.rollback.network, false);
    for (const id of ["staging-url", "environment-owner", "credential-owner", "budget", "security-approval"]) {
      assert.equal(report.checks.find((item) => item.id === id)?.ok, false);
    }
    assert.ok(report.blockers.some((item) => item.id === "staging-url" && item.severity === "critical"));
    assert.ok(report.blockers.some((item) => item.severity === "high"));
    assert.equal(summarizeStaging(report).decision, "NO-GO");
  });

  it("rejects a public staging URL without fetching or echoing it", async () => {
    let calls = 0;
    const report = assessStaging({
      env: { ...OWNER, LUNA_STAGING_URL: PUBLIC },
      rulesDeny: true,
      artifactPresent: true,
      smokeOk: true,
      fetchImpl: async () => {
        calls += 1;
        return "called";
      },
    });
    assert.equal(calls, 0);
    assert.equal(report.decision, "NO-GO");
    assert.equal(report.networkCalls, 0);
    assert.equal(report.checks.find((item) => item.id === "staging-url")?.ok, false);
    assert.equal(report.checks.find((item) => item.id === "health")?.ok, false);
    assert.equal(JSON.stringify(report).includes(PUBLIC), false);
    assert.equal(JSON.stringify(report).includes("staging.example"), false);
  });

  it("keeps a fully acknowledged loopback rehearsal offline", () => {
    const report = assessStaging({
      env: OWNER,
      rulesDeny: true,
      artifactPresent: true,
      smokeOk: true,
    });
    assert.equal(report.decision, "NO-GO");
    assert.equal(report.mode, "dry-run");
    assert.equal(report.executed, false);
    assert.equal(report.networkDeploy, false);
    assert.equal(report.productionDeployed, false);
    assert.equal(report.rulesDeployed, false);
    assert.equal(report.blockers.some((row) => row.id === "budget"), true);
    assert.equal(report.blockers.some((row) => row.id === "environment-owner"), true);
    assert.equal(report.probes.production, "NO-GO");
  });

  it("blocks missing budget, bad schema, open rules, secrets, and production intent", () => {
    const report = assessStaging({
      env: {
        ...OWNER,
        LUNA_BUDGET_CONFIRMED: "false",
        LUNA_DEPLOY_TARGET: "production",
        LUNA_DEPLOY_PRODUCTION_OPT_IN: "true",
        LUNA_PRODUCTION_URL: "https://app.example.test",
        NINE_ROUTER_API_KEY: SECRET,
        FIREBASE_LIVE_ENABLED: "true",
      },
      rulesDeny: false,
      schemaVersion: 2,
      files: { "notes.txt": `token=${SECRET}` },
    });
    assert.equal(report.decision, "NO-GO");
    for (const id of ["budget", "schema", "firebase-rules", "credential-absent", "production-locked", "live-flags", "secret-files"]) {
      assert.equal(report.checks.find((item) => item.id === id)?.ok, false, id);
    }
    const body = JSON.stringify(report);
    assert.equal(body.includes(SECRET), false);
    assert.equal(body.includes("app.example"), false);
    assert.equal(report.rollback.mutatesProduction, false);
  });
});
