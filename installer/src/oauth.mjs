import { createHash, randomBytes } from "node:crypto";

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

function base64url(buffer) {
  return buffer.toString("base64url");
}

export function createGoogleAuthorization({ clientId, redirectUri }) {
  const state = base64url(randomBytes(32));
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const url = new URL(GOOGLE_AUTHORIZE_URL);

  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });

  return { url: url.toString(), state, verifier };
}

export async function exchangeGoogleCode(
  { code, verifier, clientId, clientSecret, redirectUri },
  { fetchImpl = fetch } = {},
) {
  const tokenResponse = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      code_verifier: verifier,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!tokenResponse.ok) throw new Error("Google rejected the OAuth callback.");
  const tokens = await tokenResponse.json();
  if (!tokens.access_token) throw new Error("Google did not return an access token.");

  const userResponse = await fetchImpl(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!userResponse.ok) throw new Error("Google user verification failed.");

  const user = await userResponse.json();
  if (user.email_verified !== true || !user.email) {
    throw new Error("Google did not return a verified email address.");
  }

  return { email: String(user.email).trim().toLowerCase(), name: user.name ?? "" };
}
