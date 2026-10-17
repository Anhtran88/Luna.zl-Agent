import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

it("security CLI fails on open rules, JSON secrets, missing scan roots, and symlinks", () => {
  const root = mkdtempSync(join(tmpdir(), "luna-security-cli-"));
  try {
    for (const name of ["src", "server", "scripts", "docs", "firebase", "config", ".github", "bin"]) mkdirSync(join(root, name));
    for (const name of ["README.md", "ARCHITECTURE.md", "AGENTS.md", "package.json", "vercel.json", ".env.example"]) writeFileSync(join(root, name), "{}");
    // Isolate the registry subprocess in this scanner test. security:check runs the real audit separately.
    writeFileSync(join(root, "bin/npm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const rules = join(root, "firebase/database.rules.json");
    writeFileSync(rules, JSON.stringify({ rules: { ".read": false, ".write": false } }));
    const run = () => {
      const child = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./security-cli.ts", import.meta.url))], {
        cwd: root,
        env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}` },
        encoding: "utf8",
      });
      return { status: child.status, report: JSON.parse(child.stdout) as { ok: boolean; findings: Array<{ rule: string }> } };
    };
    assert.equal(run().status, 0);
    writeFileSync(rules, JSON.stringify({ rules: { ".read": true, ".write": false } }));
    const open = run();
    assert.equal(open.status, 1);
    assert.equal(open.report.ok, false);
    assert.ok(open.report.findings.some((row) => row.rule === "firebase-rules-not-deny-all"));
    writeFileSync(rules, JSON.stringify({ rules: { ".read": false, ".write": false } }));
    const secretFile = join(root, "config/fixture.json");
    writeFileSync(secretFile, JSON.stringify({ password: "SYNTHETIC_NOT_A_REAL_SECRET" }));
    const leaked = run();
    assert.equal(leaked.status, 1);
    assert.equal(JSON.stringify(leaked.report).includes("SYNTHETIC_NOT_A_REAL_SECRET"), false);
    rmSync(secretFile);
    rmSync(rules);
    symlinkSync(join(root, "package.json"), rules);
    const linkedRules = run();
    assert.equal(linkedRules.status, 1);
    assert.ok(linkedRules.report.findings.some((row) => row.rule === "firebase-rules-unreadable"));
    rmSync(rules);
    writeFileSync(rules, JSON.stringify({ rules: { ".read": false, ".write": false } }));
    symlinkSync(join(root, "absent-target"), join(root, "config/fixture-link"));
    const link = run();
    assert.equal(link.status, 1);
    assert.ok(link.report.findings.some((row) => row.rule === "scan-symlink-not-followed"));
    rmSync(join(root, "config/fixture-link"));
    rmSync(join(root, "config"), { recursive: true });
    const missing = run();
    assert.equal(missing.status, 1);
    assert.ok(missing.report.findings.some((row) => row.rule === "scan-unreadable"));
    symlinkSync(join(root, "src"), join(root, "config"));
    const linkedRoot = run();
    assert.equal(linkedRoot.status, 1);
    assert.ok(linkedRoot.report.findings.some((row) => row.rule === "scan-symlink-not-followed"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
