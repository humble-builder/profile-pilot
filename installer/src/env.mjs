import { randomBytes } from "node:crypto";

function assertEnvValue(value, label) {
  const text = String(value ?? "");
  if (/\r|\n/.test(text)) throw new Error(`${label} contains an invalid line break.`);
  return text;
}

export function buildEnvironment(config, verifiedEmail) {
  const lines = [
    ["OPENAI_API_KEY", config.openaiApiKey],
    ["TAVILY_API_KEY", config.tavilyApiKey],
    ["PROFILEPILOT_BACKEND_IMAGE", config.images.backend],
    ["PROFILEPILOT_FRONTEND_IMAGE", config.images.frontend],
    ["PROFILEPILOT_MONGO_IMAGE", config.images.mongo],
    ["OPENAI_CHAT_MODEL", "gpt-4o-mini"],
    ["OPENAI_EMBEDDING_MODEL", "text-embedding-ada-002"],
    ["OPENAI_EMBEDDING_DIMENSIONS", ""],
    ["OPENAI_EMBEDDING_BATCH_SIZE", "100"],
    ["OPENAI_EMBEDDING_TIMEOUT_MS", "30000"],
    ["AUTH_SECRET", randomBytes(32).toString("base64url")],
    ["AUTH_GOOGLE_ID", config.googleClientId],
    ["AUTH_GOOGLE_SECRET", config.googleClientSecret],
    ["ADMIN_EMAIL", verifiedEmail],
    ["ADMIN_API_TOKEN", randomBytes(32).toString("base64url")],
    ["FRONTEND_PORT", config.frontendPort],
  ];

  return `${lines.map(([key, value]) => `${key}=${assertEnvValue(value, key)}`).join("\n")}\n`;
}
