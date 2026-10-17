import { test } from "node:test";
import assert from "node:assert/strict";
import { LunaControlPlane } from "./control-plane.ts";
import { fixedClock, sequenceIds } from "./domain.ts";
import { MemoryLunaStore } from "./store.ts";
import { createModelRouter } from "./models.ts";
import { loadNineRouterPublicConfig } from "./config.ts";
import type { AgentTask } from "./domain.ts";

const makePlane = (store = new MemoryLunaStore()) =>
  LunaControlPlane.createDefault({}, { clock: fixedClock(), ids: sequenceIds(), store });

test("concurrent execute admits one run and terminal replay admits none", async () => {
  const plane = LunaControlPlane.createDefault({}, { clock: fixedClock(), ids: sequenceIds() });
  const task = await plane.createTask({ goal: "Tóm tắt bằng model mock." });
  await plane.planTask(task.id);
  const results = await Promise.allSettled([plane.execute(task.id), plane.execute(task.id)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(plane.snapshot().runs.length, 1);
  await assert.rejects(() => plane.execute(task.id));
  assert.equal(plane.snapshot().runs.length, 1);
});

test("duplicate approval and stale opposite decision do not duplicate audit or change the first decision", async () => {
  const plane = makePlane();
  const task = await plane.createTask({ goal: "Ghi Firebase bằng mô phỏng." });
  const planned = await plane.planTask(task.id);
  assert.ok(planned.approvalId);
  const results = await Promise.allSettled([
    plane.decideApproval(planned.approvalId, "approved"),
    plane.decideApproval(planned.approvalId, "rejected"),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  await assert.rejects(() => plane.decideApproval(planned.approvalId!, "approved"), {
    code: "BAD_STATUS",
  });
  assert.equal(plane.snapshot().approvals[0].status, "approved");
  assert.equal(plane.snapshot().audit.filter((e) => e.action.startsWith("approval.")).length, 1);
});

test("held execution excludes cancellation and second execution without timing sleeps", async () => {
  const models = createModelRouter(loadNineRouterPublicConfig({}));
  const complete = models.complete.bind(models);
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  models.complete = async (request) => {
    entered();
    await paused;
    return complete(request);
  };
  const plane = LunaControlPlane.createDefault(
    {},
    { clock: fixedClock(), ids: sequenceIds(), models },
  );
  const task = await plane.createTask({ goal: "Tóm tắt bằng model mock." });
  await plane.planTask(task.id);
  const running = plane.execute(task.id);
  await started;
  try {
    await assert.rejects(() => plane.cancel(task.id), { code: "BUSY" });
    await assert.rejects(() => plane.execute(task.id), { code: "BUSY" });
  } finally {
    release();
  }
  await running;
  assert.equal(plane.snapshot().tasks[0].status, "dry_run_completed");
  assert.equal(plane.snapshot().runs.length, 1);
});

test("snapshot and command results cannot mutate internal task or nested plan", async () => {
  const plane = makePlane();
  const task = await plane.createTask({ goal: "Ghi Firebase bằng mô phỏng." });
  const planned = await plane.planTask(task.id);
  const snapshot = plane.snapshot();
  planned.status = "approved";
  planned.plan!.steps.length = 0;
  snapshot.tasks[0].status = "dry_run_completed";
  snapshot.approvals[0].status = "approved";
  snapshot.audit[0].action = "forged";
  assert.equal(plane.snapshot().tasks[0].status, "awaiting_approval");
  assert.ok(plane.snapshot().tasks[0].plan!.steps.length > 0);
  assert.equal(plane.snapshot().approvals[0].status, "pending");
  assert.notEqual(plane.snapshot().audit[0].action, "forged");
});

test("memory persistence detaches writes/reads and a new plane does not silently reauthorize stored tasks", async () => {
  const store = new MemoryLunaStore();
  const plane = makePlane(store);
  const task = await plane.createTask({ goal: "Tóm tắt bằng model mock." });
  const writeInput = structuredClone(task);
  await store.saveTask(writeInput);
  writeInput.status = "approved";
  assert.equal((await store.readTask(task.id))!.status, "draft");
  const saved = await store.readTask(task.id);
  assert.ok(saved);
  saved.status = "approved";
  task.title = "tampered";
  assert.equal((await store.readTask(task.id))!.status, "draft");
  assert.notEqual((await store.readTask(task.id))!.title, "tampered");
  const fresh = makePlane(store);
  assert.equal(fresh.snapshot().tasks.length, 0);
  await assert.rejects(() => fresh.execute(task.id), { code: "NOT_FOUND" });
  assert.equal((await store.readTask(task.id))!.status, "draft");
});

test("ambiguous persistence failure blocks automatic retry instead of reporting completed task", async () => {
  class FailingStore extends MemoryLunaStore {
    override async saveTask(task: AgentTask): Promise<void> {
      if (task.status === "dry_run_completed") throw new Error("synthetic write failure");
      return super.saveTask(task);
    }
  }
  const plane = makePlane(new FailingStore());
  const task = await plane.createTask({ goal: "Tóm tắt bằng model mock." });
  await plane.planTask(task.id);
  await assert.rejects(() => plane.execute(task.id), /synthetic write failure/);
  assert.equal(plane.snapshot().tasks[0].status, "blocked");
  await assert.rejects(() => plane.execute(task.id), { code: "RECOVERY_REQUIRED" });
  assert.equal(plane.snapshot().runs.length, 1);
});
