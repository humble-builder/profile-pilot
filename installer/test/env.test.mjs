import test from "node:test";
import assert from "node:assert/strict";
import { buildEnvironment } from "../src/env.mjs";

const config = {
  openaiApiKey: "sk-test",
  tavilyApiKey: "",
  googleClientId: "google-id",
  googleClientSecret: "google-secret",
  frontendPort: 3000,
  images: { backend: "backend", frontend: "frontend", mongo: "mongo" },
};

test("environment uses the verified identity and generated secrets", () => {
  const output = buildEnvironment(config, "verified@example.com");
  assert.match(output, /^ADMIN_EMAIL=verified@example\.com$/m);
  assert.match(output, /^WEB_SEARCH_ENABLED=false$/m);
  assert.match(output, /^AUTH_SECRET=[A-Za-z0-9_-]{43}$/m);
  assert.match(output, /^ADMIN_API_TOKEN=[A-Za-z0-9_-]{43}$/m);
});

test("environment rejects line injection", () => {
  assert.throws(() => buildEnvironment({ ...config, openaiApiKey: "key\nADMIN_EMAIL=x" }, "verified@example.com"), /line break/);
});
