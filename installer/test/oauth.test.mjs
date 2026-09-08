import test from "node:test";
import assert from "node:assert/strict";
import { createGoogleAuthorization, exchangeGoogleCode, GOOGLE_TOKEN_URL, GOOGLE_USERINFO_URL } from "../src/oauth.mjs";

test("Google authorization uses state, PKCE, and the fixed callback", () => {
  const result = createGoogleAuthorization({ clientId: "client", redirectUri: "http://127.0.0.1:48731/oauth/callback" });
  const url = new URL(result.url);
  assert.ok(result.state.length >= 32);
  assert.ok(result.verifier.length >= 43);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), result.state);
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:48731/oauth/callback");
});

test("OAuth exchange accepts only Google's verified email", async () => {
  const calls = [];
  const identity = await exchangeGoogleCode({
    code: "code", verifier: "verifier", clientId: "client", clientSecret: "secret", redirectUri: "callback",
  }, {
    fetchImpl: async (url) => {
      calls.push(url);
      if (url === GOOGLE_TOKEN_URL) return { ok: true, json: async () => ({ access_token: "token" }) };
      return { ok: true, json: async () => ({ email: "Admin@Example.com", email_verified: true }) };
    },
  });
  assert.deepEqual(calls, [GOOGLE_TOKEN_URL, GOOGLE_USERINFO_URL]);
  assert.equal(identity.email, "admin@example.com");
});

test("OAuth exchange rejects an unverified email", async () => {
  await assert.rejects(exchangeGoogleCode({
    code: "code", verifier: "v", clientId: "id", clientSecret: "secret", redirectUri: "callback",
  }, {
    fetchImpl: async (url) => url === GOOGLE_TOKEN_URL
      ? { ok: true, json: async () => ({ access_token: "token" }) }
      : { ok: true, json: async () => ({ email: "admin@example.com", email_verified: false }) },
  }), /verified email/);
});
