import { existsSync, readFileSync } from "node:fs";
import { ownerDecisionOwners, summarizeOwnerPolicy } from "./owner-decisions.ts";
import { evaluateGovernance } from "./policy.ts";
import { rulesDenyByDefault } from "./security.ts";

const rules = JSON.parse(readFileSync("firebase/database.rules.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  license?: string;
  dependencies?: Record<string, string>;
};
const ownerPolicy = summarizeOwnerPolicy();
const report = evaluateGovernance({
  env: process.env,
  action: "production",
  owners: ownerDecisionOwners(),
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
      policy: report.policy,
      fakeSignOffAccepted: report.fakeSignOffAccepted,
      ownerCollision: report.checks.find((item) => item.id === "owner-collision")?.ok === false,
      separationOfDuties: "BLOCKED",
      networkCalls: report.networkCalls,
      productionDeployed: report.productionDeployed,
      estimatedUsd: report.estimatedUsd,
      blockers: report.blockers.map((item) => ({ id: item.id, severity: item.severity })),
      findings: report.findings.map((item) => ({ id: item.id, ok: item.ok, severity: item.severity })),
      audit: report.audit.map((item) => ({ action: item.action, outcome: item.outcome, dryRun: item.dryRun })),
      ownerPolicy,
    },
    null,
    2,
  )}\n`,
);
const safe =
  report.decision === "NO-GO" &&
  report.fakeSignOffAccepted === false &&
  report.networkCalls === 0 &&
  report.productionDeployed === false &&
  ownerPolicy.browser.launch === false &&
  ownerPolicy.zaloEoffice.executed === false &&
  ownerPolicy.budget.chargedUsd === 0 &&
  ownerPolicy.staging.probed === false;
process.exit(safe ? 0 : 1);
