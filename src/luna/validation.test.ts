import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rehearseRollback, simulateValidation, summarizeValidation } from "./validation.ts";

const SECRET = "sk-notarealkey123456";
const PUBLIC = "https://validate.example.test/app";

describe("phase 10 simulated validation", () => {
  it("runs a local simulation and does not claim production validation", () => {
    const report = simulateValidation();
    assert.equal(report.result, "simulated-only");
    assert.equal(report.scope, "simulated");
    assert.equal(report.productionValidated, false);
    assert.equal(report.productionDeployed, false);
    assert.equal(report.stagingValidated, false);
    assert.equal(report.productionDecision, "NO-GO");
    assert.equal(report.networkCalls, 0);
    assert.equal(report.alertsSent, 0);
    assert.equal(report.telemetry, false);
    assert.equal(report.estimatedUsd, 0);
    assert.equal(report.live.firebase, false);
    assert.equal(report.live.nineRouter, false);
    assert.equal(report.live.browserLaunch, false);
    for (const id of ["healthy", "degraded", "timeout", "partial-failure", "dependency-unavailable", "schema-mismatch", "artifact-mismatch", "rollback-triggered"]) {
      const row = report.scenarios.find((item) => item.id === id);
      assert.equal(row?.contained, true, id);
      assert.equal(row?.production, false, id);
      assert.equal(row?.network, false, id);
    }
    assert.equal(report.scenarios.find((item) => item.id === "healthy")?.status, "healthy-local");
    assert.equal(report.scenarios.find((item) => item.id === "timeout")?.status, "timeout");
    assert.equal(report.scenarios.find((item) => item.id === "partial-failure")?.status, "rolled-back");
    assert.equal(report.scenarios.find((item) => item.id === "schema-mismatch")?.status, "incompatible");
    assert.equal(report.scenarios.find((item) => item.id === "artifact-mismatch")?.status, "mismatch");
    assert.equal(report.scenarios.find((item) => item.id === "alerting")?.status, "not-sent");
    assert.equal(report.acceptance.find((item) => item.id === "production-validation")?.met, false);
    assert.ok(report.unverified.includes("production-deployment"));
    assert.ok(report.unverified.includes("real-user-data"));
    assert.equal(summarizeValidation(report).productionValidated, false);
    assert.equal(JSON.stringify(report).includes("productionValidated\":true"), false);
  });

  it("refuses staging and production targets without fetching or echoing a URL", async () => {
    let calls = 0;
    const report = simulateValidation({
      target: "production",
      env: { LUNA_PRODUCTION_URL: PUBLIC, LUNA_VALIDATION_TARGET: "production" },
      fetchImpl: async () => {
        calls += 1;
        return "called";
      },
    });
    assert.equal(calls, 0);
    assert.equal(report.result, "refused");
    assert.equal(report.scope, "refused");
    assert.equal(report.scenarios.length, 0);
    assert.equal(report.rollback, null);
    assert.equal(report.productionValidated, false);
    assert.equal(report.productionDeployed, false);
    assert.equal(report.networkCalls, 0);
    const body = JSON.stringify(report);
    assert.equal(body.includes(PUBLIC), false);
    assert.equal(body.includes("validate.example"), false);
  });

  it("contains rollback, redaction, schema, artifact, and live bypass inside the process", () => {
    let calls = 0;
    const report = simulateValidation({
      secretText: SECRET,
      schemaVersion: 2,
      artifactMatch: false,
      env: {
        FIREBASE_LIVE_ENABLED: "true",
        LUNA_ALLOW_LIVE_MODELS: "true",
        LUNA_BROWSER_LAUNCH: "true",
        LUNA_STAGING_URL: PUBLIC,
      },
      fetchImpl: async () => {
        calls += 1;
        return "called";
      },
    });
    assert.equal(calls, 0);
    assert.equal(report.live.firebase, false);
    assert.equal(report.scenarios.find((item) => item.id === "live-bypass")?.status, "refused");
    assert.equal(report.scenarios.find((item) => item.id === "secret-config-missing")?.status, "redacted");
    assert.equal(report.acceptance.find((item) => item.id === "redaction")?.met, true);
    assert.equal(report.rollback?.dataSafety, "copied");
    assert.equal(report.rollback?.appliedToProcess, false);
    assert.equal(report.rollback?.idempotent, "replay");
    assert.equal(report.rollback?.shutdown.accepting, false);
    assert.equal(report.rollback?.auditRedacted, true);
    assert.equal(report.rollback?.correlationId, "corr_10");
    const body = JSON.stringify(report);
    assert.equal(body.includes(SECRET), false);
    assert.equal(body.includes("validate.example"), false);

    const refused = rehearseRollback({ payload: { token: SECRET }, secretText: SECRET });
    assert.equal(refused.dataSafety, "refused");
    assert.equal(refused.network, false);
    assert.equal(JSON.stringify(refused).includes(SECRET), false);
  });

  it("keeps the validation doc from calling the simulation a production deploy", () => {
    const text = readFileSync("docs/VALIDATION.md", "utf8");
    assert.match(text, /simulated-only/);
    assert.match(text, /NO-GO/);
    assert.equal(text.includes("productionValidated: true"), false);
    assert.equal(text.includes(SECRET), false);
  });
});
