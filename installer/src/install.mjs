import { access, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { buildEnvironment } from "./env.mjs";

// Fresh setup is transactional: a temporary env drives Compose and becomes the
// durable .env only after both application services report healthy.

async function exists(file) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function createCommandRunner({ executable = process.env.PROFILEPILOT_DOCKER || "docker" } = {}) {
  return (args, { cwd, quiet = false } = {}) => new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `${executable} ${args.join(" ")} failed (${code}).`));
    });
  });
}

export async function assertFreshInstall(rootDir, run) {
  if (await exists(path.join(rootDir, ".env"))) {
    throw new Error("ProfilePilot is already configured. Fresh setup cannot register another admin.");
  }
  if (await exists(path.join(rootDir, ".env.installing"))) {
    throw new Error("An incomplete setup needs recovery. Resolve .env.installing before starting fresh setup.");
  }
  await run(["version", "--format", "{{.Server.Version}}"], { cwd: rootDir, quiet: true });
  await run(["compose", "version"], { cwd: rootDir, quiet: true });

  try {
    await run(["volume", "inspect", "profilepilot_mongo_data"], { cwd: rootDir, quiet: true });
    throw new Error("Existing ProfilePilot data was detected. Fresh setup is blocked to protect it.");
  } catch (error) {
    if (/Existing ProfilePilot data/.test(error.message)) throw error;
  }
}

function composePrefix({ development, envFile }) {
  const args = ["compose", "--env-file", envFile, "-f", "compose.yaml"];
  if (development) args.push("-f", "compose.dev.yaml");
  return args;
}

export async function installProfilePilot({
  rootDir,
  config,
  verifiedEmail,
  development = false,
  run = createCommandRunner(),
}) {
  await assertFreshInstall(rootDir, run);
  const finalEnv = path.join(rootDir, ".env");
  const temporaryEnv = path.join(rootDir, ".env.installing");
  const prefix = composePrefix({ development, envFile: temporaryEnv });
  await writeFile(temporaryEnv, buildEnvironment(config, verifiedEmail), { flag: "wx", mode: 0o600 });

  try {
    if (!development) await run([...prefix, "pull"], { cwd: rootDir });
    await run([
      ...prefix, "up", "-d", "--wait", "--wait-timeout", "180",
      ...(development ? ["--build"] : []),
    ], { cwd: rootDir });
    await rename(temporaryEnv, finalEnv);
  } catch (error) {
    let cleanupError;
    try {
      await run([...prefix, "down", "--volumes", "--remove-orphans"], { cwd: rootDir, quiet: true });
    } catch (caught) {
      cleanupError = caught;
    }
    if (cleanupError) {
      throw new Error(`Installation failed and cleanup could not be confirmed: ${error.message}; ${cleanupError.message}`);
    }
    await rm(temporaryEnv, { force: true });
    throw new Error(`Installation failed and was rolled back: ${error.message}`);
  }
}

export async function readReleaseManifest(file) {
  const manifest = JSON.parse(await readFile(file, "utf8"));
  return {
    backendImage: manifest.backendImage,
    frontendImage: manifest.frontendImage,
    mongoImage: manifest.mongoImage,
  };
}
