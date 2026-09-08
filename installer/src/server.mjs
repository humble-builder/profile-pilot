import http from "node:http";
import { createGoogleAuthorization, exchangeGoogleCode } from "./oauth.mjs";
import { normalizeSetupInput, validateLocalPort, validateOpenAIKey } from "./config.mjs";
import { SetupSession } from "./setup-session.mjs";

const MAX_FORM_BYTES = 64 * 1024;

// Workflow: validate locally, redirect through one-use Google OAuth state, show
// the verified identity, then require a second one-use confirmation to install.

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><style>
  :root{font-family:system-ui,sans-serif;color:#172033;background:#eef2f7}body{margin:0}.card{max-width:680px;margin:5vh auto;background:#fff;padding:32px;border-radius:16px;box-shadow:0 12px 40px #17203318}label{display:block;font-weight:650;margin:18px 0 6px}input{box-sizing:border-box;width:100%;padding:11px;border:1px solid #bac3d1;border-radius:8px}button{margin-top:24px;padding:12px 18px;border:0;border-radius:8px;background:#2357d9;color:white;font-weight:700;cursor:pointer}.note{color:#536174}.error{color:#a21d25;background:#fff0f1;padding:12px;border-radius:8px}code{background:#edf0f5;padding:2px 5px;border-radius:4px}</style></head><body><main class="card"><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
}

function formPage(error = "") {
  return page("Set up ProfilePilot", `${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    <p class="note">Nothing is installed until Google verifies the admin account and you confirm it.</p>
    <form method="post" action="/verify">
      <label for="openai">OpenAI API key</label><input id="openai" name="openaiApiKey" type="password" required autocomplete="off">
      <label for="tavily">Tavily API key (optional)</label><input id="tavily" name="tavilyApiKey" type="password" autocomplete="off">
      <label for="google-id">Google OAuth client ID</label><input id="google-id" name="googleClientId" required autocomplete="off">
      <label for="google-secret">Google OAuth client secret</label><input id="google-secret" name="googleClientSecret" type="password" required autocomplete="off">
      <label for="port">Application port</label><input id="port" name="frontendPort" type="number" min="1024" max="65535" value="3000" required>
      <button type="submit">Validate and verify with Google</button>
    </form>
    <p class="note">Google must allow callback URI <code>http://127.0.0.1:48731/oauth/callback</code>.</p>`);
}

async function readForm(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_FORM_BYTES) throw new Error("Submitted form is too large.");
  }
  return Object.fromEntries(new URLSearchParams(body));
}

function send(response, status, content) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(content);
}

export function createSetupServer({
  rootDir,
  releaseImages = {},
  development = false,
  validateKey = validateOpenAIKey,
  validatePort = validateLocalPort,
  exchangeCode = exchangeGoogleCode,
  install,
}) {
  const session = new SetupSession();
  const redirectUri = "http://127.0.0.1:48731/oauth/callback";

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, redirectUri);
    try {
      if (request.method === "GET" && url.pathname === "/") {
        return send(response, 200, formPage());
      }

      if (request.method === "POST" && url.pathname === "/verify") {
        const submitted = await readForm(request);
        const config = normalizeSetupInput({ ...submitted, ...releaseImages }, { development });
        await validatePort(config.frontendPort);
        await validateKey(config.openaiApiKey);
        const authorization = createGoogleAuthorization({ clientId: config.googleClientId, redirectUri });
        session.begin(config, authorization);
        response.writeHead(303, { location: authorization.url, "cache-control": "no-store" });
        return response.end();
      }

      if (request.method === "GET" && url.pathname === "/oauth/callback") {
        if (url.searchParams.get("error")) throw new Error("Google verification was cancelled or denied.");
        if (!url.searchParams.get("code")) throw new Error("Google did not return an authorization code.");
        const state = url.searchParams.get("state");
        const pending = session.consumeOAuth(state);
        const identity = await exchangeCode({
          code: url.searchParams.get("code"),
          verifier: pending.verifier,
          clientId: pending.config.googleClientId,
          clientSecret: pending.config.googleClientSecret,
          redirectUri,
        });
        const token = session.markVerified(pending, identity);
        return send(response, 200, page("Confirm administrator", `
          <p>Google verified <strong>${escapeHtml(identity.email)}</strong>.</p>
          <p class="note">This will be the only ProfilePilot administrator. Installation begins only after this confirmation.</p>
          <form method="post" action="/install"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit">Make this account admin and install</button></form>`));
      }

      if (request.method === "POST" && url.pathname === "/install") {
        const { token } = await readForm(request);
        const verified = session.confirm(token);
        await install({ rootDir, config: verified.config, verifiedEmail: verified.identity.email, development });
        send(response, 200, page("ProfilePilot is ready", `<p>Installation completed. Open <a href="http://localhost:${verified.config.frontendPort}">ProfilePilot</a> and sign in as <strong>${escapeHtml(verified.identity.email)}</strong>.</p>`));
        return setTimeout(() => server.close(), 1_000);
      }

      send(response, 404, page("Not found", "<p>This setup page does not exist.</p>"));
    } catch (error) {
      session.clear();
      send(response, 400, formPage(error.message));
    }
  });

  return server;
}
