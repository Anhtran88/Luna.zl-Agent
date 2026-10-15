import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LunaError, fixedClock, sequenceIds } from "./domain.ts";
import {
  SCHEMA_VERSION,
  defaultSettings,
  parseAuditRecord,
  parseSettings,
  parseTaskRecord,
  schemaCompatible,
  wrapRecord,
} from "./schema.ts";

describe("schema v1", () => {
  it("accepts a v1 task and rejects v0 and v2", () => {
    const ids = sequenceIds();
    const task = wrapRecord("task", {
      id: ids.next("task"),
      title: "Nháp",
      goal: "Tóm tắt bằng model mock.",
      sensitivity: "safe",
      mode: "dry-run",
      status: "draft",
      createdAt: fixedClock().now(),
    });
    assert.equal(parseTaskRecord(task).id, "task_1");
    assert.equal(schemaCompatible(SCHEMA_VERSION), true);
    assert.throws(
      () => parseTaskRecord({ schemaVersion: 0, kind: "task", record: {} }),
      (error: unknown) => error instanceof LunaError && error.code === "MIGRATION",
    );
    assert.throws(
      () => parseTaskRecord({ schemaVersion: 2, kind: "task", record: {} }),
      (error: unknown) => error instanceof LunaError && error.code === "MIGRATION",
    );
  });

  it("rejects settings that try to turn the phase lock off", () => {
    const settings = defaultSettings("2026-10-15T09:00:00.000Z");
    assert.equal(parseSettings(settings).phaseLock, true);
    assert.equal(parseSettings(settings).firebaseLive, false);
    assert.throws(
      () =>
        parseSettings({
          schemaVersion: 1,
          kind: "settings",
          record: { ...settings.record, phaseLock: false },
        }),
      (error: unknown) => error instanceof LunaError && error.code === "VALIDATION",
    );
  });

  it("rejects an audit event that is not a dry-run", () => {
    assert.throws(
      () =>
        parseAuditRecord({
          schemaVersion: 1,
          kind: "audit",
          record: {
            id: "audit_1",
            at: "2026-10-15T09:00:00.000Z",
            actor: "system",
            action: "task.execute",
            outcome: "recorded",
            detail: "nope",
            dryRun: false,
          },
        }),
      (error: unknown) => error instanceof LunaError && error.code === "VALIDATION",
    );
  });
});
