import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("runtime has no mock identity provider or verified-to-demo fallback for incomplete configuration", () => {
  const moduleUrl = new URL("./server/runtime.server.ts", import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import { workspaceRuntime, trustedAuthEnabled } from ${JSON.stringify(moduleUrl)};
    assert.equal(await workspaceRuntime(), null);
    process.env.LUNA_IDENTITY_PROVIDER = 'mock';
    await assert.rejects(() => workspaceRuntime(), {code:'AUTH_REQUIRED'});
    process.env.LUNA_IDENTITY_PROVIDER = 'better-auth';
    await assert.rejects(() => workspaceRuntime(), {code:'AUTH_REQUIRED'});
    process.env.VITE_AUTH_ENABLED = 'true';
    assert.equal(trustedAuthEnabled(), false);
    await assert.rejects(() => workspaceRuntime(), {code:'AUTH_REQUIRED'});
    process.env.LUNA_IDENTITY_PROVIDER = '';
    process.env.VITE_AUTH_ENABLED = 'false';
    process.env.LUNA_STORE_MODE = 'postgres';
    await assert.rejects(() => workspaceRuntime(), {code:'AUTH_REQUIRED'});
  `;
  const env = { ...process.env };
  for (const name of [
    "LUNA_IDENTITY_PROVIDER",
    "LUNA_DEPLOY_TARGET",
    "LUNA_STORE_MODE",
    "LUNA_DATABASE_URL",
    "DATABASE_URL",
    "BETTER_AUTH_URL",
    "BETTER_AUTH_SECRET",
    "GROK_AUTH_CLIENT_ID",
    "GROK_AUTH_CLIENT_SECRET",
    "LUNA_ACCESS_POLICY_FILE",
    "LUNA_POLICY_PUBLIC_KEY_FILE",
    "LUNA_POLICY_ISSUER",
  ])
    env[name] = "";
  env.VITE_AUTH_ENABLED = "false";
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { env, encoding: "utf8", timeout: 15000 },
  );
  assert.equal(result.status, 0, result.stderr);
});
