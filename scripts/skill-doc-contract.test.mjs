import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ogSkillContract } from "./skill-doc-contract.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("only an absent unconfigured optional upstream skill is skipped", (t) => {
  const root = mkdtempSync(join(tmpdir(), "luna-skill-contract-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.match(ogSkillContract(root, {}).skip, /not shipped/);
  assert.equal(ogSkillContract(root, { LUNA_REQUIRE_OG_SKILL: "1" }).skip, false);
  assert.equal(ogSkillContract(root, { LUNA_OG_SKILL_DIR: "missing-upstream" }).skip, false);
});

test("present or partial upstream directories keep assertions enabled", (t) => {
  const root = mkdtempSync(join(tmpdir(), "luna-skill-contract-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".grok/skills/og"), { recursive: true });
  // No fake SKILL.md: missing contents must fail the actual documentation assertions.
  assert.equal(ogSkillContract(root, {}).skip, false);
  mkdirSync(join(root, "upstream"));
  assert.equal(ogSkillContract(root, { LUNA_OG_SKILL_DIR: "upstream" }).skip, false);
  writeFileSync(join(root, "not-a-directory"), "");
  assert.throws(() => ogSkillContract(root, { LUNA_OG_SKILL_DIR: "not-a-directory" }), /directory/);
});

test("configured missing or incomplete upstream docs fail actual contracts while tracked docs still run", (t) => {
  const root = mkdtempSync(join(tmpdir(), "luna-skill-contract-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const partial = join(root, "partial");
  mkdirSync(partial);
  for (const dir of [join(root, "missing"), partial]) {
    const env = { ...process.env, LUNA_OG_SKILL_DIR: dir, LUNA_REQUIRE_OG_SKILL: "1" };
    delete env.NODE_TEST_CONTEXT; // Launch a real independent runner, not an inherited test worker.
    const run = spawnSync(process.execPath, ["--test", "scripts/brand-check.test.mjs", "scripts/write-atomic.test.mjs"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env,
      encoding: "utf8",
    });
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stdout, /ENOENT/);
    assert.match(run.stdout, /^ok \d+ - tracked AGENTS\.md names/m);
    assert.match(run.stdout, /# skipped 0/);
  }
});
