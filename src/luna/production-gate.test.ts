import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessProduction, CHANGE_RECORD, summarizeProduction } from "./production-gate.ts";

const SECRET = "sk-notarealkey123456";
const PUBLIC = "https://prod.example.test/app";

const CLAIMS = {
  LUNA_STAGING_CONFIRMED: "true",
  LUNA_ENVIRONMENT_OWNER_CONFIRMED: "true",
  LUNA_CREDENTIAL_OWNER_CONFIRMED: "true",
  LUNA_BUDGET_CONFIRMED: "true",
  LUNA_SECURITY_APPROVAL: "true",
  LUNA_ROLLBACK_CONFIRMED: "true",
  LUNA_INCIDENT_OWNER_CONFIRMED: "true",
  LUNA_BROWSER_POLICY_CONFIRMED: "true",
  LUNA_ZALO_POLICY_CONFIRMED: "true",
  LUNA_LEGAL_PRIVACY_CONFIRMED: "true",
  LUNA_STAGING_URL: "http://127.0.0.1:8080",
  LUNA_DEPLOY_TARGET: "local",
};

const LOCAL_EVIDENCE = {
  rulesDeny: true,
  schemaVersion: 1,
  artifact: { sha256: "a".repeat(64), expectedSha256: "a".repeat(64) },
  sbom: { directDependencies: 10, lockfilePresent: true },
  backup: { restoreDrill: true },
};

describe("phase 9 production gate", () => {
  it("is NO-GO by default and lists missing owners without inventing them", () => {
    const report = assessProduction();
    assert.equal(report.decision, "NO-GO");
    assert.equal(report.authorization, "not-granted");
    assert.equal(report.signOffComplete, false);
    assert.equal(report.executed, false);
    assert.equal(report.networkCalls, 0);
    assert.equal(report.productionDeployed, false);
    assert.equal(report.estimatedUsd, 0);
    assert.equal(report.live.firebase, false);
    assert.equal(report.live.nineRouter, false);
    assert.equal(report.live.browserLaunch, false);
    for (const id of ["staging-confirmed", "credential-owner", "budget", "security-approval", "rollback-owner", "incident-owner", "legal-privacy"]) {
      assert.equal(report.signOff.find((row) => row.id === id)?.status, "missing", id);
      assert.equal(report.signOff.find((row) => row.id === id)?.authorizesDeploy, false);
    }
    assert.ok(report.blockers.some((item) => item.severity === "critical"));
    assert.ok(report.blockers.some((item) => item.severity === "high"));
    assert.equal(summarizeProduction(report).decision, "NO-GO");
    assert.equal(CHANGE_RECORD.decision, "NO-GO");
  });

  it("stays NO-GO when every claim and local check is present", () => {
    let calls = 0;
    const report = assessProduction({
      env: CLAIMS,
      ...LOCAL_EVIDENCE,
      fetchImpl: async () => {
        calls += 1;
        return "called";
      },
    });
    assert.equal(calls, 0);
    assert.equal(report.decision, "NO-GO");
    assert.equal(report.authorization, "not-granted");
    assert.equal(report.signOffComplete, false);
    assert.equal(report.checks.find((row) => row.id === "budget")?.ok, false);
    assert.equal(report.networkDeploy, false);
    assert.equal(report.productionDeployed, false);
    assert.equal(report.rulesDeployed, false);
    assert.ok(report.blockers.some((item) => item.id === "production-health"));
    assert.ok(report.blockers.some((item) => item.id === "production-alerting"));
    assert.ok(report.signOff.every((row) => row.status === "claimed" && row.authorizesDeploy === false));
  });

  it("never treats matching blank or malformed hashes as artifact proof", () => {
    for (const hash of ["", "abc", "z".repeat(64)]) {
      const report = assessProduction({ artifact: { sha256: hash, expectedSha256: hash } });
      assert.equal(report.checks.find((row) => row.id === "artifact")?.ok, false);
      assert.equal(report.signOffComplete, false);
      assert.equal(report.decision, "NO-GO");
    }
  });

  it("blocks live bypass, bad schema, artifact mismatch, secrets, and public endpoints", () => {
    let calls = 0;
    const report = assessProduction({
      env: {
        ...CLAIMS,
        LUNA_STAGING_URL: PUBLIC,
        LUNA_PRODUCTION_URL: "https://deploy.example.test",
        LUNA_DEPLOY_TARGET: "production",
        LUNA_DEPLOY_PRODUCTION_OPT_IN: "true",
        FIREBASE_LIVE_ENABLED: "true",
        LUNA_ALLOW_LIVE_MODELS: "true",
        LUNA_BROWSER_LAUNCH: "true",
        NINE_ROUTER_API_KEY: SECRET,
        LUNA_BUDGET_CONFIRMED: "false",
      },
      rulesDeny: false,
      schemaVersion: 2,
      artifact: { sha256: "one", expectedSha256: "two" },
      files: { "notes.txt": `token=${SECRET}` },
      fetchImpl: async () => {
        calls += 1;
        return "called";
      },
    });
    assert.equal(calls, 0);
    assert.equal(report.decision, "NO-GO");
    assert.equal(report.live.firebase, false);
    assert.equal(report.estimatedUsd, 0);
    for (const id of ["budget", "schema", "artifact", "firebase-rules", "live-flags", "production-locked", "credential-absent", "secret-files", "staging-url"]) {
      assert.equal(report.checks.find((item) => item.id === id)?.ok, false, id);
    }
    const body = JSON.stringify(report);
    assert.equal(body.includes(SECRET), false);
    assert.equal(body.includes("prod.example"), false);
    assert.equal(body.includes("deploy.example"), false);
    assert.equal(body.includes("one"), false);
    assert.equal(report.rollback.network, false);
  });

  it("keeps the release docs from authorizing a deploy", () => {
    const release = readFileSync("docs/RELEASE.md", "utf8");
    const incident = readFileSync("docs/INCIDENT.md", "utf8");
    const rollback = readFileSync("docs/ROLLBACK.md", "utf8");
    for (const text of [release, incident, rollback]) {
      assert.match(text, /NO-GO/);
      assert.equal(text.includes(SECRET), false);
    }
    assert.match(release, /Sign-off/);
    assert.match(incident, /không gọi mạng/);
    assert.match(rollback, /local-no-op/);
  });
});
