import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const url = new URL(process.env.LUNA_E2E_URL ?? "http://127.0.0.1:8080/");
assert.ok(
  url.protocol === "http:" &&
    url.hostname === "127.0.0.1" &&
    ["8080", "8081"].includes(url.port) &&
    url.pathname === "/" &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash,
  "E2E accepts only the local Luna dev/built endpoints.",
);
const executable =
  process.env.AGENT_BROWSER_EXECUTABLE_PATH ??
  ["/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync);
assert.ok(
  executable,
  "Install Chromium or set AGENT_BROWSER_EXECUTABLE_PATH before running local E2E.",
);
const socketDir = mkdtempSync(join(tmpdir(), "luna-e2e-"));
const artifacts = join(
  root.startsWith("/workspace/") ? "/workspace" : root,
  "screenshots",
  `e2e-${url.port}`,
);
mkdirSync(artifacts, { recursive: true });
const session = `luna-e2e-${randomUUID().slice(0, 8)}`;
const execute = promisify(execFile);
const cli = join(root, "node_modules", ".bin", "agent-browser");
const checks = [];
let lastCommand = "startup";
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith("AGENT_BROWSER_")) delete env[key];
env.AGENT_BROWSER_SOCKET_DIR = socketDir;
const browserConfig = join(socketDir, "config.json");
writeFileSync(browserConfig, "{}"); // No inherited profiles, saved auth, providers, or restore state.
async function browser(...args) {
  lastCommand = args.join(" ");
  const { stdout } = await execute(
    cli,
    ["--config", browserConfig, "--session", session, "--json", ...args],
    { cwd: root, env, timeout: 35_000, maxBuffer: 2_000_000 },
  );
  const response = JSON.parse(stdout);
  assert.equal(response.success, true, response.error ?? args[0]);
  return response.data;
}
const click = (name) => browser("find", "role", "button", "click", "--name", name, "--exact");
const wait = (expression) => browser("wait", "--fn", expression);
const read = async (expression) => (await browser("eval", expression)).result;
const detail = 'document.querySelector("[data-testid=task-detail]")';
const disabled = (name) =>
  `Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()===${JSON.stringify(name)})?.disabled === true`;

