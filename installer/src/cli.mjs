import path from "node:path";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createSetupServer } from "./server.mjs";
import { assertFreshInstall, createCommandRunner, installProfilePilot, readReleaseManifest } from "./install.mjs";

if (Number(process.versions.node.split(".")[0]) < 24) {
  throw new Error("ProfilePilot installer source requires Node.js 24 or newer.");
}

const installerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(installerDir, "..");
const development = process.argv.includes("--dev");
const manifestFlag = process.argv.indexOf("--manifest");
const manifestPath = manifestFlag >= 0 ? path.resolve(process.argv[manifestFlag + 1]) : path.join(installerDir, "release-manifest.json");
const run = createCommandRunner();

function openBrowser(url) {
  const commands = {
    win32: ["cmd", ["/c", "start", "", url]],
    darwin: ["open", [url]],
    linux: ["xdg-open", [url]],
  };
  const [command, args] = commands[process.platform] ?? [];
  if (!command) return;
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {});
  child.unref();
}

await assertFreshInstall(rootDir, run);
let releaseImages = {};
if (!development) {
  await access(manifestPath);
  releaseImages = await readReleaseManifest(manifestPath);
}

const server = createSetupServer({
  rootDir,
  releaseImages,
  development,
  install: (options) => installProfilePilot({ ...options, run }),
});

server.listen(48731, "127.0.0.1", () => {
  const setupUrl = "http://127.0.0.1:48731";
  console.log(`ProfilePilot setup is ready at ${setupUrl}`);
  console.log("Press Ctrl+C to cancel. No installation state is written before confirmation.");
  if (!process.argv.includes("--no-open")) openBrowser(setupUrl);
});
