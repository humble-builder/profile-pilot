import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertFreshInstall, installProfilePilot } from "../src/install.mjs";

const config = {
  openaiApiKey: "sk-test",
  tavilyApiKey: "",
  googleClientId: "google-id",
  googleClientSecret: "google-secret",
  frontendPort: 3000,
  images: { backend: "", frontend: "", mongo: "" },
};

function successfulRunner(calls, { failStart = false, failCleanup = false } = {}) {
  return async (args) => {
    calls.push(args);
    if (args[0] === "volume" && args[1] === "inspect") throw new Error("not found");
    if (failStart && args.includes("up") && args.includes("-d")) throw new Error("start failed");
    if (failCleanup && args.includes("down")) throw new Error("cleanup failed");
    return { stdout: "", stderr: "" };
  };
}

test("fresh installation commits env only after Compose succeeds", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "profilepilot-installer-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const calls = [];
  await installProfilePilot({
    rootDir, config, verifiedEmail: "verified@example.com", development: true, run: successfulRunner(calls),
  });
  const env = await readFile(path.join(rootDir, ".env"), "utf8");
  assert.match(env, /^ADMIN_EMAIL=verified@example\.com$/m);
  assert.ok(calls.some((args) => args.includes("--wait")));
  assert.equal(calls.filter((args) => args.includes("up")).length, 1);
});

test("failed installation removes temporary configuration and rolls back", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "profilepilot-installer-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const calls = [];
  await assert.rejects(installProfilePilot({
    rootDir, config, verifiedEmail: "verified@example.com", development: true,
    run: successfulRunner(calls, { failStart: true }),
  }), /rolled back/);
  await assert.rejects(readFile(path.join(rootDir, ".env.installing")), /ENOENT/);
  assert.ok(calls.some((args) => args.includes("down") && args.includes("--volumes")));
});

test("existing config blocks second-admin registration", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "profilepilot-installer-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  await writeFile(path.join(rootDir, ".env"), "ADMIN_EMAIL=existing@example.com\n");
  await assert.rejects(assertFreshInstall(rootDir, async () => {}), /already configured/);
});

test("an unresolved installation marker blocks a new setup", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "profilepilot-installer-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  await writeFile(path.join(rootDir, ".env.installing"), "recovery=true\n");
  await assert.rejects(assertFreshInstall(rootDir, async () => {}), /needs recovery/);
});

test("failed cleanup preserves recovery configuration and reports uncertainty", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "profilepilot-installer-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  await assert.rejects(installProfilePilot({
    rootDir, config, verifiedEmail: "verified@example.com", development: true,
    run: successfulRunner([], { failStart: true, failCleanup: true }),
  }), /cleanup could not be confirmed/);
  assert.match(await readFile(path.join(rootDir, ".env.installing"), "utf8"), /ADMIN_EMAIL=verified@example\.com/);
});
