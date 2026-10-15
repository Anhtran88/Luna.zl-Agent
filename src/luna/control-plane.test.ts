import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LunaControlPlane } from "./control-plane.ts";
import { LunaError, PhaseLockedError, fixedClock, sequenceIds } from "./domain.ts";
import { MemoryRealtimeDatabase } from "./firebase.ts";
import { createBrowserOrchestrator } from "./browser.ts";
import { createModelRouter } from "./models.ts";
import { loadNineRouterPublicConfig } from "./config.ts";
import { TASK_PRESETS } from "./presets.ts";

function planeWith(
  firebase = new MemoryRealtimeDatabase(
    { "/luna/queue": { items: [], phase: "2-foundations" } },
    sequenceIds(),
  ),
) {
  return {
    firebase,
    plane: LunaControlPlane.createDefault(
      {},
      {
        clock: fixedClock(),
        ids: sequenceIds(),
        firebase,
        models: createModelRouter(loadNineRouterPublicConfig({})),
        browser: createBrowserOrchestrator(),
      },
    ),
  };
}

describe("control plane mock flow", () => {
  it("dry-runs a safe model task without approval", async () => {
    const { plane } = planeWith();
    const task = await plane.createTask({ goal: TASK_PRESETS[0].goal });
    await plane.planTask(task.id);
    const done = await plane.execute(task.id);
    assert.equal(done.status, "dry_run_completed");
    assert.match(
      done.lastReport?.steps.find((step) => step.kind === "model")?.summary ?? "",
      /không gọi mạng/,
    );
    const snapshot = plane.snapshot();
    assert.equal(snapshot.phaseLock, true);
    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.storeMode, "memory");
    assert.equal(snapshot.adapters.models.estimatedCostUsd, 0);
    assert.equal(snapshot.adapters.models.activeProvider, "mock");
    assert.equal(snapshot.adapters.models.liveEnabled, false);
    assert.ok(snapshot.audit.every((event) => event.dryRun === true));
  });

  it("requires approval for Zalo and still refuses the external action", async () => {
    const { plane, firebase } = planeWith();
    const task = await plane.createTask({ goal: TASK_PRESETS[3].goal });
    const planned = await plane.planTask(task.id);
    assert.equal(planned.status, "awaiting_approval");
    await assert.rejects(
      () => plane.execute(task.id),
      (error: unknown) => {
        return error instanceof LunaError && error.code === "APPROVAL_REQUIRED";
      },
    );

    const approvalId = planned.approvalId;
    assert.ok(approvalId);
    await plane.decideApproval(approvalId, "approved", "Chỉ dry-run.");
    const done = await plane.execute(task.id);
    assert.equal(done.status, "dry_run_completed");
    const external = done.lastReport?.steps.find((step) => step.kind === "external_mutate");
    assert.equal(external?.outcome, "refused");
    assert.match(external?.summary ?? "", /không gửi tin/);
    assert.equal(await firebase.get("/luna/outbox"), null);
    assert.deepEqual(await firebase.get("/luna/queue"), { items: [], phase: "2-foundations" });
  });

  it("blocks a live task even after approval", async () => {
    const { plane } = planeWith();
    const task = await plane.createTask({ goal: "Tóm tắt bằng model mock.", mode: "live" });
    await plane.planTask(task.id);
    await assert.rejects(
      () => plane.execute(task.id),
      (error: unknown) => {
        return error instanceof LunaError && error.code === "PHASE_LOCK";
      },
    );
    assert.equal(plane.snapshot().tasks[0]?.status, "blocked");
    assert.equal(plane.snapshot().audit[0]?.outcome, "refused");
    assert.equal(plane.snapshot().audit[0]?.dryRun, true);
  });

  it("refuses to execute or cancel a finished task", async () => {
    const { plane } = planeWith();
    const task = await plane.createTask({ goal: TASK_PRESETS[0].goal });
    await plane.cancel(task.id);
    await assert.rejects(
      () => plane.execute(task.id),
      (error: unknown) => error instanceof LunaError && error.code === "TERMINAL",
    );
    await assert.rejects(
      () => plane.cancel(task.id),
      (error: unknown) => error instanceof LunaError && error.code === "TERMINAL",
    );
    assert.equal(plane.snapshot().tasks[0]?.status, "cancelled");
    assert.ok(plane.snapshot().audit.every((event) => event.dryRun === true));
  });

  it("keeps approval notes short and refuses a second decision", async () => {
    const { plane } = planeWith();
    const task = await plane.createTask({ goal: TASK_PRESETS[3].goal });
    const planned = await plane.planTask(task.id);
    const approvalId = planned.approvalId;
    assert.ok(approvalId);
    const approval = await plane.decideApproval(approvalId, "rejected", ` ${"x".repeat(400)} `);
    assert.equal(approval.note?.length, 280);
    assert.equal(plane.snapshot().tasks[0]?.status, "rejected");
    await assert.rejects(
      () => plane.decideApproval(approvalId, "approved"),
      (error: unknown) => error instanceof LunaError && error.code === "BAD_STATUS",
    );
  });

  it("firebase read preset stays on the memory queue", async () => {
    const { plane } = planeWith();
    const task = await plane.createTask({ goal: TASK_PRESETS[1].goal });
    await plane.planTask(task.id);
    const done = await plane.execute(task.id);
    const read = done.lastReport?.steps.find((step) => step.kind === "firebase_read");
    assert.match(read?.summary ?? "", /\/luna\/queue/);
    assert.equal(
      done.lastReport?.steps.some((step) => step.kind === "firebase_write"),
      false,
    );
  });

  it("a phase-locked firebase adapter refuses the read step without throwing out", async () => {
    const locked = {
      id: "locked",
      mode: "disabled-live" as const,
      get: () => Promise.reject(new PhaseLockedError("locked")),
      set: () => Promise.reject(new PhaseLockedError("locked")),
      push: () => Promise.reject(new PhaseLockedError("locked")),
      update: () => Promise.reject(new PhaseLockedError("locked")),
      remove: () => Promise.reject(new PhaseLockedError("locked")),
      listen: () => {
        throw new PhaseLockedError("locked");
      },
    };
    const plane = LunaControlPlane.createDefault(
      { LUNA_FIREBASE_LIVE: "true" },
      { clock: fixedClock(), ids: sequenceIds(), firebase: locked },
    );
    const task = await plane.createTask({ goal: TASK_PRESETS[1].goal });
    await plane.planTask(task.id);
    const done = await plane.execute(task.id);
    assert.equal(
      done.lastReport?.steps.find((step) => step.kind === "firebase_read")?.outcome,
      "refused",
    );
  });
});
