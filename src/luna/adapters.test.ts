import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PHASE4_ADAPTERS,
  PHASE4_FIREBASE_URL,
  browserContractsLocked,
  firebaseStaysOffline,
  nineRouterStaysOffline,
} from "./adapters.ts";
import { BROWSER_CONTRACTS } from "./browser.ts";
import {
  LUNAZL_FIREBASE_DATABASE_URL,
  loadFirebasePublicConfig,
  loadNineRouterPublicConfig,
} from "./config.ts";
import { LunaError } from "./domain.ts";
import { InProcessRtdbTransport } from "./firebase-emulator.ts";
import { FirebaseRtdbClient, evaluateFirebaseConnect } from "./firebase-rtdb.ts";
import { MemoryRealtimeDatabase } from "./firebase.ts";
import { ModelAttemptError, ModelRouter } from "./models.ts";

describe("phase 4 adapter contracts", () => {
  it("keeps every adapter offline, unpaid, and unable to launch a browser", () => {
    assert.equal(PHASE4_ADAPTERS.length, 5);
    assert.ok(PHASE4_ADAPTERS.every((adapter) => adapter.liveEnabled === false));
    assert.ok(PHASE4_ADAPTERS.every((adapter) => adapter.network === false));
    assert.deepEqual(
      PHASE4_ADAPTERS.map((adapter) => adapter.posture),
      ["memory", "mock", "stub", "stub", "stub"],
    );
    assert.equal(browserContractsLocked().length, BROWSER_CONTRACTS.length);
    assert.ok(BROWSER_CONTRACTS.every((contract) => contract.liveLaunch === false));
  });

  it("rejects a missing Firebase credential and does not open the production URL", async () => {
    const config = loadFirebasePublicConfig({
      FIREBASE_PROJECT_ID: "lunazl-agent",
      FIREBASE_DATABASE_URL: LUNAZL_FIREBASE_DATABASE_URL,
      FIREBASE_LIVE_ENABLED: "true",
    });
    assert.equal(firebaseStaysOffline(config), true);
    const decision = evaluateFirebaseConnect(config);
    assert.equal(decision.ok, false);
    if (decision.ok) return;
    assert.equal(decision.reason, "missing-credential");
    assert.equal(config.liveEnabled, false);

    const transport = new InProcessRtdbTransport(new MemoryRealtimeDatabase());
    const client = new FirebaseRtdbClient({
      databaseUrl: PHASE4_FIREBASE_URL,
      authToken: "not-a-credential",
      transport,
    });
    await assert.rejects(
      () => client.get("/luna/v1/settings"),
      (error: unknown) => error instanceof LunaError && error.code === "NETWORK",
    );
  });

  it("keeps 9Router locked when the key is missing, present, or live is requested", async () => {
    const missing = loadNineRouterPublicConfig({ LUNA_ALLOW_LIVE_MODELS: "true" });
    assert.equal(nineRouterStaysOffline(missing).reason, "missing-credential");
    assert.equal(missing.liveEnabled, false);

    const present = loadNineRouterPublicConfig({
      LUNA_ALLOW_LIVE_MODELS: "true",
      NINE_ROUTER_API_KEY: "not-a-real-key",
      LUNA_MODEL_TIMEOUT_MS: "-5",
      LUNA_MODEL_MAX_RETRIES: "9",
    });
    assert.equal(nineRouterStaysOffline(present).reason, "phase-lock");
    assert.equal(present.timeoutMs, 1000);
    assert.equal(present.maxRetries, 2);
    assert.equal(present.apiKeyConfigured, true);
    assert.equal("not-a-real-key" in present, false);

    let fetches = 0;
    const router = new ModelRouter(present, async () => {
      fetches += 1;
      throw new Error("network");
    });
    await assert.rejects(
      () =>
        router.complete({
          model: "luna-fast",
          messages: [{ role: "user", content: "ping" }],
          mockFault: "timeout",
        }),
      (error: unknown) =>
        error instanceof ModelAttemptError &&
        error.attempts === 3 &&
        error.network === false &&
        error.estimatedCostUsd === 0,
    );
    const ok = await router.complete({
      model: "luna-fast",
      messages: [{ role: "user", content: "ping" }],
    });
    assert.equal(ok.network, false);
    assert.equal(ok.usage.estimatedCostUsd, 0);
    assert.equal(fetches, 0);
  });

  it("rejects a 9Router URL that tries to carry a credential", () => {
    assert.throws(
      () => loadNineRouterPublicConfig({ NINE_ROUTER_BASE_URL: "http://user:secret@127.0.0.1:20128/v1" }),
      (error: unknown) => error instanceof LunaError && error.code === "CONFIG",
    );
  });
});
