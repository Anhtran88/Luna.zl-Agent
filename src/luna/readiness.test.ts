import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessReadiness, COST_CONTROLS, DATA_SAFETY, summarizeReadiness } from "./readiness.ts";
import {
  IdempotencyStore,
  LocalCircuitBreaker,
  LocalLog,
  LocalProcess,
  backupJson,
  correlationId,
  localProbes,
  offlineRetry,
  restoreJson,
  runOfflineSteps,
} from "./reliability.ts";

const SECRET = "sk-notarealkey123456";

describe("phase 7 production readiness", () => {
  it("stays NO-GO with a perfect local score and lists missing owner gates", () => {
    const report = assessReadiness();
    assert.equal(report.decision, "NO-GO");
    assert.equal(report.technicalScore, 100);
    assert.equal(report.productionDeployed, false);
    assert.equal(report.network, false);
    assert.equal(report.telemetry, false);
    assert.equal(report.estimatedUsd, 0);
    assert.ok(report.ownerMissing.includes("staging-environment"));
    assert.ok(report.ownerMissing.includes("credential-owner"));
    assert.ok(report.ownerMissing.includes("budget"));
    assert.ok(report.ownerMissing.includes("zalo-eoffice-policy"));
    assert.ok(report.risks.some((risk) => risk.severity === "critical" && risk.status === "open"));
    assert.equal(summarizeReadiness(report).decision, "NO-GO");
    assert.equal(JSON.stringify(report).includes(SECRET), false);
  });

  it("does not turn claimed owner flags into a production go", () => {
    const report = assessReadiness({
      env: {
        LUNA_STAGING_CONFIRMED: "true",
        LUNA_CREDENTIAL_OWNER_CONFIRMED: "true",
        LUNA_BUDGET_CONFIRMED: "true",
        LUNA_SECURITY_APPROVAL: "true",
        LUNA_ROLLBACK_CONFIRMED: "true",
        LUNA_BROWSER_POLICY_CONFIRMED: "true",
        LUNA_ZALO_POLICY_CONFIRMED: "true",
        FIREBASE_LIVE_ENABLED: "true",
        LUNA_ALLOW_LIVE_MODELS: "true",
        LUNA_BROWSER_LAUNCH: "true",
        LUNA_DEPLOY_PRODUCTION_OPT_IN: "true",
      },
    });
    assert.equal(report.decision, "NO-GO");
    assert.equal(report.productionDeployed, false);
    assert.equal(report.network, false);
    assert.equal(report.ownerMissing.length, 0);
    assert.ok(report.checks.some((item) => item.id === "firebase-live" && item.status === "gap"));
    assert.ok(report.technicalScore < 100);
    assert.ok(report.risks.every((risk) => risk.status === "open"));
  });

  it("keeps data, cost, probes and logs local", () => {
    assert.equal(DATA_SAFETY.realDataAccess, false);
    assert.equal(DATA_SAFETY.schemaVersion, 1);
    assert.ok(COST_CONTROLS.every((item) => item.enabled === false && item.estimatedUsd === 0));
    const probes = localProbes();
    assert.equal(probes.production, "NO-GO");
    assert.equal(probes.network, false);
    const log = new LocalLog();
    const event = log.write("error", `boom ${SECRET}`, correlationId(1));
    assert.equal(event.correlationId, "corr_1");
    assert.equal(event.telemetry, false);
    assert.equal(event.message.includes(SECRET), false);
  });

  it("covers timeout, retry, idempotency, partial failure, circuit and shutdown", () => {
    const retry = offlineRetry({ failuresBeforeSuccess: 2, maxRetries: 1 });
    assert.equal(retry.outcome, "timeout");
    assert.equal(retry.network, false);
    assert.equal(retry.estimatedUsd, 0);
    const ok = offlineRetry({ failuresBeforeSuccess: 1, maxRetries: 1 });
    assert.equal(ok.outcome, "ok");
    assert.equal(ok.attempts, 2);

    const keys = new IdempotencyStore();
    assert.equal(keys.begin("task_1"), "started");
    keys.complete("task_1", "done");
    assert.equal(keys.begin("task_1"), "replay");
    assert.equal(keys.result("task_1"), "done");
    assert.equal(keys.network, false);

    const partial = runOfflineSteps([
      { id: "plan" },
      { id: "write", fail: true },
    ]);
    assert.equal(partial.rolledBack, true);
    assert.deepEqual(partial.applied, []);
    assert.equal(partial.failed, "write");
    assert.equal(partial.network, false);

    let now = 0;
    const circuit = new LocalCircuitBreaker(2, 100, () => now);
    assert.equal(circuit.allow(), true);
    circuit.recordFailure();
    circuit.recordFailure();
    assert.equal(circuit.allow(), false);
    assert.equal(circuit.snapshot().network, false);
    now = 100;
    assert.equal(circuit.allow(), true);
    circuit.recordSuccess();
    assert.equal(circuit.snapshot().state, "closed");

    const process = new LocalProcess();
    assert.equal(process.accept(), true);
    const stopped = process.shutdown();
    assert.equal(stopped.network, false);
    assert.equal(process.accept(), false);
  });

  it("backs up only secret-free JSON and restores the copy", () => {
    const backup = backupJson({ schemaVersion: 1, note: "local" });
    assert.equal(backup.ok, true);
    if (backup.ok) assert.deepEqual(restoreJson(backup), { schemaVersion: 1, note: "local" });
    const refused = backupJson({ token: SECRET });
    assert.equal(refused.ok, false);
    assert.equal(JSON.stringify(refused).includes(SECRET), false);
    assert.throws(() => restoreJson(refused), /Không có bản sao/);
  });
});
