import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { postgresPort } from "./postgres-port.ts";

test("concurrent transactions reserve distinct pg clients; rollback and release preserve the original error", async () => {
  const logs: string[][] = [];
  const pool = {
    query: async () => {
      throw new Error("pool.query must not run transaction work");
    },
    connect: async () => {
      const log: string[] = [];
      logs.push(log);
      return {
        query: async (text: string) => {
          log.push(text);
          return { rows: [] };
        },
        release: () => {
          log.push("release");
        },
      };
    },
  } as unknown as Pool;
  const port = postgresPort(pool);
  await Promise.all([
    port.transaction((tx) => tx.query("fixture-one")),
    port.transaction((tx) => tx.query("fixture-two")),
  ]);
  const setup = ["BEGIN", "SET LOCAL lock_timeout = '5s'", "SET LOCAL statement_timeout = '15s'"];
  assert.deepEqual(logs[0], [...setup, "fixture-one", "COMMIT", "release"]);
  assert.deepEqual(logs[1], [...setup, "fixture-two", "COMMIT", "release"]);
  await assert.rejects(
    () =>
      port.transaction(async (tx) => {
        await tx.query("fixture-fail");
        throw new Error("original failure");
      }),
    /original failure/,
  );
  assert.deepEqual(logs[2], [...setup, "fixture-fail", "ROLLBACK", "release"]);
});
