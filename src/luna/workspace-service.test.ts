import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { DUTIES, bindAccess, type WorkspacePolicy, type VerifiedAccess } from "./access-policy.ts";
import { SqlWorkspaceStore, type TransactionPort, type QueryPort } from "./atomic-store.ts";
import { WorkspaceService } from "./workspace-service.ts";
import { spawnSync } from "node:child_process";

const migration = await readFile(
  new URL("../../migrations/luna/0001_atomic_workspaces.sql", import.meta.url),
  "utf8",
);
function access(role = "requester", id = "fixture-workspace"): VerifiedAccess {
  const workspace: WorkspacePolicy = {
    id,
    duties: Object.fromEntries(
      DUTIES.map((duty) => [duty, `better-auth:${id}-${duty}`]),
    ) as WorkspacePolicy["duties"],
  };
  return bindAccess(`better-auth:${id}-${role}`, {
    policy: { version: 1, workspaces: [workspace] },
    expiresAt: Date.now() + 60000,
  });
}
function port(db: PGlite): TransactionPort {
  return {
    query: (text, values) => db.query(text, values),
    transaction: (work) =>
      db.transaction((tx) => work({ query: (text, values) => tx.query(text, values) })),
  };
}
function service(db: PGlite) {
  return new WorkspaceService(new SqlWorkspaceStore(port(db)));
}
function taskId(result: Awaited<ReturnType<WorkspaceService["command"]>>): string {
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected success");
  return (result.data as { id: string }).id;
}

test("two service workers, duplicate keys, stale decisions and user/workspace isolation use atomic SQL", async () => {
  const db = new PGlite();
  await db.exec(migration);
  try {
    const one = service(db),
      two = service(db);
    const requester = access(),
      approver = access("approver"),
      other = access("requester", "fixture-other");
    const command = { kind: "create" as const, goal: "Ghi Firebase bằng mô phỏng." };
    const [a, b] = await Promise.all([
      one.command(requester, "fixture-create-1", command),
      two.command(requester, "fixture-create-1", command),
    ]);
    assert.equal(taskId(a), taskId(b));
    const id = taskId(a);
    const reassigned = structuredClone(requester);
    reassigned.subject = "better-auth:fixture-reassigned-requester";
    reassigned.workspace.duties.requester = reassigned.subject;
    const notOwner = await two.command(reassigned, "fixture-owner-transfer", {
      kind: "plan",
      taskId: id,
    });
    assert.equal(notOwner.ok, false);
    if (!notOwner.ok) assert.equal(notOwner.code, "FORBIDDEN");
    assert.equal((await one.snapshot(requester)).tasks.length, 1);
    const receipt = (
      await db.query<{ result: Record<string, unknown> }>(
        "SELECT result FROM luna_command_receipts",
      )
    ).rows[0];
    assert.equal(Object.hasOwn(receipt.result, "snapshot"), false);
    await assert.rejects(
      () =>
        two.command(requester, "fixture-create-1", { ...command, goal: "Khác nội dung ban đầu." }),
      { code: "REPLAY_CONFLICT" },
    );
    const planned = await one.command(requester, "fixture-plan-1", { kind: "plan", taskId: id });
    const approvalId = planned.snapshot.approvals[0].id;
    await assert.rejects(
      () =>
        one.command(requester, "fixture-self-1", {
          kind: "approval",
          approvalId,
          decision: "approved",
        }),
      { code: "ROLE_REQUIRED" },
    );
    const attempts = await Promise.all([
      one.command(approver, "fixture-approve-1", {
        kind: "approval",
        approvalId,
        decision: "approved",
      }),
      two.command(approver, "fixture-approve-2", {
        kind: "approval",
        approvalId,
        decision: "approved",
      }),
    ]);
    assert.equal(attempts.filter((r) => r.ok).length, 1);
    assert.ok(attempts.every((result) => result.acknowledged === true));
    const executions = await Promise.all([
      one.command(requester, "fixture-execute-1", { kind: "execute", taskId: id }),
      two.command(requester, "fixture-execute-2", { kind: "execute", taskId: id }),
    ]);
    assert.equal(executions.filter((r) => r.ok).length, 1);
    const snapshot = await two.snapshot(requester);
    assert.equal(snapshot.runs.length, 1);
    assert.equal(snapshot.tasks[0].status, "dry_run_completed");
    assert.equal(snapshot.storeMode, "postgres");
    assert.equal(snapshot.audit.filter((e) => e.action === "approval.approve").length, 1);
    assert.ok(
      snapshot.audit.every(
        (e) => e.principal && e.workspaceId === requester.workspace.id && e.requestId,
      ),
    );
    assert.ok(
      snapshot.audit.some((e) => e.action === "step.firebase_write" && e.outcome === "refused"),
    );
    assert.equal(snapshot.operations.goEligible, false);
    assert.equal((await two.snapshot(other)).tasks.length, 0);
    const denied = await two.command(other, "fixture-cross-1", { kind: "execute", taskId: id });
    assert.equal(denied.ok, false);
    assert.equal(denied.snapshot.tasks.length, 0);
    await assert.rejects(
      () =>
        one.command(approver, "fixture-create-1", {
          kind: "approval",
          approvalId,
          decision: "approved",
        }),
      { code: "REPLAY_CONFLICT" },
    );
  } finally {
    await db.close();
  }
});

