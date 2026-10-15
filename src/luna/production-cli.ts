import { existsSync, readFileSync } from "node:fs";
import { assessProduction } from "./production-gate.ts";
import { rulesDenyByDefault } from "./security.ts";

const rules = JSON.parse(readFileSync("firebase/database.rules.json", "utf8"));
const rulesDeny = rulesDenyByDefault(rules);
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies?: Record<string, string> };
const report = assessProduction({
  env: process.env,
  rulesDeny,
  sbom: {
    directDependencies: Object.keys(pkg.dependencies ?? {}).length,
    lockfilePresent: existsSync("package-lock.json"),
  },
});
process.stdout.write(
  `${JSON.stringify(
    {
      decision: report.decision,
      authorization: report.authorization,
      signOffComplete: report.signOffComplete,
      blockers: report.blockers.map((item) => ({ id: item.id, severity: item.severity })),
      networkCalls: report.networkCalls,
      productionDeployed: report.productionDeployed,
      estimatedUsd: report.estimatedUsd,
      rulesDeny,
    },
    null,
    2,
  )}\n`,
);
const safe = report.decision === "NO-GO" && report.networkCalls === 0 && report.productionDeployed === false && rulesDeny;
process.exit(safe ? 0 : 1);
