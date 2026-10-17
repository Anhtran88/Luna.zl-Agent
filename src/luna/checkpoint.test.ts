import { test } from "node:test";
import assert from "node:assert/strict";
import { LunaControlPlane } from "./control-plane.ts";

test("checkpoint restores full state and rejects schema, live mode, linked-approval and plan corruption", async () => {
  const plane = LunaControlPlane.createDefault({});
  const created = await plane.createTask({ goal: "Ghi Firebase bằng mô phỏng." });
  const planned = await plane.planTask(created.id);
  const state = plane.exportCheckpoint();
  const restored = LunaControlPlane.restoreCheckpoint(state);
  assert.deepEqual(restored.exportCheckpoint(), state);
  state.tasks[0].title = "changed copy";
  assert.notEqual(restored.exportCheckpoint().tasks[0].title, "changed copy");
  const unknown = { ...plane.exportCheckpoint(), version: 2 };
  assert.throws(() => LunaControlPlane.restoreCheckpoint(unknown), { code: "MIGRATION" });
  const live = plane.exportCheckpoint();
  live.tasks[0].mode = "live";
  assert.throws(() => LunaControlPlane.restoreCheckpoint(live), { code: "VALIDATION" });
  const missing = plane.exportCheckpoint();
  missing.approvals = [];
  assert.throws(() => LunaControlPlane.restoreCheckpoint(missing), { code: "VALIDATION" });
  const forged = plane.exportCheckpoint();
  forged.tasks[0].plan!.steps.find((step) => step.requiresApproval)!.requiresApproval = false;
  assert.throws(() => LunaControlPlane.restoreCheckpoint(forged), { code: "VALIDATION" });
  const mismatch = plane.exportCheckpoint();
  mismatch.tasks[0].status = "approved";
  assert.throws(() => LunaControlPlane.restoreCheckpoint(mismatch), { code: "VALIDATION" });
  await restored.decideApproval(planned.approvalId!, "approved");
  await restored.execute(created.id);
  assert.equal(
    LunaControlPlane.restoreCheckpoint(restored.exportCheckpoint()).snapshot().runs.length,
    1,
  );
});
