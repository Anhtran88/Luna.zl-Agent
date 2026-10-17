import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionIdentity, type SessionLookup } from "./session-verifier.ts";
import { verifiedSubject } from "./access-policy.ts";

test("database session verification rejects expiry/revocation/mismatch and never trusts claimed headers", async () => {
  const now = 100000;
  const headers = new Headers({
    "x-user-id": "forged",
    "x-user-role": "admin",
    authorization: "Bearer unverified-fixture",
  });
  let calls = 0;
  const lookup: SessionLookup = async (options) => {
    calls++;
    assert.equal(options.query.disableCookieCache, true);
    assert.equal(options.headers, headers);
    return {
      user: { id: "fixture-verified" },
      session: { userId: "fixture-verified", expiresAt: new Date(now + 1000) },
    };
  };
  assert.deepEqual(await sessionIdentity(lookup, headers, now), { id: "fixture-verified" });
  assert.equal(calls, 1);
  for (const expiresAt of [new Date(now - 1), "invalid-date", undefined])
    assert.equal(
      await sessionIdentity(
        async () => ({
          user: { id: "fixture-verified" },
          session: { userId: "fixture-verified", expiresAt },
        }),
        headers,
        now,
      ),
      null,
    );
  assert.equal(
    await sessionIdentity(
      async () => ({
        user: { id: "fixture-one" },
        session: { userId: "fixture-other", expiresAt: new Date(now + 1000) },
      }),
      headers,
      now,
    ),
    null,
  );
  await assert.rejects(() => verifiedSubject(() => sessionIdentity(async () => null, headers)), {
    code: "AUTH_REQUIRED",
  });
  await assert.rejects(
    () =>
      verifiedSubject(() =>
        sessionIdentity(async () => {
          throw new Error("revoked/unavailable fixture");
        }, headers),
      ),
    { code: "AUTH_REQUIRED" },
  );
});
