import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { rulesDenyByDefault, scanText, type SecurityFinding } from "./security.ts";

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
const findings: SecurityFinding[] = [];

function skipFile(path: string): boolean {
  return path.endsWith(".test.ts") || path.endsWith(".test.mjs") || path.endsWith(".test.tsx");
}

function walk(dir: string, out: string[]): void {
  let entries: string[] = [];
  try {
    if (lstatSync(dir).isSymbolicLink()) {
      findings.push({ severity: "high", path: dir, rule: "scan-symlink-not-followed" });
      return;
    }
    entries = readdirSync(dir);
  } catch {
    findings.push({ severity: "high", path: dir, rule: "scan-unreadable" });
    return;
  }
  for (const entry of entries) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) findings.push({ severity: "high", path, rule: "scan-symlink-not-followed" });
    else if (stat.isDirectory()) walk(path, out);
    else if (!skipFile(path)) out.push(path);
  }
}

const paths: string[] = [];
for (const root of ROOTS) walk(root, paths);
for (const file of FILES) paths.push(file);

try {
  if (lstatSync("firebase").isSymbolicLink() || lstatSync("firebase/database.rules.json").isSymbolicLink()) {
    throw new Error("Rules proof must not follow a symlink.");
  }
  if (!rulesDenyByDefault(JSON.parse(readFileSync("firebase/database.rules.json", "utf8")))) {
    findings.push({ severity: "critical", path: "firebase/database.rules.json", rule: "firebase-rules-not-deny-all" });
  }
} catch {
  findings.push({ severity: "critical", path: "firebase/database.rules.json", rule: "firebase-rules-unreadable" });
}
for (const path of paths) {
  let text = "";
  try {
    if (lstatSync(path).isSymbolicLink()) {
      findings.push({ severity: "high", path, rule: "scan-symlink-not-followed" });
      continue;
    }
    text = readFileSync(path, "utf8");
  } catch {
    findings.push({ severity: "high", path, rule: "scan-unreadable" });
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
