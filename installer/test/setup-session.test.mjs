import test from "node:test";
import assert from "node:assert/strict";
import { SetupSession } from "../src/setup-session.mjs";

test("confirmation is impossible before successful OAuth verification", () => {
  const session = new SetupSession();
  assert.throws(() => session.confirm("anything"), /expired/);
});

test("state and confirmation tokens are one-use gates", () => {
  const session = new SetupSession();
  session.begin({ marker: true }, { state: "oauth-state", verifier: "pkce" }, 100);
  assert.throws(() => session.consumeOAuth("wrong", 101), /Invalid OAuth state/);
  const pending = session.consumeOAuth("oauth-state", 101);
  assert.throws(() => session.consumeOAuth("oauth-state", 101), /expired/);
  const token = session.markVerified(pending, { email: "admin@example.com" }, 101);
  const verified = session.confirm(token, 102);
  assert.equal(verified.identity.email, "admin@example.com");
  assert.throws(() => session.confirm(token, 102), /expired/);
});
