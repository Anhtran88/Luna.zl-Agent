import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LunaControlPlane } from "./control-plane.ts";
import { LUNAZL_FIREBASE_DATABASE_URL, loadNineRouterPublicConfig } from "./config.ts";
import { LunaError, fixedClock, sequenceIds } from "./domain.ts";
import { createInProcessEmulatorClient, InProcessRtdbTransport } from "./firebase-emulator.ts";
import { FirebaseRtdbClient } from "./firebase-rtdb.ts";
import { MemoryRealtimeDatabase } from "./firebase.ts";
import { runControlledFlow } from "./flow.ts";
import { ModelAttemptError, ModelRouter } from "./models.ts";
import { TASK_PRESETS } from "./presets.ts";
import { SCHEMA_VERSION, STORE_PATHS, wrapRecord } from "./schema.ts";
import { FirebaseLunaStore } from "./store.ts";

function plane() {
  return LunaControlPlane.createDefault(
    {},
    { clock: fixedClock(), ids: sequenceIds() },
  );
}

describe("phase 3 controlled flow", () => {
  it("completes a safe task through plan, dry-run, audit, and a terminal run", async () => {
    const current = plane();
    const result = await runControlledFlow(current, { goal: TASK_PRESETS[0].goal });
    assert.equal(result.terminal, true);
    assert.equal(result.status, "dry_run_completed");
    assert.equal(result.dryRun, true);
    assert.equal(result.approvalStatus, "none");
    assert.equal(result.runStatus, "completed");
    assert.ok(result.auditCount >= 2);
    const snapshot = current.snapshot();
    assert.equal(snapshot.release, "12-operations");
    assert.equal(snapshot.governance.decision, "NO-GO");
    assert.equal(snapshot.governance.authorization, "not-granted");
    assert.equal(snapshot.governance.fakeSignOffAccepted, false);
    assert.equal(snapshot.governance.networkCalls, 0);
    assert.equal(snapshot.operations.decision, "NO-GO");
    assert.equal(snapshot.operations.authorization, "not-granted");
    assert.equal(snapshot.operations.goEligible, false);
    assert.equal(snapshot.operations.networkCalls, 0);
    const moduleIds = snapshot.modules.map((module) => module.id);
    assert.equal(new Set(moduleIds).size, moduleIds.length);
    assert.ok(moduleIds.includes("policy"));
    assert.ok(moduleIds.includes("governance"));
    assert.ok(moduleIds.includes("operations"));
    assert.equal(snapshot.validation.scope, "simulated");
    assert.equal(snapshot.validation.productionValidated, false);
    assert.equal(snapshot.validation.productionDeployed, false);
    assert.equal(snapshot.validation.networkCalls, 0);
    assert.equal(snapshot.production.decision, "NO-GO");
    assert.equal(snapshot.production.signOffComplete, false);
    assert.equal(snapshot.production.networkDeploy, false);
    assert.equal(snapshot.production.productionDeployed, false);
    assert.equal(snapshot.readiness.decision, "NO-GO");
    assert.equal(snapshot.staging.decision, "NO-GO");
    assert.equal(snapshot.staging.networkDeploy, false);
    assert.equal(snapshot.staging.productionDeployed, false);
    assert.equal(snapshot.readiness.productionDeployed, false);
    assert.equal(snapshot.readiness.network, false);
    assert.equal(snapshot.security.phaseLock, true);
    assert.equal(snapshot.security.liveEnabled, false);
    assert.equal(snapshot.deployment.mode, "dry-run");
    assert.equal(snapshot.deployment.productionDeployed, false);
    assert.equal(snapshot.deployment.network, false);
    assert.equal(snapshot.phaseLock, true);
    assert.equal(snapshot.adapters.models.liveEnabled, false);
    assert.ok(snapshot.audit.every((event) => event.dryRun === true));
    assert.equal(snapshot.runs[0]?.dryRun, true);
  });

  it("stops for approval, then rejects or cancels without an external effect", async () => {
    const rejected = plane();
    const denial = await runControlledFlow(rejected, {
      goal: TASK_PRESETS[3].goal,
      decision: "rejected",
    });
    assert.equal(denial.status, "rejected");
    assert.equal(denial.terminal, true);
    assert.equal(denial.runStatus, null);

    const waiting = plane();
    const held = await runControlledFlow(waiting, { goal: TASK_PRESETS[3].goal });
    assert.equal(held.status, "awaiting_approval");
    assert.equal(held.terminal, false);

    const cancelled = plane();
    const stop = await runControlledFlow(cancelled, {
      goal: TASK_PRESETS[3].goal,
      decision: "cancel",
    });
    assert.equal(stop.status, "cancelled");
    assert.equal(stop.terminal, true);
    assert.equal(stop.runStatus, null);
  });

  it("approves a sensitive task and still refuses the external step", async () => {
    const current = plane();
    const result = await runControlledFlow(current, {
      goal: TASK_PRESETS[3].goal,
      decision: "approved",
    });
    assert.equal(result.status, "dry_run_completed");
    assert.equal(result.approvalStatus, "approved");
    assert.equal(result.runStatus, "completed");
    const task = current.snapshot().tasks.find((item) => item.id === result.taskId);
    const external = task?.lastReport?.steps.find((step) => step.kind === "external_mutate");
    assert.equal(external?.outcome, "refused");
  });

  it("rejects an invalid goal before any task is stored", async () => {
    const current = plane();
    await assert.rejects(
      () => current.createTask({ goal: "ab" }),
      (error: unknown) => error instanceof LunaError && error.code === "VALIDATION",
    );
    assert.equal(current.snapshot().tasks.length, 0);
    assert.equal(current.snapshot().audit.length, 0);
  });

  it("keeps mock timeout retries local and unpaid", async () => {
    let fetches = 0;
    const router = new ModelRouter(
      loadNineRouterPublicConfig({ LUNA_MODEL_MAX_RETRIES: "2", LUNA_ALLOW_LIVE_MODELS: "true" }),
      async () => {
        fetches += 1;
        throw new Error("network should not be used");
      },
    );
    await assert.rejects(
      () =>
        router.complete({
          model: "luna-fast",
          messages: [{ role: "user", content: "timeout" }],
          mockFault: "timeout",
        }),
      (error: unknown) =>
        error instanceof ModelAttemptError &&
        error.code === "TIMEOUT" &&
        error.attempts === 3 &&
        error.network === false &&
        error.estimatedCostUsd === 0,
    );
    await assert.rejects(
      () =>
        router.complete({
          model: "luna-fast",
          messages: [{ role: "user", content: "down" }],
          mockFault: "unavailable",
        }),
      (error: unknown) => error instanceof ModelAttemptError && error.code === "UNAVAILABLE",
    );
    assert.equal(fetches, 0);
  });

  it("reads schema v1 and rejects an unknown version", async () => {
    const db = new MemoryRealtimeDatabase();
    const store = new FirebaseLunaStore(db);
    await db.set(
      STORE_PATHS.task("task_1"),
      wrapRecord("task", {
        id: "task_1",
        title: "Cũ",
        goal: "Tóm tắt bằng model mock.",
        sensitivity: "safe",
        mode: "dry-run",
        status: "draft",
        createdAt: "2026-10-15T09:00:00.000Z",
      }),
    );
    const stored = await store.readTask("task_1");
    assert.equal(stored?.id, "task_1");
    const raw = await db.get(STORE_PATHS.task("task_1"));
    await db.set(STORE_PATHS.task("task_1"), { ...(raw as object), schemaVersion: 99 });
    await assert.rejects(
      () => store.readTask("task_1"),
      (error: unknown) => error instanceof LunaError && error.code === "MIGRATION",
    );
    assert.equal(SCHEMA_VERSION, 1);
  });

  it("uses an in-process emulator transport and leaves the app on memory", async () => {
    const emulator = createInProcessEmulatorClient();
    await emulator.set("/luna/v1/settings", { schemaVersion: 1, kind: "settings" });
    assert.deepEqual(await emulator.get("/luna/v1/settings"), {
      schemaVersion: 1,
      kind: "settings",
    });

    const blocked = new FirebaseRtdbClient({
      databaseUrl: LUNAZL_FIREBASE_DATABASE_URL,
      authToken: "not-a-secret",
      transport: new InProcessRtdbTransport(),
    });
    await assert.rejects(
      () => blocked.get("/luna/v1/settings"),
      (error: unknown) => error instanceof LunaError && error.code === "NETWORK",
    );

    const current = LunaControlPlane.createDefault({
      LUNA_FIREBASE_EMULATOR: "true",
      FIREBASE_LIVE_ENABLED: "false",
      FIREBASE_DATABASE_URL: LUNAZL_FIREBASE_DATABASE_URL,
      FIREBASE_PROJECT_ID: "lunazl-agent",
    });
    const snapshot = current.snapshot();
    assert.equal(snapshot.adapters.firebase.mode, "memory");
    assert.equal(snapshot.adapters.firebase.liveEnabled, false);
    assert.equal(snapshot.adapters.firebase.emulatorRequested, true);
    assert.equal(snapshot.storeMode, "memory");
  });
});
