import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFirebasePublicConfig, LUNAZL_FIREBASE_DATABASE_URL } from "./config.ts";
import { createRealtimeDatabase } from "./firebase.ts";
import { evaluateLiveGate } from "./security.ts";
import { assessStaging } from "./staging.ts";
import { describeDeployPosture, unexpectedEndpointKey } from "./deploy.ts";
import { LunaControlPlane } from "./control-plane.ts";
import { assessProduction } from "./production-gate.ts";
import { readFileSync } from "node:fs";

const staging = {
  LUNA_FIREBASE_ENVIRONMENT: "staging",
  STAGING_FIREBASE_PROJECT_ID: "lunazl-agent-staging-6dd7a",
  STAGING_FIREBASE_DATABASE_URL:
    "https://lunazl-agent-staging-6dd7a-default-rtdb.asia-southeast1.firebasedatabase.app",
};

test("staging uses only its own coordinates, credential binding and flags", () => {
  const config = loadFirebasePublicConfig({
    ...staging,
    FIREBASE_PROJECT_ID: "lunazl-agent",
    FIREBASE_DATABASE_URL: LUNAZL_FIREBASE_DATABASE_URL,
    FIREBASE_SERVICE_ACCOUNT_JSON: "fixture-generic-not-a-credential",
    FIREBASE_LIVE_ENABLED: "true",
  });
  assert.equal(config.projectId, staging.STAGING_FIREBASE_PROJECT_ID);
  assert.equal(config.databaseUrl, staging.STAGING_FIREBASE_DATABASE_URL);
  assert.equal(config.credentialEnvVar, "STAGING_FIREBASE_SERVICE_ACCOUNT_JSON");
  assert.equal(config.credentialConfigured, false);
  assert.equal(config.liveRequested, false);
  assert.equal(config.liveEnabled, false);
  assert.equal(createRealtimeDatabase(config).mode, "memory");
  const snapshot = LunaControlPlane.createDefault(staging).snapshot();
  assert.equal(snapshot.adapters.firebase.projectId, staging.STAGING_FIREBASE_PROJECT_ID);
  assert.equal(
    snapshot.adapters.firebase.databaseUrlHost,
    new URL(staging.STAGING_FIREBASE_DATABASE_URL).host,
  );
  assert.equal(snapshot.adapters.firebase.mode, "memory");
  assert.equal(snapshot.adapters.firebase.liveEnabled, false);
  const template = readFileSync(
    new URL("../../config/staging.env.example", import.meta.url),
    "utf8",
  );
  const templateEnv = Object.fromEntries(
    [...template.matchAll(/^([A-Z_]+)=(.*)$/gm)].map((match) => [match[1], match[2]]),
  );
  const fromTemplate = LunaControlPlane.createDefault(templateEnv).snapshot();
  assert.equal(fromTemplate.adapters.firebase.projectId, staging.STAGING_FIREBASE_PROJECT_ID);
  assert.equal(fromTemplate.adapters.firebase.credentialConfigured, false);
  assert.equal(fromTemplate.adapters.firebase.mode, "memory");
  assert.equal(fromTemplate.deployment.target, "staging");
  assert.equal(fromTemplate.deployment.network, false);
  assert.equal(fromTemplate.staging.decision, "NO-GO");
});

test("staging missing or mismatched coordinates fail closed without generic fallback", () => {
  for (const env of [
    { LUNA_FIREBASE_ENVIRONMENT: "staging", FIREBASE_DATABASE_URL: LUNAZL_FIREBASE_DATABASE_URL },
    { ...staging, STAGING_FIREBASE_DATABASE_URL: LUNAZL_FIREBASE_DATABASE_URL },
    { ...staging, STAGING_FIREBASE_PROJECT_ID: "lunazl-agent" },
    {
      ...staging,
      STAGING_FIREBASE_DATABASE_URL: `${staging.STAGING_FIREBASE_DATABASE_URL}/private`,
    },
    { ...staging, LUNA_FIREBASE_ENVIRONMENT: "stagign" },
  ])
    assert.throws(() => loadFirebasePublicConfig(env), { code: "CONFIG" });
});

test("staging live flag and dummy credential never construct a network adapter", async () => {
  const config = loadFirebasePublicConfig({
    ...staging,
    STAGING_FIREBASE_LIVE_ENABLED: "true",
    STAGING_FIREBASE_SERVICE_ACCOUNT_JSON: "fixture-only",
  });
  assert.equal(config.credentialConfigured, true);
  assert.equal(config.liveEnabled, false);
  const db = createRealtimeDatabase(config);
  assert.equal(db.mode, "disabled-live");
  await assert.rejects(() => db.get("/luna/queue"), { code: "PHASE_LOCK" });
  assert.equal(JSON.stringify(config).includes("fixture-only"), false);
});

test("staging bindings are covered by live, secret and endpoint preflight checks", () => {
  const env = {
    ...staging,
    STAGING_FIREBASE_LIVE_ENABLED: "true",
    STAGING_FIREBASE_SERVICE_ACCOUNT_JSON: "fixture-only",
  };
  assert.ok(evaluateLiveGate(env).violations.includes("firebase-live"));
  assert.equal(describeDeployPosture(env).blocked, true);
  assert.equal(
    describeDeployPosture({ STAGING_FIREBASE_SERVICE_ACCOUNT_JSON: "fixture-only" }).blocked,
    true,
  );
  const report = assessStaging({ env });
  assert.equal(report.checks.find((check) => check.id === "credential-absent")?.ok, false);
  assert.equal(report.checks.find((check) => check.id === "live-flags")?.ok, false);
  assert.equal(
    assessProduction({ env }).checks.find((check) => check.id === "credential-absent")?.ok,
    false,
  );
  assert.equal(JSON.stringify(report).includes("fixture-only"), false);
  assert.equal(
    unexpectedEndpointKey({ STAGING_FIREBASE_DATABASE_URL: "https://unapproved.example.invalid" }),
    "STAGING_FIREBASE_DATABASE_URL",
  );
});
