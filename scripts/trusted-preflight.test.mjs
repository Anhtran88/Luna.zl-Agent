import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { trustedPreflight } from "./trusted-preflight.mjs";

function fixture() {
  return {
    LUNA_IDENTITY_PROVIDER: "better-auth",
    VITE_AUTH_ENABLED: "true",
    LUNA_STORE_MODE: "postgres",
    BETTER_AUTH_SECRET: "fixture-secret",
    GROK_AUTH_CLIENT_ID: "fixture-client",
    GROK_AUTH_CLIENT_SECRET: "fixture-secret",
    LUNA_ACCESS_POLICY_FILE: "/fixture/policy",
    LUNA_POLICY_PUBLIC_KEY_FILE: "/fixture/key",
    LUNA_POLICY_ISSUER: "fixture-issuer",
    BETTER_AUTH_URL: "https://app.invalid",
    GROK_AUTH_ISSUER: "https://issuer.invalid",
    DATABASE_URL: "postgres://fixture:private@database.invalid/auth?sslmode=verify-full",
    LUNA_DATABASE_URL: "postgres://fixture:private@database.invalid/luna?sslmode=verify-full",
  };
}

test("preflight remains NO-GO even with complete configuration; never emits values", () => {
  const env = fixture();
  const report = trustedPreflight(env);
  assert.equal(report.configurationComplete, true);
  assert.equal(report.decision, "NO-GO");
  assert.equal(report.networkCalls, 0);
  assert.equal(report.mutations, 0);
  for (const value of [
    env.BETTER_AUTH_SECRET,
    env.GROK_AUTH_CLIENT_ID,
    env.DATABASE_URL,
    env.LUNA_ACCESS_POLICY_FILE,
  ])
    assert.equal(JSON.stringify(report).includes(value), false);
  assert.equal(trustedPreflight({}).configurationComplete, false);
});

test("each missing binding and unsafe URL fails closed without leaking parser errors", () => {
  for (const name of Object.keys(fixture())) {
    const env = fixture();
    delete env[name];
    assert.equal(trustedPreflight(env).configurationComplete, false, name);
  }
  for (const value of [
    "postgres://u:private@db/x",
    "postgres://u:private@db/x?sslmode=require",
    "postgres://db/x?sslmode=verify-full&sslmode=disable",
    "malformed-private",
  ]) {
    const report = trustedPreflight({ ...fixture(), DATABASE_URL: value });
    assert.equal(report.configurationComplete, false);
    assert.equal(JSON.stringify(report).includes("private"), false);
  }
  assert.equal(
    trustedPreflight({ ...fixture(), BETTER_AUTH_URL: "https://u:private@app.invalid" })
      .configurationComplete,
    false,
  );
});

test("CLI returns blocked exit status with empty environment and only safe JSON", () => {
  const result = spawnSync(process.execPath, ["scripts/trusted-preflight.mjs"], {
    env: {},
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).decision, "NO-GO");
});
