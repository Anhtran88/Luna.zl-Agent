import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LunaControlPlane } from "./control-plane.ts";
import { loadFirebasePublicConfig } from "./config.ts";
import { LunaError, PhaseLockedError, fixedClock, sequenceIds } from "./domain.ts";
import { MemoryRealtimeDatabase, PhaseLockedFirebaseAdapter, createRealtimeDatabase } from "./firebase.ts";
import { STORE_PATHS, wrapRecord } from "./schema.ts";
import { FirebaseLunaStore } from "./store.ts";
import { TASK_PRESETS } from "./presets.ts";

describe("persistence store", () => {
  it("round-trips a dry-run through the firebase port without leaving the process", async () => {
    const db = new MemoryRealtimeDatabase(undefined, sequenceIds());
    const store = new FirebaseLunaStore(db);
    const plane = LunaControlPlane.createDefault(
      {},
      { clock: fixedClock(), ids: sequenceIds(), firebase: db, store },
    );
    const task = await plane.createTask({ goal: TASK_PRESETS[0].goal });
    await plane.planTask(task.id);
    const done = await plane.execute(task.id);
    const stored = await store.readTask(done.id);
    assert.equal(stored?.status, "dry_run_completed");
    const settings = await db.get(STORE_PATHS.settings);
    assert.equal(
      settings && typeof settings === "object" && "schemaVersion" in settings
        ? settings.schemaVersion
        : null,
      1,
    );
    const runPath = STORE_PATHS.run("run_1");
    const run = await db.get(runPath);
    assert.equal(run && typeof run === "object" && "kind" in run ? run.kind : null, "run");
  });

  it("fails closed when the firebase port is locked", async () => {
    const store = new FirebaseLunaStore(new PhaseLockedFirebaseAdapter());
    await assert.rejects(() => store.ensureSettings("2026-10-15T09:00:00.000Z"), PhaseLockedError);
  });

  it("rejects a stored document from an unknown schema version", async () => {
    const db = new MemoryRealtimeDatabase();
    await db.set(
      STORE_PATHS.task("task_old"),
      wrapRecord("task", {
        id: "task_old",
        title: "Cũ",
        goal: "Tóm tắt bằng model mock.",
        sensitivity: "safe",
        mode: "dry-run",
        status: "draft",
        createdAt: "2026-10-15T09:00:00.000Z",
      }),
    );
    const raw = await db.get(STORE_PATHS.task("task_old"));
    if (!raw || typeof raw !== "object") throw new Error("missing");
    await db.set(STORE_PATHS.task("task_old"), { ...raw, schemaVersion: 2 });
    const store = new FirebaseLunaStore(db);
    await assert.rejects(
      () => store.readTask("task_old"),
      (error: unknown) => error instanceof LunaError && error.code === "MIGRATION",
    );
  });

  it("does not construct a live client from public config alone", () => {
    const config = loadFirebasePublicConfig({
      FIREBASE_DATABASE_URL: "https://luna-dev.firebasedatabase.app",
      FIREBASE_SERVICE_ACCOUNT_JSON: "{\"type\":\"service_account\"}",
      LUNA_FIREBASE_LIVE: "true",
    });
    const db = createRealtimeDatabase(config);
    assert.equal(db.mode, "disabled-live");
    assert.equal(db.id, "firebase-phase-locked");
  });
});