test("partial SQL failure rolls back state and receipt; lost acknowledgement replays committed receipt", async () => {
  const db = new PGlite();
  await db.exec(migration);
  try {
    const base = port(db);
    let fail = true;
    const injected: TransactionPort = {
      ...base,
      transaction: (work) =>
        base.transaction((tx) =>
          work({
            async query<T>(text: string, values?: unknown[]) {
              if (fail && text.startsWith("INSERT INTO luna_command_receipts"))
                throw new Error("synthetic receipt failure");
              return tx.query<T>(text, values);
            },
          }),
        ),
    };
    const requester = access();
    const command = { kind: "create" as const, goal: "Tóm tắt bằng model mock." };
    const worker = new WorkspaceService(new SqlWorkspaceStore(injected));
    await assert.rejects(
      () => worker.command(requester, "fixture-atomic-1", command),
      /synthetic receipt failure/,
    );
    assert.equal((await service(db).snapshot(requester)).tasks.length, 0);
    assert.equal((await db.query("SELECT * FROM luna_command_receipts")).rows.length, 0);
    fail = false;
    const accepted = await worker.command(requester, "fixture-atomic-1", command);
    assert.equal(accepted.ok, true);
    let loseAck = true;
    const uncertain: TransactionPort = {
      ...base,
      async transaction<T>(work: (tx: QueryPort) => Promise<T>) {
        const result = await base.transaction(work);
        if (loseAck) {
          loseAck = false;
          throw new Error("synthetic lost acknowledgement after commit");
        }
        return result;
      },
    };
    const recovering = new WorkspaceService(new SqlWorkspaceStore(uncertain));
    await assert.rejects(
      () => recovering.command(requester, "fixture-lost-ack", command),
      /lost acknowledgement/,
    );
    const replay = await recovering.command(requester, "fixture-lost-ack", command);
    assert.equal(replay.ok, true);
    assert.equal((await worker.snapshot(requester)).tasks.length, 2);
    assert.equal((await db.query("SELECT * FROM luna_command_receipts")).rows.length, 2);
  } finally {
    await db.close();
  }
});

