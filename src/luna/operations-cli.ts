import { existsSync, readFileSync } from "node:fs";
import { OWNER_ROLE_NAMES, ownerDecisionOwners, summarizeOwnerPolicy } from "./owner-decisions.ts";
import { assessOperations } from "./operations.ts";
import { rulesDenyByDefault } from "./security.ts";

const rules = JSON.parse(readFileSync("firebase/database.rules.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  license?: string;
  dependencies?: Record<string, string>;
};
const ownerPolicy = summarizeOwnerPolicy();
const report = assessOperations({
  env: process.env,
  owners: ownerDecisionOwners(),
  roleNames: OWNER_ROLE_NAMES,
  rulesDeny: rulesDenyByDefault(rules),
  sbom: {
    directDependencies: Object.keys(pkg.dependencies ?? {}).length,
    lockfilePresent: existsSync("package-lock.json"),
    license: typeof pkg.license === "string" ? pkg.license : "unspecified",
  },
});
process.stdout.write(
  `${JSON.stringify(
    {
      decision: report.decision,
      authorization: report.authorization,
      posture: report.posture,
      evidenceScore: report.evidenceScore,
      goEligible: report.goEligible,
      fakeSignOffAccepted: report.fakeSignOffAccepted,
      networkCalls: report.networkCalls,
      alertsSent: report.alertsSent,
      productionDeployed: report.productionDeployed,
      estimatedUsd: report.estimatedUsd,
      blockerCount: report.blockers.length,
      rolesBlocked: report.roles.filter((role) => role.status === "BLOCKED").length,
      ownerCollision: report.roles.length > 0 && report.checklist.find((item) => item.id === "owner-collision")?.ok === false,
      separationOfDuties: "BLOCKED",
      roles: report.roles.map((role) => ({ id: role.id, status: role.status, assignee: role.assignee })),
      blockers: report.blockers.map((item) => ({ id: item.id, severity: item.severity })),
      evidence: report.registry.map((item) => ({
        evidence_id: item.evidence_id,
        field: item.field,
        source_type: item.source_type,
        created_at: item.created_at,
        expires_at: item.expires_at,
        sha256: item.sha256,
        scope: item.scope,
        approval_reference: item.approval_reference,
        status: item.status,
        gate: item.gate,
      })),
      compliance: report.compliance.map((item) => ({ id: item.id, ok: item.ok, severity: item.severity })),
      drills: report.drills.map((item) => ({ id: item.id, status: item.status, network: item.network })),
      goConditions: report.goConditions,
      ownerPolicy,
    },
    null,
    2,
  )}\n`,
);
const safe =
  report.decision === "NO-GO" &&
  report.authorization === "not-granted" &&
  report.goEligible === false &&
  report.fakeSignOffAccepted === false &&
  report.networkCalls === 0 &&
  report.alertsSent === 0 &&
  report.productionDeployed === false &&
  ownerPolicy.budget.chargedUsd === 0 &&
  ownerPolicy.budget.withinCap === true &&
  ownerPolicy.browser.launch === false &&
  ownerPolicy.zaloEoffice.executed === false &&
  ownerPolicy.staging.verified === false &&
  ownerPolicy.staging.probed === false &&
  ownerPolicy.staging.environment === null;
process.exit(safe ? 0 : 1);
