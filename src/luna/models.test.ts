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
    assert.match(result.content, /Mock mock\/luna-planner không gọi mạng/);
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
