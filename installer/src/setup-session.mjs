import { randomBytes, timingSafeEqual } from "node:crypto";

const VERIFY_WINDOW_MS = 10 * 60 * 1000;

function tokensMatch(actualValue, expectedValue) {
  const actual = Buffer.from(String(actualValue ?? ""));
  const expected = Buffer.from(expectedValue);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export class SetupSession {
  #pending;
  #verified;

  begin(config, authorization, now = Date.now()) {
    this.#pending = { config, ...authorization, expiresAt: now + VERIFY_WINDOW_MS };
    this.#verified = undefined;
  }

  consumeOAuth(state, now = Date.now()) {
    if (!this.#pending || now > this.#pending.expiresAt) {
      this.clear();
      throw new Error("Google verification expired. Start again.");
    }
    if (!tokensMatch(state, this.#pending.state)) {
      throw new Error("Invalid OAuth state.");
    }
    const pending = this.#pending;
    this.#pending = undefined;
    return pending;
  }

  markVerified(pending, identity, now = Date.now()) {
    const confirmationToken = randomBytes(32).toString("base64url");
    this.#verified = {
      config: pending.config,
      identity,
      confirmationToken,
      expiresAt: now + VERIFY_WINDOW_MS,
    };
    return confirmationToken;
  }

  confirm(token, now = Date.now()) {
    if (!this.#verified || now > this.#verified.expiresAt) {
      this.clear();
      throw new Error("Admin confirmation expired. Start again.");
    }
    if (!tokensMatch(token, this.#verified.confirmationToken)) {
      throw new Error("Invalid admin confirmation.");
    }
    const verified = this.#verified;
    this.clear();
    return verified;
  }

  clear() {
    this.#pending = undefined;
    this.#verified = undefined;
  }
}
