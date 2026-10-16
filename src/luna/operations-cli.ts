import { existsSync, readFileSync } from "node:fs";
import { assessOperations } from "./operations.ts";
import { rulesDenyByDefault } from "./security.ts";

const rules = JSON.parse(readFileSync("firebase/database.rules.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  license?: string;
  dependencies?: Record<string, string>;
};
const report = assessOperations({
  env: process.env,
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
  report.productionDeployed === false;
process.exit(safe ? 0 : 1);
