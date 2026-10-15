import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BROWSER_CONTRACTS,
  BrowserOrchestrator,
  MockBrowserAdapter,
  chooseBrowserAdapter,
  createStubBrowserAdapter,
} from "./browser.ts";
import { PhaseLockedError } from "./domain.ts";

describe("browser orchestrator", () => {
  it("routes every backend to mock and never calls stubs", async () => {
    let stubCalls = 0;
    let mockCalls = 0;
    const mock = new MockBrowserAdapter();
    const original = mock.execute.bind(mock);
    mock.execute = async (command) => {
      mockCalls += 1;
      return original(command);
    };
    const playwright = createStubBrowserAdapter("playwright");
    const skyvern = createStubBrowserAdapter("skyvern");
    const browserUse = createStubBrowserAdapter("browser-use");
    for (const stub of [playwright, skyvern, browserUse]) {
      const inner = stub.execute.bind(stub);
      stub.execute = async (command) => {
        stubCalls += 1;
        return inner(command);
      };
    }

    const orchestrator = new BrowserOrchestrator([mock, playwright, skyvern, browserUse]);
    const result = await orchestrator.run({
      capability: "snapshot",
      requestedAdapter: "skyvern",
      target: "https://example.com",
    });

    assert.equal(chooseBrowserAdapter("playwright").rerouted, true);
    assert.equal(result.adapterId, "mock");
    assert.equal(result.rerouted, true);
    assert.equal(result.outcome, "simulated");
    assert.match(result.summary, /Không mở trình duyệt thật/);
    assert.match(result.summary, /skyvern/);
    assert.equal(result.launched, false);
    assert.equal(mockCalls, 1);
    assert.equal(stubCalls, 0);
  });

  it("refuses login, upload and download without calling a stub", async () => {
    const stub = createStubBrowserAdapter("playwright");
    const orchestrator = new BrowserOrchestrator([new MockBrowserAdapter(), stub]);
    const login = await orchestrator.run({ capability: "login", requestedAdapter: "playwright" });
    assert.equal(login.outcome, "refused");
    assert.equal(login.launched, false);
    assert.match(login.summary, /không đăng nhập/i);
    await assert.rejects(() => stub.execute({ capability: "login" }), PhaseLockedError);
  });

  it("publishes dry-run contracts for Playwright, Skyvern and Browser Use", () => {
    const ids = BROWSER_CONTRACTS.map((contract) => contract.id);
    assert.deepEqual(ids, ["mock", "playwright", "skyvern", "browser-use"]);
    assert.ok(BROWSER_CONTRACTS.every((contract) => contract.liveLaunch === false));
    assert.ok(BROWSER_CONTRACTS.every((contract) => contract.dryRunOnly === true));
    const orchestrator = new BrowserOrchestrator();
    assert.equal(orchestrator.contracts().length, 4);
  });
});
