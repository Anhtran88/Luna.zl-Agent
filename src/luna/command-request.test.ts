import { test } from "node:test";
import assert from "node:assert/strict";
import { reliableCommand } from "./command-request.ts";

test("lost response/reload reuses opaque request id; acknowledged new operation gets new id", async () => {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
  let first = "";
  await assert.rejects(() =>
    reliableCommand(
      "create",
      { goal: "synthetic customer-free fixture" },
      async (id) => {
        first = id;
        throw new Error("lost response");
      },
      storage,
    ),
  );
  assert.equal(entries.size, 1);
  assert.equal(JSON.stringify([...entries]).includes("customer-free"), false);
  await reliableCommand(
    "create",
    { goal: "synthetic customer-free fixture" },
    async (id) => {
      assert.equal(id, first);
      return { ok: false, code: "PERSISTENCE_UNCERTAIN" };
    },
    storage,
  );
  assert.equal(entries.size, 1);
  for (const code of ["AUTH_REQUIRED", "POLICY_INVALID", "ROLE_REQUIRED"]) {
    await reliableCommand(
      "create",
      { goal: "synthetic customer-free fixture" },
      async (id) => {
        assert.equal(id, first);
        return { ok: false, code };
      },
      storage,
    );
    assert.equal(
      entries.size,
      1,
      "Re-auth or policy renewal must not discard the uncertain original request id.",
    );
  }
  const retry = await reliableCommand(
    "create",
    { goal: "synthetic customer-free fixture" },
    async (id) => id,
    storage,
  );
  assert.equal(retry, first);
  assert.equal(entries.size, 0);
  const next = await reliableCommand(
    "create",
    { goal: "synthetic customer-free fixture" },
    async (id) => id,
    storage,
  );
  assert.notEqual(next, first);
  await reliableCommand(
    "approval",
    { approvalId: "fixture-approval" },
    async () => ({ ok: false, code: "BAD_STATUS", acknowledged: true }),
    storage,
  );
  assert.equal(entries.size, 0, "A committed negative receipt is a definitive ACK.");
});
