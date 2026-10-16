import { readFileSync } from "node:fs";
import { assessStaging } from "./staging.ts";
import { rulesDenyByDefault } from "./security.ts";

const rules = JSON.parse(readFileSync("firebase/database.rules.json", "utf8"));
const rulesDeny = rulesDenyByDefault(rules);
const report = assessStaging({ env: process.env, rulesDeny });
process.stdout.write(
  `${JSON.stringify(
    {
      decision: report.decision,
      blockers: report.blockers,
      networkDeploy: report.networkDeploy,
      productionDeployed: report.productionDeployed,
      networkCalls: report.networkCalls,
      estimatedUsd: report.estimatedUsd,
      rulesDeny,
    },
    null,
    2,
  )}\n`,
);
process.exit(rulesDeny && report.networkDeploy === false && report.productionDeployed === false ? 0 : 1);
