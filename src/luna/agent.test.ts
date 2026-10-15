import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPlan, executePlan } from "./agent.ts";
import { decideExecution } from "./governance.ts";
import { fixedClock, sequenceIds, type AgentTask } from "./domain.ts";
import { TASK_PRESETS } from "./presets.ts";

const deps = () => ({ ids: sequenceIds(), clock: fixedClock() });

describe("planner and gate", () => {
  it("plans safe presets without a sensitive step", () => {
    for (const preset of TASK_PRESETS.filter((item) => item.id !== "zalo")) {
      const plan = createPlan(preset.goal, deps());
      assert.equal(
        plan.steps.some((step) => step.sensitivity === "sensitive"),
        false,
        preset.id,
      );
    }
  });

  it("plans the Zalo preset as sensitive and approval-gated", () => {
    const plan = createPlan(TASK_PRESETS[3].goal, deps());
    assert.deepEqual(
      plan.steps.map((step) => step.kind),
      ["analyze", "browser", "external_mutate"],
    );
    assert.equal(plan.steps.at(-1)?.requiresApproval, true);
  });

  it("does not treat a negated login phrase as an external action", () => {
    const plan = createPlan("Mô phỏng trình duyệt, không đăng nhập.", deps());
    assert.equal(
      plan.steps.some((step) => step.kind === "external_mutate"),
      false,
    );
  });

  it("refuses live execution even when an approval exists", () => {
    const plan = createPlan("Tóm tắt bằng model mock.", deps());
    const task: AgentTask = {
      id: "task_live",
      title: "Live",
      goal: "Tóm tắt bằng model mock.",
      sensitivity: "safe",
      mode: "live",
      status: "approved",
      createdAt: "2026-10-15T09:00:00.000Z",
      plan,
    };
    const gate = decideExecution({
      task,
      approval: {
        id: "approval_1",
        taskId: task.id,
        reason: "n/a",
        status: "approved",
        requestedAt: task.createdAt,
      },
    });
    assert.equal(gate.ok, false);
    if (!gate.ok) assert.equal(gate.code, "PHASE_LOCK");
  });

  it("executor itself rejects live mode before adapters", async () => {
    const task: AgentTask = {
      id: "task_live",
      title: "Live",
      goal: "Đăng nhập Zalo",
      sensitivity: "sensitive",
      mode: "live",
      status: "approved",
      createdAt: "2026-10-15T09:00:00.000Z",
      plan: createPlan("Đăng nhập Zalo", deps()),
    };
    await assert.rejects(
      () =>
        executePlan(task, {
          clock: fixedClock(),
          models: {
            complete: () => Promise.reject(new Error("model")),
            resolve: () => ({}),
            listModels: () => Promise.resolve([]),
          } as never,
          browser: { run: () => Promise.reject(new Error("browser")) } as never,
          firebase: { get: () => Promise.reject(new Error("firebase")) } as never,
        }),
      /PHASE_LOCK|live/,
    );
  });
});
