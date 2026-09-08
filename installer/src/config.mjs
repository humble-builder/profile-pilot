import net from "node:net";

const PINNED_IMAGE = /^(ghcr\.io\/humble-builder\/profile-pilot-(backend|frontend)|mongo)@sha256:[0-9a-f]{64}$/;

function required(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

export function normalizeSetupInput(input, { development = false } = {}) {
  const port = Number(input.frontendPort ?? 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Frontend port must be an integer from 1024 to 65535.");
  }

  const config = {
    openaiApiKey: required(input.openaiApiKey, "OpenAI API key"),
    tavilyApiKey: String(input.tavilyApiKey ?? "").trim(),
    googleClientId: required(input.googleClientId, "Google OAuth client ID"),
    googleClientSecret: required(input.googleClientSecret, "Google OAuth client secret"),
    frontendPort: port,
    images: {
      backend: String(input.backendImage ?? "").trim(),
      frontend: String(input.frontendImage ?? "").trim(),
      mongo: String(input.mongoImage ?? "").trim(),
    },
  };

  if (!development) {
    for (const [name, image] of Object.entries(config.images)) {
      if (!PINNED_IMAGE.test(image)) {
        throw new Error(`${name} image must be an approved digest-pinned release image.`);
      }
    }
  }

  return Object.freeze(config);
}

export async function validateOpenAIKey(apiKey, { fetchImpl = fetch } = {}) {
  let response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new Error(`Could not reach OpenAI: ${error.message}`);
  }

  if (!response.ok) {
    throw new Error(`OpenAI rejected the API key (HTTP ${response.status}).`);
  }
}

export function validateLocalPort(port, { host = "127.0.0.1" } = {}) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", () => reject(new Error(`Frontend port ${port} is already in use.`)));
    probe.listen(port, host, () => probe.close(resolve));
  });
}
