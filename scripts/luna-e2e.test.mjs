import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("UI E2E refuses nonlocal, credential-bearing, or unrelated targets before launching a browser", () => {
  for (const url of ["https://example.invalid/", "http://127.0.0.1:9999/", "http://user:pass@127.0.0.1:8080/", "http://127.0.0.1:8080/private", "http://127.0.0.1:8080/?token=fixture"]) {
    const run = spawnSync(process.execPath, [fileURLToPath(new URL("./luna-e2e.mjs", import.meta.url))], {
      env: { ...process.env, LUNA_E2E_URL: url, AGENT_BROWSER_EXECUTABLE_PATH: "/missing-browser-sentinel" },
      encoding: "utf8",
    });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /only the local Luna dev\/built endpoints/);
    assert.doesNotMatch(run.stderr, /Install Chromium/);
  }
});
