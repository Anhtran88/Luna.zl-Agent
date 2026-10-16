import { simulateValidation } from "./validation.ts";

const report = simulateValidation({ env: process.env });
process.stdout.write(
  `${JSON.stringify(
    {
      result: report.result,
      scope: report.scope,
      productionValidated: report.productionValidated,
      productionDeployed: report.productionDeployed,
      productionDecision: report.productionDecision,
      networkCalls: report.networkCalls,
      alertsSent: report.alertsSent,
      telemetry: report.telemetry,
      estimatedUsd: report.estimatedUsd,
      scenarios: report.scenarios.map((item) => ({ id: item.id, status: item.status })),
      unverified: report.unverified,
      acceptance: report.acceptance.map((item) => ({ id: item.id, met: item.met, scope: item.scope })),
    },
    null,
    2,
  )}\n`,
);
const safe =
  report.productionValidated === false &&
  report.productionDeployed === false &&
  report.networkCalls === 0 &&
  report.alertsSent === 0 &&
  report.telemetry === false;
process.exit(safe ? 0 : 1);
