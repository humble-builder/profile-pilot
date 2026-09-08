import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createSetupServer } from "../src/server.mjs";

test("HTTP setup cannot install until Google identity is verified and confirmed", async (t) => {
  const installs = [];
  const server = createSetupServer({
    rootDir: "test-root",
    development: true,
    validateKey: async () => {},
    validatePort: async () => {},
    exchangeCode: async () => ({ email: "verified@example.com", name: "Verified Admin" }),
    install: async (options) => installs.push(options),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const form = new URLSearchParams({
    openaiApiKey: "sk-test",
    googleClientId: "google-id",
    googleClientSecret: "google-secret",
    frontendPort: "3000",
  });
  const verify = await fetch(`${base}/verify`, { method: "POST", body: form, redirect: "manual" });
  assert.equal(verify.status, 303);
  assert.equal(installs.length, 0);

  const oauthLocation = new URL(verify.headers.get("location"));
  const callback = await fetch(`${base}/oauth/callback?code=test-code&state=${encodeURIComponent(oauthLocation.searchParams.get("state"))}`);
  const confirmation = await callback.text();
  assert.equal(callback.status, 200);
  assert.equal(installs.length, 0);
  const token = confirmation.match(/name="token" value="([^"]+)"/)[1];

  const completed = await fetch(`${base}/install`, {
    method: "POST",
    body: new URLSearchParams({ token }),
  });
  assert.equal(completed.status, 200);
  assert.equal(installs.length, 1);
  assert.equal(installs[0].verifiedEmail, "verified@example.com");
  assert.equal("adminEmail" in installs[0].config, false);
});
