import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SOD_ROLES } from "./policy.ts";
import { DRILL_IDS, SCORE_FIELDS, assessOperations, evidenceDigest, summarizeOperations } from "./operations.ts";

const SECRET = "sk-notarealkey123456";
const PUBLIC = "https://ops.example.test/app";
const NOW = "2026-10-16T06:00:00.000Z";
const LATER = "2027-01-01T00:00:00.000Z";

const OWNERS = Object.fromEntries(SOD_ROLES.map((role) => [role, `handle-${role}`]));

function localEvidence(fields: readonly string[] = SCORE_FIELDS) {
  return fields.map((field) => ({
    field,
    sourceType: "owner-record" as const,
    body: `record-${field}`,
    expiresAt: LATER,
    digest: evidenceDigest(field, "owner-record", `record-${field}`),
  }));
}

describe("phase 12 operations", () => {
  it("hashes evidence with sha256 and does not invent a shared owner", () => {
    assert.equal(
      evidenceDigest("budget", "owner-record", "abc"),
      "73c10ae6d4b155c355bf4cea1a9b851a62de8a0b363947f017c01dbc36b0e3e6",
    );
    const empty = assessOperations();
    assert.equal(empty.decision, "NO-GO");
    assert.equal(empty.authorization, "not-granted");
    assert.equal(empty.posture, "blocked");
    assert.equal(empty.evidenceScore, 0);
    assert.equal(empty.goEligible, false);
    assert.equal(empty.fakeSignOffAccepted, false);
    assert.equal(empty.networkCalls, 0);
    assert.equal(empty.alertsSent, 0);
    assert.equal(empty.productionDeployed, false);
    assert.equal(empty.executed, false);
    for (const role of SOD_ROLES) {
      assert.equal(empty.checklist.find((row) => row.id === `role:${role}`)?.ok, false, role);
    }
    assert.equal(empty.checklist.find((row) => row.id === "owner-collision")?.ok, true);
    assert.equal(empty.checklist.find((row) => row.id === "evidence:budget")?.ok, false);
    assert.equal(empty.registry.find((row) => row.field === "backup")?.status, "missing");
    assert.equal(empty.compliance.find((row) => row.id === "backup")?.ok, false);
    assert.equal(empty.compliance.find((row) => row.id === "production-health")?.ok, false);
    assert.equal(empty.compliance.find((row) => row.id === "production-alerting")?.ok, false);
    assert.equal(empty.compliance.find((row) => row.id === "license")?.ok, false);
    assert.deepEqual(
      empty.drills.map((row) => row.id),
      [...DRILL_IDS],
    );
    assert.equal(empty.drills.every((row) => row.network === false && row.realData === false && row.applied === false), true);
    assert.equal(empty.risks[0]?.id, "production-lock");
    assert.equal(empty.risks[0]?.bypassesProduction, false);
    assert.equal(summarizeOperations(empty).decision, "NO-GO");
    assert.match(readFileSync("docs/OPERATIONS.md", "utf8"), /NO-GO/);
    assert.match(readFileSync("docs/OPERATIONS.md", "utf8"), /không chấp nhận cờ/);
  });

  it("rejects tampered, missing, and expired evidence without echoing the body", () => {
    const report = assessOperations({
      now: NOW,
      evidence: [
        {
          field: "budget",
          sourceType: "local-file",
          body: "record-budget",
          digest: "0".repeat(64),
        },
        {
          field: "security-approval",
          sourceType: "owner-record",
          body: "record-security",
          expiresAt: "2020-01-01T00:00:00.000Z",
        },
        { field: "legal-privacy", sourceType: "owner-record", body: "true" },
        { field: "stray", body: SECRET },
      ],
    });
    assert.equal(report.registry.find((row) => row.field === "budget")?.status, "tampered");
    assert.equal(report.registry.find((row) => row.field === "security-approval")?.status, "expired");
    assert.equal(report.registry.find((row) => row.field === "legal-privacy")?.status, "rejected");
    assert.equal(report.registry.find((row) => row.field === "artifact")?.status, "missing");
    assert.equal(report.registry.some((row) => row.field === "stray"), false);
    const body = JSON.stringify(report);
    assert.equal(body.includes("record-budget"), false);
    assert.equal(body.includes("record-security"), false);
    assert.equal(body.includes(SECRET), false);
  });

  it("blocks owner collision, fake sign-off, live bypass, and accidental network", async () => {
    let calls = 0;
    const report = assessOperations({
      now: NOW,
      env: {
        LUNA_BUDGET_CONFIRMED: "true",
        LUNA_STAGING_CONFIRMED: "yes",
        LUNA_PRODUCTION_URL: PUBLIC,
        FIREBASE_LIVE_ENABLED: "true",
        LUNA_BROWSER_LAUNCH: "true",
      },
      owners: Object.fromEntries(SOD_ROLES.map((role) => [role, role === "credential-owner" ? SECRET : "same-operator"])),
      evidence: localEvidence(),
      fetchImpl: async () => {
        calls += 1;
        return "called";
      },
      redactionSample: `token=${SECRET}`,
    });
    assert.equal(calls, 0);
    assert.equal(report.networkCalls, 0);
    assert.equal(report.live.firebase, false);
    assert.equal(report.live.browserLaunch, false);
    assert.equal(report.fakeSignOffAccepted, false);
    assert.equal(report.checklist.find((row) => row.id === "fake-sign-off")?.ok, false);
    assert.equal(report.checklist.find((row) => row.id === "owner-collision")?.ok, false);
    assert.equal(report.checklist.find((row) => row.id === "role:credential-owner")?.ok, false);
    assert.equal(report.compliance.find((row) => row.id === "live-flags")?.ok, false);
    assert.equal(report.compliance.find((row) => row.id === "public-endpoint")?.ok, false);
    assert.equal(report.compliance.find((row) => row.id === "browser-launch")?.ok, false);
    assert.equal(report.audit.find((row) => row.action === "live.bypass")?.outcome, "blocked");
    assert.equal(report.audit.find((row) => row.action === "deploy.production")?.outcome, "blocked");
    const body = JSON.stringify(report);
    assert.equal(body.includes(SECRET), false);
    assert.equal(body.includes(PUBLIC), false);
    assert.equal(body.includes("ops.example"), false);
    assert.equal(body.includes("same-operator"), false);
  });

  it("keeps a complete local file NO-GO and refuses a production risk bypass", () => {
    const report = assessOperations({
      now: NOW,
      owners: OWNERS,
      evidence: localEvidence(),
      rulesDeny: true,
      sbom: { directDependencies: 3, lockfilePresent: true, license: "unspecified" },
      risks: [
        {
          id: "budget-gap",
          scope: "local",
          requester: "person-a",
          approver: "person-a",
          expiresAt: LATER,
          evidenceRef: "record-risk",
        },
        {
          id: "open-prod",
          scope: "production",
          requester: "person-a",
          approver: "person-b",
          expiresAt: LATER,
          evidenceRef: "record-risk",
          bypassProduction: true,
        },
        {
          scope: "local",
          requester: "person-a",
          approver: "person-b",
          expiresAt: LATER,
          evidenceRef: "record-risk",
        },
      ],
    });
    assert.equal(report.evidenceScore, 100);
    assert.equal(report.posture, "recorded");
    assert.equal(report.decision, "NO-GO");
    assert.equal(report.authorization, "not-granted");
    assert.equal(report.goEligible, false);
    assert.equal(report.productionDeployed, false);
    assert.equal(report.compliance.find((row) => row.id === "license")?.ok, false);
    assert.equal(report.compliance.find((row) => row.id === "policy-gate")?.ok, true);
    assert.equal(report.compliance.find((row) => row.id === "owner-separation")?.ok, true);
    assert.equal(report.compliance.find((row) => row.id === "production-health")?.ok, false);
    assert.equal(report.compliance.find((row) => row.id === "production-alerting")?.ok, false);
    assert.equal(report.registry.find((row) => row.field === "budget")?.digest, evidenceDigest("budget", "owner-record", "record-budget"));
    assert.equal(report.risks.find((row) => row.id === "budget-gap")?.status, "rejected");
    assert.equal(report.risks.find((row) => row.id === "open-prod")?.status, "rejected");
    assert.equal(report.risks.find((row) => row.id === "open-prod")?.bypassesProduction, false);
    assert.equal(report.risks.find((row) => row.status === "accepted")?.bypassesProduction, false);
    assert.equal(report.audit.find((row) => row.action === "ops.decide")?.outcome, "recorded");
    assert.equal(report.audit.every((row) => row.dryRun && row.network === false), true);
    const body = JSON.stringify(report);
    assert.equal(body.includes("handle-requester"), false);
    assert.equal(body.includes("person-a"), false);
    assert.equal(body.includes("record-budget"), false);
    assert.ok(report.goConditions.length >= 5);
  });
});
