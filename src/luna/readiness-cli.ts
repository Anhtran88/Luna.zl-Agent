import { readFileSync } from "node:fs";
import { assessReadiness } from "./readiness.ts";
import { rulesDenyByDefault } from "./security.ts";

const rules = JSON.parse(readFileSync("firebase/database.rules.json", "utf8"));
const report = assessReadiness({ env: process.env });
const rulesOk = rulesDenyByDefault(rules);
process.stdout.write(
  `${JSON.stringify({ ...report, rulesDeny: rulesOk, decision: rulesOk ? report.decision : "NO-GO" }, null, 2)}\n`,
);
process.exit(report.decision === "NO-GO" && rulesOk ? 0 : 1);
