import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LunaControlPlane } from "./control-plane.ts";
import { fixedClock, sequenceIds } from "./domain.ts";
import { dryRunDeploy } from "./deploy.ts";
import { TASK_PRESETS } from "./presets.ts";
import {
  LocalRateLimiter,
  containsSecret,
  SECURITY_HEADERS,
  SECURITY_POSTURE,
  SESSION_COOKIE_POSTURE,
  evaluateLiveGate,
  parseCreateTaskInput,
  preflightAudit,
  redactAuditDetail,
  rulesDenyByDefault,
  sanitizePublicMessage,
  scanText,
} from "./security.ts";

const PEM = `-----BEGIN PRIVATE KEY-----\n${"A".repeat(40)}\n-----END PRIVATE KEY-----`;
const API_KEY = "sk-notarealkey123456";

describe("phase 6 security", () => {
  it("detects and fully redacts JSON credentials, scoped API keys, GitHub tokens, and private paths", () => {
    const cases = [
      { text: JSON.stringify({ password: "synthetic pass with spaces" }), hidden: "synthetic pass with spaces" },
      { text: JSON.stringify({ token: "synthetic-token-value" }), hidden: "synthetic-token-value" },
      { text: "api_key='synthetic pass with spaces'", hidden: "synthetic pass with spaces" },
      { text: "sk-proj-SYNTHETIC_NOT_A_REAL_KEY_0123456789", hidden: "SYNTHETIC_NOT_A_REAL_KEY_0123456789" },
      { text: "ghp_SYNTHETICNOTAREALTOKEN0123456789", hidden: "SYNTHETICNOTAREALTOKEN0123456789" },
      { text: "/Users/SYNTHETIC_FIXTURE/OneDrive/private.pdf", hidden: "SYNTHETIC_FIXTURE" },
      { text: JSON.stringify({ path: "C:\\Users\\SYNTHETIC_FIXTURE\\OneDrive\\private.pdf" }), hidden: "SYNTHETIC_FIXTURE" },
      { text: "https://synthetic-user:synthetic-pass@example.invalid/path", hidden: "synthetic-pass" },
    ];
    for (const { text, hidden } of cases) {
      assert.equal(containsSecret(text), true);
      assert.equal(redactAuditDetail(text).includes(hidden), false);
      assert.equal(sanitizePublicMessage(text).includes(hidden), false);
      assert.ok(scanText("fixture.json", text).some((finding) => finding.severity === "high"));
    }
    assert.throws(() => parseCreateTaskInput({ goal: JSON.stringify({ password: "synthetic-pass" }) }));
    assert.ok(scanText("config/production.env.example", "NINE_ROUTER_API_KEY=SYNTHETIC_VALUE").some((row) => row.rule === "populated-secret-template"));
    assert.ok(scanText("config/trusted-runtime.env.example", "LUNA_DATABASE_URL=SYNTHETIC_VALUE").some((row) => row.rule === "populated-secret-template"));
    assert.ok(scanText("config/trusted-runtime.env.example", "DATABASE_URL=SYNTHETIC_VALUE").some((row) => row.rule === "populated-secret-template"));
    assert.equal(containsSecret("URL public, không phải secret:\n\n`https://example.invalid`"), false);
    assert.equal(containsSecret('{"password":\n"synthetic-pass"}'), true);
  });
  it("detects secrets and url credentials without returning the value", () => {
    const findings = scanText("fixture.txt", `${PEM}\n${API_KEY}\nhttps://user:secret@evil.example/path?token=abc`);
    assert.ok(findings.some((finding) => finding.rule === "private-key" && finding.severity === "critical"));
    assert.ok(findings.some((finding) => finding.rule === "api-key" && finding.severity === "high"));
    assert.ok(findings.some((finding) => finding.rule === "url-userinfo"));
    assert.equal(JSON.stringify(findings).includes(API_KEY), false);
    assert.equal(JSON.stringify(findings).includes("AAAA"), false);
    assert.equal(JSON.stringify(findings).includes("secret"), false);
  });

  it("keeps Firebase rules deny-by-default, including a nested grant", () => {
    const rules = JSON.parse(readFileSync(new URL("../../firebase/database.rules.json", import.meta.url), "utf8"));
    assert.equal(rulesDenyByDefault(rules), true);
    assert.equal(
      rulesDenyByDefault({ rules: { ".read": false, ".write": false, luna: { ".read": true, ".write": false } } }),
      false,
    );
    assert.equal(rulesDenyByDefault({ rules: { ".read": true, ".write": false } }), false);
  });

  it("rejects production endpoints, live flags, and browser launch", async () => {
    const gate = evaluateLiveGate({
      FIREBASE_LIVE_ENABLED: "true",
      LUNA_ALLOW_LIVE_MODELS: "true",
      LUNA_BROWSER_LAUNCH: "true",
      LUNA_DEPLOY_TARGET: "production",
      LUNA_DEPLOY_PRODUCTION_OPT_IN: "true",
    });
    assert.equal(gate.gate.firebaseLive, false);
    assert.equal(gate.gate.nineRouterLive, false);
    assert.equal(gate.gate.browserLaunch, false);
    assert.equal(gate.gate.productionDeploy, false);
    assert.ok(gate.violations.includes("firebase-live"));
    assert.ok(gate.violations.includes("browser-launch"));
    assert.equal(SECURITY_POSTURE.liveEnabled, false);

    let calls = 0;
    const report = await dryRunDeploy({
      env: {
        LUNA_DEPLOY_TARGET: "production",
        LUNA_PRODUCTION_URL: "https://luna.example",
        FIREBASE_LIVE_ENABLED: "true",
        LUNA_ALLOW_LIVE_MODELS: "true",
      },
      fetchImpl: async () => {
        calls += 1;
        return new Response("no");
      },
    });
    assert.equal(report.ok, false);
    assert.equal(report.productionDeployed, false);
    assert.equal(report.rollback.mutatesProduction, false);
    assert.equal(calls, 0);
    const audit = preflightAudit(report);
    assert.equal(audit[0]?.dryRun, true);
    assert.equal(audit[0]?.outcome, "blocked");
    assert.equal(JSON.stringify(audit).includes("luna.example"), false);
  });

  it("rejects unsafe input and strips secrets from errors and audit", async () => {
    assert.throws(
      () => parseCreateTaskInput({ goal: "gửi tin", mode: "live" }),
      (error: unknown) => error instanceof Error && error.message.includes("không bật"),
    );
    assert.throws(
      () => parseCreateTaskInput({ goal: `làm việc ${API_KEY}` }),
      (error: unknown) => error instanceof Error && !error.message.includes(API_KEY),
    );
    assert.equal(sanitizePublicMessage(`lỗi ${PEM}`).includes("AAAA"), false);
    assert.equal(redactAuditDetail(`cookie=supersecretvalue`).includes("supersecretvalue"), false);

    const plane = LunaControlPlane.createDefault({}, { clock: fixedClock(), ids: sequenceIds() });
    const task = await plane.createTask({ goal: TASK_PRESETS[3].goal });
    await plane.planTask(task.id);
    const approvalId = plane.snapshot().approvals[0]?.id;
    assert.ok(approvalId);
    await plane.decideApproval(approvalId, "rejected", `từ chối ${API_KEY}`);
    const snapshot = plane.snapshot();
    const packed = JSON.stringify(snapshot);
    assert.equal(packed.includes(API_KEY), false);
    assert.equal(snapshot.audit[0]?.dryRun, true);
    assert.equal(snapshot.security.productionDeploy, false);
    assert.equal(snapshot.phaseLock, true);
  });

  it("rate-limits locally and publishes preview-safe headers", () => {
    let now = 1_000;
    const limiter = new LocalRateLimiter(2, 1_000, () => now);
    assert.equal(limiter.decide("operator").allowed, true);
    assert.equal(limiter.decide("operator").allowed, true);
    const blocked = limiter.decide("operator");
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.network, false);
    now = 2_100;
    assert.equal(limiter.decide("operator").allowed, true);
    assert.equal(limiter.decide(API_KEY).allowed, true);

    assert.equal(SECURITY_HEADERS["X-Content-Type-Options"], "nosniff");
    assert.equal(JSON.stringify(SECURITY_HEADERS).includes("frame-ancestors"), false);
    assert.equal("X-Frame-Options" in SECURITY_HEADERS, false);
    assert.equal(SESSION_COOKIE_POSTURE.lunaSetsCookie, false);
    assert.equal(SESSION_COOKIE_POSTURE.logsCookieValue, false);
  });
});
