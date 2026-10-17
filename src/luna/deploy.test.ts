import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { LUNAZL_FIREBASE_DATABASE_URL } from "./config.ts";
import {
  describeDeployPosture,
  dryRunDeploy,
  isLoopbackUrl,
  planRollback,
  unexpectedEndpointKey,
} from "./deploy.ts";

const LOCAL_ENV = {
  LUNA_DEPLOY_TARGET: "local",
  FIREBASE_PROJECT_ID: "lunazl-agent",
  FIREBASE_DATABASE_URL: LUNAZL_FIREBASE_DATABASE_URL,
  FIREBASE_LIVE_ENABLED: "false",
  LUNA_ALLOW_LIVE_MODELS: "false",
  NINE_ROUTER_BASE_URL: "http://127.0.0.1:20128/v1",
  FIREBASE_SERVICE_ACCOUNT_JSON: "",
  NINE_ROUTER_API_KEY: "",
};
const DENY_FILES = { "firebase/database.rules.json": JSON.stringify({ rules: { ".read": false, ".write": false } }) };

describe("phase 5 deploy dry-run", () => {
  it("never follows a health redirect, even to a second loopback path", async () => {
    let redirectedRequests = 0;
    const server = createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(302, { Location: "/outside-health" });
      } else {
        redirectedRequests += 1;
        res.writeHead(200);
      }
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const report = await dryRunDeploy({
        env: LOCAL_ENV,
        files: DENY_FILES,
        healthUrl: `http://127.0.0.1:${address.port}/health`,
        fetchImpl: globalThis.fetch,
      });
      assert.equal(report.health.status, "local-failed");
      assert.equal(report.ok, false);
      assert.equal(redirectedRequests, 0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
  it("passes a local dry-run when secrets are missing and live flags are off", async () => {
    const report = await dryRunDeploy({ env: LOCAL_ENV, files: { ...DENY_FILES, "README.md": "no secrets" } });
    assert.equal(report.ok, true);
    assert.equal(report.mode, "dry-run");
    assert.equal(report.target, "local");
    assert.equal(report.productionNetwork, false);
    assert.equal(report.productionDeployed, false);
    assert.equal(report.rulesDeployed, false);
    assert.equal(report.publicPublish, false);
    assert.equal(report.health.network, false);
    assert.equal(report.rollback.network, false);
    assert.equal(report.rollback.mutatesProduction, false);
    assert.equal(report.rollback.previousRelease, "4-controlled");
    assert.equal(describeDeployPosture(LOCAL_ENV).blocked, false);
  });

  it("fails closed when a file contains a private key and does not echo it", async () => {
    const secret = `-----BEGIN PRIVATE KEY-----\n${"A".repeat(80)}\n-----END PRIVATE KEY-----`;
    const report = await dryRunDeploy({
      env: LOCAL_ENV,
      files: { "leaked.txt": secret },
    });
    assert.equal(report.ok, false);
    assert.ok(report.blockers.includes("secrets"));
    const detail = report.checks.find((check) => check.id === "secrets")?.detail ?? "";
    assert.equal(detail.includes(secret), false);
    assert.equal(detail.includes("AAAA"), false);
  });

  it("blocks an accidental production endpoint without calling fetch", async () => {
    let calls = 0;
    const report = await dryRunDeploy({
      env: { ...LOCAL_ENV, LUNA_PRODUCTION_URL: "https://luna.example" },
      healthUrl: "https://luna.example/health",
      fetchImpl: async () => {
        calls += 1;
        return new Response("no");
      },
    });
    assert.equal(report.ok, false);
    assert.ok(report.blockers.includes("production-endpoint"));
    assert.equal(report.health.status, "refused");
    assert.equal(report.productionNetwork, false);
    assert.equal(calls, 0);
    assert.equal(unexpectedEndpointKey({ LUNA_STAGING_URL: "https://staging.example" }), "LUNA_STAGING_URL");
    assert.equal(isLoopbackUrl("http://127.0.0.1:8080/"), true);
  });

  it("keeps production locked even when opt-in and a credential are missing", async () => {
    const missing = await dryRunDeploy({
      env: { ...LOCAL_ENV, LUNA_DEPLOY_TARGET: "production" },
    });
    assert.equal(missing.ok, false);
    assert.ok(missing.blockers.includes("production-opt-in"));
    assert.equal(missing.productionDeployed, false);

    const opted = await dryRunDeploy({
      env: {
        ...LOCAL_ENV,
        LUNA_DEPLOY_TARGET: "production",
        LUNA_DEPLOY_PRODUCTION_OPT_IN: "true",
      },
    });
    assert.equal(opted.ok, false);
    assert.equal(opted.productionNetwork, false);
    assert.match(
      opted.checks.find((check) => check.id === "production-opt-in")?.detail ?? "",
      /Không deploy/,
    );
  });

  it("refuses staging network, live adapters, and a missing artifact", async () => {
    let calls = 0;
    const report = await dryRunDeploy({
      env: {
        ...LOCAL_ENV,
        LUNA_DEPLOY_TARGET: "staging",
        LUNA_STAGING_URL: "https://staging.example",
        FIREBASE_LIVE_ENABLED: "true",
        LUNA_ALLOW_LIVE_MODELS: "true",
        NINE_ROUTER_API_KEY: "not-printed",
      },
      artifactPresent: false,
      artifactLabel: "build",
      fetchImpl: async () => {
        calls += 1;
        return new Response("no");
      },
    });
    assert.equal(report.ok, false);
    for (const id of ["staging-network", "firebase-live", "nine-router-live", "secret-env", "artifact"]) {
      assert.ok(report.blockers.includes(id), id);
    }
    assert.equal(calls, 0);
    assert.equal(report.checks.find((check) => check.id === "secret-env")?.detail.includes("not-printed"), false);
    assert.equal(describeDeployPosture(report.target === "staging" ? { LUNA_DEPLOY_TARGET: "staging", LUNA_STAGING_URL: "https://staging.example" } : {}).blocked, true);
  });

  it("probes only an injected loopback health check and records rollback", async () => {
    let calls = 0;
    const report = await dryRunDeploy({
      env: LOCAL_ENV,
      files: DENY_FILES,
      healthUrl: "http://127.0.0.1:8080/",
      fetchImpl: async (input) => {
        calls += 1;
        assert.equal(String(input), "http://127.0.0.1:8080/");
        return new Response("ok", { status: 200 });
      },
    });
    assert.equal(report.ok, true);
    assert.equal(calls, 1);
    assert.equal(report.health.status, "local-ok");
    assert.equal(report.health.network, false);
    assert.equal(report.rollback.strategy, "local-no-op");
    assert.equal(planRollback().mutatesProduction, false);
    assert.equal(describeDeployPosture({}).target, "local");
    assert.equal(describeDeployPosture({}).blocked, false);
  });

  it("requires deny-all proof, rejects browser launch and production opt-in, and does not probe on refusal", async () => {
    for (const input of [
      { files: undefined, env: LOCAL_ENV },
      { files: { "firebase/database.rules.json": "not-json" }, env: LOCAL_ENV },
      { files: { "firebase/database.rules.json": JSON.stringify({ rules: { ".read": true, ".write": true } }) }, env: LOCAL_ENV },
      { files: DENY_FILES, env: { ...LOCAL_ENV, LUNA_BROWSER_LAUNCH: "true" } },
      { files: DENY_FILES, env: { ...LOCAL_ENV, LUNA_DEPLOY_PRODUCTION_OPT_IN: "true" } },
    ]) {
      let calls = 0;
      const report = await dryRunDeploy({ ...input, healthUrl: "http://127.0.0.1:8080", fetchImpl: async () => {
        calls += 1;
        return new Response("ok");
      } });
      assert.equal(report.ok, false);
      assert.equal(calls, 0);
    }
    assert.equal(describeDeployPosture({ LUNA_BROWSER_LAUNCH: "true" }).blocked, true);
    assert.equal(describeDeployPosture({ LUNA_DEPLOY_PRODUCTION_OPT_IN: "true" }).blocked, true);
  });

  it("never probes staging and does not echo an invalid target or private artifact label", async () => {
    let calls = 0;
    const report = await dryRunDeploy({
      env: { ...LOCAL_ENV, LUNA_DEPLOY_TARGET: "staging" },
      files: DENY_FILES,
      healthUrl: "http://127.0.0.1:8080",
      artifactPresent: true,
      artifactLabel: "PRIVATE_ARTIFACT_LABEL_SHOULD_NOT_LEAK",
      fetchImpl: async () => { calls += 1; return new Response("ok"); },
    });
    assert.equal(report.ok, true);
    assert.equal(report.health.status, "skipped");
    assert.equal(calls, 0);
    assert.equal(JSON.stringify(report).includes("PRIVATE_ARTIFACT_LABEL_SHOULD_NOT_LEAK"), false);
    const invalid = await dryRunDeploy({ env: { LUNA_DEPLOY_TARGET: "PRIVATE_TARGET_SHOULD_NOT_LEAK" }, files: DENY_FILES });
    assert.equal(invalid.ok, false);
    assert.equal(JSON.stringify(invalid).includes("PRIVATE_TARGET_SHOULD_NOT_LEAK"), false);
  });
});
