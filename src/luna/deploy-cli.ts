import { existsSync, readFileSync } from "node:fs";
import { dryRunDeploy } from "./deploy.ts";

const SCAN = [
  ".env.example",
  "README.md",
  "ARCHITECTURE.md",
  "docs/OPERATIONS.md",
  "docs/SCHEMA.md",
  "firebase/database.rules.json",
  "vercel.json",
];

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

const target = arg("--target");
const health = arg("--health");
const artifact = arg("--artifact");
const env: Record<string, string | undefined> = { ...process.env };
if (target) env.LUNA_DEPLOY_TARGET = target;

const files: Record<string, string> = {};
for (const path of SCAN) {
  if (existsSync(path)) files[path] = readFileSync(path, "utf8");
}

const report = await dryRunDeploy({
  env,
  files,
  healthUrl: health,
  fetchImpl: health ? globalThis.fetch.bind(globalThis) : undefined,
  artifactPresent: artifact ? existsSync(artifact) : undefined,
  artifactLabel: artifact,
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.ok ? 0 : 1);