try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(1000) });
      ready = response.ok && (await response.text()).includes("Luna · Phase 12");
    } catch {
      /* Startup may still be compiling. */
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, "Start the local dev server or built preview before running E2E.");
  const authResponse = await fetch(new URL("/api/auth/get-session", url), {
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(
    authResponse.status,
    503,
    "Default local environment must not enable live authentication.",
  );
  assert.equal((await authResponse.json()).code, "AUTH_DISABLED");
  await browser(
    "--executable-path",
    executable,
    "--args",
    "--no-sandbox",
    "--allowed-domains",
    "127.0.0.1",
    "open",
    url.href,
  );
  await wait('document.querySelector("[data-luna-ready=true]") !== null');
  await browser("open", new URL("/login", url).href);
  await wait('document.body.innerText.includes("Đăng nhập chưa được chủ môi trường cấu hình")');
  for (const [name, width, height] of [
    ["desktop", 1280, 800],
    ["mobile", 390, 844],
  ]) {
    await browser("set", "viewport", String(width), String(height));
    await browser("screenshot", join(artifacts, `login-${name}.png`));
  }
  await browser("open", url.href);
  await wait('document.querySelector("[data-luna-ready=true]") !== null');
  for (const [viewport, width, height] of [
    ["desktop", 1280, 800],
    ["mobile", 390, 844],
  ]) {
    await browser("set", "viewport", String(width), String(height));
    for (const decision of ["approval-denied", "reject-denied", "execute-denied"]) {
      const marker = `E2E-${randomUUID().slice(0, 8)}`;
      const safe = decision === "execute-denied";
      await browser(
        "fill",
        "#goal",
        `${marker}: ${safe ? "Tóm tắt bằng model mock." : "Ghi Firebase bằng mô phỏng, không gọi mạng."}`,
      );
      await click("Tạo tác vụ");
      await wait(
        `${detail}?.dataset.taskStatus === "draft" && ${detail}?.textContent.includes(${JSON.stringify(marker)})`,
      );
      const taskId = await read(`${detail}.dataset.taskId`);
      await click("Lập kế hoạch");
      const plannedStatus = safe ? "planned" : "awaiting_approval";
      await wait(`${detail}?.dataset.taskStatus === ${JSON.stringify(plannedStatus)}`);
      if (!safe) assert.equal(await read(disabled("Chạy dry-run")), true);
      await click(
        safe ? "Chạy dry-run" : decision === "approval-denied" ? "Duyệt dry-run" : "Từ chối",
      );
      await wait('document.body.innerText.includes("Chưa có xác thực operator đáng tin cậy")');
      assert.equal(
        await read(`${detail}.dataset.taskStatus`),
        plannedStatus,
        "Denied commands must not change task state.",
      );
      await click("Hủy");
      await wait(`${detail}?.dataset.taskStatus === "cancelled"`);
      assert.equal(await read(disabled("Chạy dry-run")), true);
      assert.equal(
        await read(
          'Array.from(document.querySelectorAll("button")).some(b => ["Duyệt dry-run", "Từ chối"].includes(b.textContent.trim()))',
        ),
        false,
      );
      const actions = await read(
        `Array.from(document.querySelectorAll("[data-audit-action]")).filter(e=>e.dataset.taskId===${JSON.stringify(taskId)}).map(e=>e.dataset.auditAction)`,
      );
      for (const action of ["task.create", "task.plan", "task.cancel"])
        assert.ok(actions.includes(action), `Missing ${action} audit for this task.`);
      assert.ok(
        !actions.some((action) => action === "task.execute" || action.startsWith("approval.")),
        "Denied calls must not produce success audit.",
      );
      // Browser reload retains server memory in this process, not durable restart storage.
      await browser("reload");
      await wait('document.querySelector("[data-luna-ready=true]") !== null');
      await wait(
        `${detail}?.dataset.taskId === ${JSON.stringify(taskId)} && ${detail}?.dataset.taskStatus === "cancelled"`,
      );
      const auditCount = await read(
        `Array.from(document.querySelectorAll("[data-audit-action]")).filter(e=>e.dataset.taskId===${JSON.stringify(taskId)}).length`,
      );
      assert.equal(auditCount, actions.length);
      assert.equal(
        await read(
          'document.body.innerText.includes("NO-GO") && document.body.innerText.includes("launch off")',
        ),
        true,
      );
      checks.push({ viewport, decision, auditVerified: true, reloadVerified: true, live: false });
    }
    assert.equal(
      await read("document.documentElement.scrollWidth > window.innerWidth"),
      false,
      "Horizontal overflow",
    );
    await browser("scrollintoview", "[data-testid=task-detail]");
    await browser("screenshot", join(artifacts, `${viewport}.png`));
  }
  const errors = await browser("errors");
  assert.ok(Array.isArray(errors.errors), "Browser must report its uncaught-error collection.");
  assert.deepEqual(errors.errors, [], "Uncaught app errors");
  const verdict = {
    ok: true,
    target: url.port === "8080" ? "dev" : "built",
    checks,
    externalDomainsAllowed: false,
  };
  writeFileSync(join(artifacts, "verdict.json"), `${JSON.stringify(verdict, null, 2)}\n`);
  console.log(JSON.stringify(verdict));
} catch (error) {
  const failure = {
    ok: false,
    target: url.port === "8080" ? "dev" : "built",
    message: String(error.message),
    command: lastCommand,
    completedChecks: checks,
    stdout: error.stdout,
    stderr: error.stderr,
  };
  try {
    failure.snapshot = await browser("snapshot");
    failure.errors = await browser("errors");
    await browser("screenshot", join(artifacts, "failure.png"), "--full");
  } catch (captureError) {
    failure.captureError = String(captureError.message);
  }
  writeFileSync(join(artifacts, "verdict.json"), `${JSON.stringify(failure, null, 2)}\n`);
  if (process.env.GITHUB_ACTIONS === "true") {
    const diagnostic = JSON.stringify(failure)
      .slice(0, 12000)
      .replaceAll("%", "%25")
      .replaceAll("\r", "%0D")
      .replaceAll("\n", "%0A");
    console.error(`::error title=Local UI E2E failure::${diagnostic}`);
  }
  throw error;
} finally {
  try {
    await browser("close");
  } finally {
    rmSync(socketDir, { recursive: true, force: true });
  }
}
