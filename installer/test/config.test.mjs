import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSetupInput, validateLocalPort, validateOpenAIKey } from "../src/config.mjs";

const digest = "a".repeat(64);
const valid = {
  openaiApiKey: "sk-test",
  googleClientId: "client.apps.googleusercontent.com",
  googleClientSecret: "secret",
  frontendPort: "3000",
  backendImage: `ghcr.io/humble-builder/profile-pilot-backend@sha256:${digest}`,
  frontendImage: `ghcr.io/humble-builder/profile-pilot-frontend@sha256:${digest}`,
  mongoImage: `mongo@sha256:${digest}`,
};

test("normalizes a valid release setup without accepting an admin email", () => {
  const config = normalizeSetupInput({ ...valid, adminEmail: "attacker@example.com" });
  assert.equal(config.frontendPort, 3000);
  assert.equal("adminEmail" in config, false);
});

test("rejects mutable or unapproved release images", () => {
  assert.throws(
    () => normalizeSetupInput({ ...valid, backendImage: "profilepilot-backend:latest" }),
    /digest-pinned/,
  );
});

test("OpenAI validation uses a read-only models request", async () => {
  let request;
  await validateOpenAIKey("sk-test", {
    fetchImpl: async (...args) => {
      request = args;
      return { ok: true, status: 200 };
    },
  });
  assert.equal(request[0], "https://api.openai.com/v1/models");
  assert.equal(request[1].headers.Authorization, "Bearer sk-test");
});

test("reports a rejected OpenAI key", async () => {
  await assert.rejects(
    validateOpenAIKey("bad", { fetchImpl: async () => ({ ok: false, status: 401 }) }),
    /HTTP 401/,
  );
});

test("port preflight reports a port that is already bound", async () => {
  const net = await import("node:net");
  const occupied = net.createServer();
  await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  const { port } = occupied.address();
  await assert.rejects(validateLocalPort(port), /already in use/);
  await new Promise((resolve) => occupied.close(resolve));
});
