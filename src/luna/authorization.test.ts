import { test } from "node:test";
import assert from "node:assert/strict";
import { assertOperatorAccess, runOperatorCommand, type OperatorContext } from "./authorization.ts";
import { LunaControlPlane } from "./control-plane.ts";

test("local role fixtures fail closed for missing auth/role, collision and missing owner authorization", () => {
  for (const action of ["approval", "execute"] as const) {
    const fixture: OperatorContext = {
      principal: { authenticated: true, roles: ["approver", "executor"] },
      ownerAuthorized: true,
      ownerCollision: false,
    };
    for (const [patch, code] of [
      [{ principal: null }, "AUTH_REQUIRED"],
      [{ principal: { authenticated: false, roles: ["approver", "executor"] } }, "AUTH_REQUIRED"],
      [{ principal: { authenticated: true, roles: [] } }, "ROLE_REQUIRED"],
      [
        {
          principal: {
            authenticated: true,
            roles: [action === "approval" ? "executor" : "approver"],
          },
        },
        "ROLE_REQUIRED",
      ],
      [{ ownerCollision: true }, "OWNER_COLLISION"],
      [{ ownerAuthorized: false }, "OWNER_AUTHORIZATION"],
    ] as const)
      assert.throws(() => assertOperatorAccess(action, { ...fixture, ...patch }), { code });
    assert.doesNotThrow(() => assertOperatorAccess(action, fixture));
  }
});

test("actual server command boundary cannot run work without a trusted resolver", async () => {
  const plane = LunaControlPlane.createDefault({});
  const before = plane.snapshot();
  let calls = 0;
  for (const action of ["approval", "execute"] as const) {
    await assert.rejects(
      () =>
        runOperatorCommand(plane, action, async () => {
          calls++;
        }),
      { code: "AUTH_REQUIRED" },
    );
  }
  assert.equal(calls, 0);
  const after = plane.snapshot();
  for (const key of ["tasks", "approvals", "audit", "runs"] as const)
    assert.deepEqual(after[key], before[key]);
});
