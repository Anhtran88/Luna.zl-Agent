import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { scanText, type SecurityFinding } from "./security.ts";

const ROOTS = ["src", "server", "scripts", "docs", "firebase", "config", ".github"];
const FILES = [
  "README.md",
  "ARCHITECTURE.md",
  "AGENTS.md",
  "package.json",
  "vercel.json",
  ".env.example",
];
const SKIP = new Set(["node_modules", "dist", ".vercel", ".git", "screenshots", ".output"]);

function skipFile(path: string): boolean {
  return path.endsWith(".test.ts") || path.endsWith(".test.mjs") || path.endsWith(".test.tsx");
}

function walk(dir: string, out: string[]): void {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else if (!skipFile(path)) out.push(path);
  }
}

const paths: string[] = [];
for (const root of ROOTS) walk(root, paths);
for (const file of FILES) paths.push(file);

const findings: SecurityFinding[] = [];
for (const path of paths) {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  findings.push(...scanText(path, text));
}

const audit = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
if (audit.status === 0) {
  findings.push({ severity: "info", path: "package.json", rule: "npm-audit-clean" });
} else {
  findings.push({ severity: "high", path: "package.json", rule: "npm-audit-findings" });
}

const blocking = findings.filter((finding) => finding.severity === "critical" || finding.severity === "high");
process.stdout.write(`${JSON.stringify({ ok: blocking.length === 0, findings }, null, 2)}\n`);
process.exit(blocking.length === 0 ? 0 : 1);
