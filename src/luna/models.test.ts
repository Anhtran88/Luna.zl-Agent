import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadNineRouterPublicConfig } from "./config.ts";
import { ModelRouter, NineRouterProvider, resolveModelRoute } from "./models.ts";
import { PhaseLockedError } from "./domain.ts";

describe("model router", () => {
  it("resolves 9router-style aliases and combos onto mock", () => {
    const config = loadNineRouterPublicConfig({});
    const alias = resolveModelRoute("luna-fast", config);
    assert.equal(alias.resolvedModel, "mock/luna-planner");
    assert.equal(alias.providerId, "mock");
    assert.ok(alias.notes.includes("network:blocked"));

    const combo = resolveModelRoute("luna-resilient", config);
    assert.equal(combo.resolvedModel, "mock/luna-planner");
    assert.match(
      combo.notes[0] ?? "",
      /combo:luna-resilient:mock\/luna-planner\|mock\/luna-planner-fallback/,
    );

    const remote = resolveModelRoute("kimi/kimi-k2.6", config);
    assert.equal(remote.resolvedModel, "mock/luna-planner");
    assert.ok(remote.notes.includes("reroute:nine-router->mock"));
  });

  it("mock completion does not report a network call", async () => {
    const router = new ModelRouter(loadNineRouterPublicConfig({}));
    const result = await router.complete({
      model: "luna-fast",
      messages: [{ role: "user", content: "xin chào" }],
    });
    assert.equal(result.network, false);
    assert.equal(result.dryRun, true);
    assert.equal(result.providerId, "mock");
    assert.equal(result.usage.billed, false);
    assert.equal(result.usage.estimatedCostUsd, 0);
    assert.match(result.content, /Mock mock\/luna-planner không gọi mạng/);
    assert.ok(result.notes.includes("retriesExecuted:0"));
  });

  it("keeps configured retries local to the mock registry", async () => {
    let fetches = 0;
    const router = new ModelRouter(
      loadNineRouterPublicConfig({ LUNA_MODEL_MAX_RETRIES: "2", LUNA_ALLOW_LIVE_MODELS: "true" }),
      async () => {
        fetches += 1;
        throw new Error("network should not be used");
      },
    );
    assert.deepEqual(router.registry.ids(), ["mock", "nine-router"]);
    const result = await router.complete({
      model: "kimi/kimi-k2.6",
      messages: [{ role: "user", content: "không gọi mạng" }],
    });
    assert.equal(result.network, false);
    assert.equal(result.usage.estimatedCostUsd, 0);
    assert.ok(result.notes.includes("retriesConfigured:2"));
    assert.ok(result.notes.includes("retriesExecuted:0"));
    assert.equal(fetches, 0);
    await assert.rejects(() => router.registry.require("nine-router").complete({
      model: "kimi/kimi-k2.6",
      messages: [],
    }), PhaseLockedError);
    assert.equal(fetches, 0);
  });

  it("9router provider fails closed before fetch", async () => {
    let fetches = 0;
    const provider = new NineRouterProvider(loadNineRouterPublicConfig({}), async () => {
      fetches += 1;
      throw new Error("network should not be used");
    });
    await provider.listModels();
    await assert.rejects(
      () => provider.complete({ model: "kimi/kimi-k2.6", messages: [] }),
      PhaseLockedError,
    );
    assert.equal(fetches, 0);
  });
});
