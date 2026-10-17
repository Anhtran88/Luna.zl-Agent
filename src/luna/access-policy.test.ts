import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import {
  DUTIES,
  parseAccessPolicy,
  verifiedSubject,
  bindAccess,
  authorizeAccess,
  verifySignedPolicy,
  type WorkspacePolicy,
} from "./access-policy.ts";

const workspace = (): WorkspacePolicy => ({
  id: "fixture-workspace",
  duties: Object.fromEntries(
    DUTIES.map((duty) => [duty, `better-auth:fixture-${duty}`]),
  ) as WorkspacePolicy["duties"],
});

test("session verifier alone provides identity; null/failed/invalid sessions never fall back", async () => {
  assert.equal(
    await verifiedSubject(async () => ({ id: "fixture-requester", roles: ["admin"] })),
    "better-auth:fixture-requester",
  );
  for (const verify of [
    async () => null,
    async () => {
      throw new Error("expired/revoked fixture");
    },
    async () => ({ id: "" }),
  ])
    await assert.rejects(() => verifiedSubject(verify), { code: "AUTH_REQUIRED" });
});

test("roles, owner consent and workspace come from signed server policy, not client claims", () => {
  const policy = parseAccessPolicy({ version: 1, workspaces: [workspace()] });
  const requester = bindAccess("better-auth:fixture-requester", {
    policy,
    expiresAt: Date.now() + 60000,
  });
  assert.doesNotThrow(() => authorizeAccess(requester, "create"));
  assert.throws(() => authorizeAccess(requester, "approval"), { code: "ROLE_REQUIRED" });
  assert.throws(
    () => bindAccess("better-auth:unassigned", { policy, expiresAt: Date.now() + 60000 }),
    { code: "FORBIDDEN" },
  );
  assert.throws(() => authorizeAccess({ ...requester, expiresAt: 1 }, "execute"), {
    code: "POLICY_EXPIRED",
  });
  const collided = workspace();
  for (const duty of DUTIES) collided.duties[duty] = "better-auth:fixture-kenbi";
  const access = bindAccess("better-auth:fixture-kenbi", {
    policy: { version: 1, workspaces: [collided] },
    expiresAt: Date.now() + 60000,
  });
  for (const kind of ["approval", "execute"] as const)
    assert.throws(() => authorizeAccess(access, kind), { code: "OWNER_COLLISION" });
  collided.duties["incident-owner"] = null;
  assert.throws(() => authorizeAccess({ ...access, workspace: collided }, "execute"), {
    code: "OWNER_COLLISION",
  });
});

test("signed policy requires pinned public key, issuer/audience, bounded lifetime and current expiry", async () => {
  const keys = await generateKeyPair("EdDSA", { extractable: true });
  const publicKey = await exportJWK(keys.publicKey);
  const now = new Date("2026-01-01T00:00:00Z");
  const iat = now.getTime() / 1000;
  const token = await new SignJWT({ policy: { version: 1, workspaces: [workspace()] } })
    .setProtectedHeader({ alg: "EdDSA" })
    .setIssuer("fixture-owner")
    .setAudience("luna-local-access")
    .setSubject("luna-access-policy")
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(keys.privateKey);
  const signed = await verifySignedPolicy(token, publicKey, "fixture-owner", now);
  assert.equal(signed.policy.workspaces[0].id, "fixture-workspace");
  await assert.rejects(() => verifySignedPolicy(token, publicKey, "wrong-owner", now), {
    code: "POLICY_INVALID",
  });
  await assert.rejects(
    () => verifySignedPolicy(token, publicKey, "fixture-owner", new Date(now.getTime() + 7200000)),
    { code: "POLICY_INVALID" },
  );
  const other = await generateKeyPair("EdDSA", { extractable: true });
  const otherKey = await exportJWK(other.publicKey);
  await assert.rejects(() => verifySignedPolicy(token, otherKey, "fixture-owner", now), {
    code: "POLICY_INVALID",
  });
  await assert.rejects(
    () => verifySignedPolicy(token, { ...publicKey, d: "not-public" }, "fixture-owner", now),
    { code: "POLICY_INVALID" },
  );
});