test("disk-backed PGLite reopen restores tasks, approval, audit and dedup receipts", async () => {
  const path = await mkdtemp(join(tmpdir(), "luna-durable-"));
  let db = new PGlite(path);
  try {
    await db.exec(migration);
    const requester = access();
    const command = { kind: "create" as const, goal: "Ghi Firebase bằng mô phỏng." };
    const accepted = await service(db).command(requester, "fixture-restart-1", command);
    const id = taskId(accepted);
    await service(db).command(requester, "fixture-restart-plan", { kind: "plan", taskId: id });
    const pending = await service(db).snapshot(requester);
    await db.close();
    db = new PGlite(path);
    assert.equal((await service(db).snapshot(requester)).tasks[0].status, "awaiting_approval");
    assert.deepEqual((await service(db).snapshot(requester)).approvals, pending.approvals);
    await service(db).command(access("approver"), "fixture-restart-approve", {
      kind: "approval",
      approvalId: pending.approvals[0].id,
      decision: "approved",
    });
    await service(db).command(requester, "fixture-restart-execute", {
      kind: "execute",
      taskId: id,
    });
    const before = await service(db).snapshot(requester);
    await db.close();
    db = new PGlite(path);
    const after = await service(db).snapshot(requester);
    assert.deepEqual(after.tasks, before.tasks);
    assert.deepEqual(after.audit, before.audit);
    assert.deepEqual(after.runs, before.runs);
    assert.deepEqual(after.approvals, before.approvals);
    const replay = await service(db).command(requester, "fixture-restart-1", command);
    assert.equal(taskId(replay), id);
    assert.equal((await service(db).snapshot(requester)).tasks.length, 1);
  } finally {
    await db.close();
    await rm(path, { recursive: true, force: true });
  }
});

test("actual child-process crash before commit rolls back; crash after commit recovers receipt", async () => {
  const path = await mkdtemp(join(tmpdir(), "luna-crash-"));
  const requester = access("requester", "fixture-crash");
  requester.expiresAt = Date.now() + 300000;
  const command = { kind: "create" as const, goal: "Tóm tắt bằng model mock." };
  const script = `
    import { PGlite } from '@electric-sql/pglite';
    import { writeSync } from 'node:fs';
    import { SqlWorkspaceStore } from ${JSON.stringify(new URL("./atomic-store.ts", import.meta.url).href)};
    import { WorkspaceService } from ${JSON.stringify(new URL("./workspace-service.ts", import.meta.url).href)};
    const db = new PGlite(process.env.LUNA_TEST_DB_DIR);
    const mode = process.env.LUNA_TEST_CRASH_MODE;
    const port = {
      query: (sql, args) => db.query(sql, args),
      transaction: work => db.transaction(async tx => {
        const result = await work({query: (sql, args) => tx.query(sql, args)});
        if (mode === 'before') { writeSync(1, 'before-commit\\n'); process.kill(process.pid, 'SIGKILL'); }
        return result;
      })
    };
    await new WorkspaceService(new SqlWorkspaceStore(port)).command(${JSON.stringify(requester)}, 'fixture-crash-create', ${JSON.stringify(command)});
    writeSync(1, 'after-commit\\n');
    process.kill(process.pid, 'SIGKILL');
  `;
  let db = new PGlite(path);
  try {
    await db.exec(migration);
    await db.close();
    for (const mode of ["before", "after"]) {
      const child = spawnSync(
        process.execPath,
        ["--experimental-strip-types", "--input-type=module", "-e", script],
        {
          env: { ...process.env, LUNA_TEST_DB_DIR: path, LUNA_TEST_CRASH_MODE: mode },
          encoding: "utf8",
          timeout: 30000,
        },
      );
      assert.equal(child.signal, "SIGKILL", child.stderr);
      assert.ok(child.stdout.includes(`${mode}-commit`), child.stdout);
      db = new PGlite(path);
      const expected = mode === "before" ? 0 : 1;
      assert.equal((await service(db).snapshot(requester)).tasks.length, expected);
      assert.equal((await db.query("SELECT * FROM luna_command_receipts")).rows.length, expected);
      if (mode === "after") {
        const replay = await service(db).command(requester, "fixture-crash-create", command);
        assert.equal(replay.ok, true);
        assert.equal((await service(db).snapshot(requester)).tasks.length, 1);
      }
      await db.close();
    }
  } finally {
    if (!db.closed) await db.close();
    await rm(path, { recursive: true, force: true });
  }
});
