import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LunaError } from "./domain.ts";
import {
  DEFAULT_NINE_ROUTER_BASE_URL,
  LUNAZL_FIREBASE_DATABASE_URL,
  loadFirebasePublicConfig,
  loadNineRouterPublicConfig,
} from "./config.ts";

describe("public config", () => {
  it("keeps firebase secrets out of the config object and refuses live", () => {
    const secret = "super-secret-value-not-real";
    const config = loadFirebasePublicConfig({
      FIREBASE_PROJECT_ID: "luna-dev",
      FIREBASE_DATABASE_URL: "https://luna-dev.firebasedatabase.app",
      FIREBASE_SERVICE_ACCOUNT_JSON: secret,
      LUNA_FIREBASE_LIVE: "true",
    });

    assert.equal(JSON.stringify(config).includes(secret), false);
    assert.equal(config.credentialConfigured, true);
    assert.equal(config.liveRequested, true);
    assert.equal(config.liveEnabled, false);
    assert.equal(config.databaseUrlHost, "luna-dev.firebasedatabase.app");
    assert.equal(config.credentialEnvVar, "FIREBASE_SERVICE_ACCOUNT_JSON");
  });

  it("rejects credentials embedded in firebase or 9router URLs", () => {
    assert.throws(
      () =>
        loadFirebasePublicConfig({
          FIREBASE_DATABASE_URL: "https://user:pass@luna.firebasedatabase.app",
        }),
      (error: unknown) => error instanceof LunaError && error.code === "CONFIG",
    );
    assert.throws(
      () =>
        loadNineRouterPublicConfig({
          NINE_ROUTER_BASE_URL: "http://127.0.0.1:20128/v1?key=sekret",
        }),
      (error: unknown) => error instanceof LunaError && error.code === "CONFIG",
    );
  });

  it("defaults 9router to localhost and ignores the live opt-in", () => {
    const key = "sk-test-key-not-real";
    const config = loadNineRouterPublicConfig({
      NINE_ROUTER_API_KEY: key,
      LUNA_ALLOW_LIVE_MODELS: "true",
    });
    assert.equal(JSON.stringify(config).includes(key), false);
    assert.equal(config.baseUrl, DEFAULT_NINE_ROUTER_BASE_URL);
    assert.equal(config.apiKeyConfigured, true);
    assert.equal(config.liveRequested, true);
    assert.equal(config.liveEnabled, false);
    assert.equal(config.aliases["luna-fast"], "mock/luna-planner");
  });

  it("env example contains placeholders only", () => {
    const text = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
    assert.equal(text.includes("BEGIN PRIVATE KEY"), false);
    assert.doesNotMatch(text, /sk-[A-Za-z0-9]{16,}/);
    assert.match(text, /FIREBASE_SERVICE_ACCOUNT_JSON=/);
    assert.match(text, /NINE_ROUTER_API_KEY=/);
    assert.match(text, /LUNA_ALLOW_LIVE_MODELS=false/);
    assert.match(text, /FIREBASE_LIVE_ENABLED=false/);
    assert.match(text, new RegExp(LUNAZL_FIREBASE_DATABASE_URL.replaceAll(".", "\\.")));
    assert.doesNotMatch(text, /[?&]auth=/);
    const rules = JSON.parse(
      readFileSync(new URL("../../firebase/database.rules.json", import.meta.url), "utf8"),
    ) as { rules: { ".read": boolean; ".write": boolean } };
    assert.equal(rules.rules[".read"], false);
    assert.equal(rules.rules[".write"], false);
  });
});
