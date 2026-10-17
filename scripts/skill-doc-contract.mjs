import { statSync } from "node:fs";
import { join, resolve } from "node:path";

/** Upstream prompt docs are optional in a standalone app checkout, not generated source. */
export function ogSkillContract(root, env = process.env) {
  const configured = env.LUNA_OG_SKILL_DIR?.trim();
  const dir = configured ? resolve(root, configured) : join(root, ".grok/skills/og");
  let absent = false;
  try {
    if (!statSync(dir).isDirectory()) throw new Error("OG skill path must be a directory.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    absent = true;
  }
  return {
    dir,
    skip: absent && !configured && env.LUNA_REQUIRE_OG_SKILL !== "1"
      ? "Upstream OG skill docs are not shipped in this standalone checkout; use LUNA_OG_SKILL_DIR and LUNA_REQUIRE_OG_SKILL=1 to validate them."
      : false,
  };
}
