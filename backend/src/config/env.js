import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const readPositiveInteger = (name, defaultValue) => {
    const rawValue = process.env[name]?.trim();
    if (!rawValue) return defaultValue;

    const parsedValue = Number(rawValue);
    if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }

    return parsedValue;
};

export const createEmbeddingConfigHash = ({ model, dimensions }) => crypto
    .createHash("sha256")
    .update(JSON.stringify({ model, dimensions: dimensions ?? null }))
    .digest("hex");

const defaultEmbeddingConfig = {
    model: process.env.OPENAI_EMBEDDING_MODEL?.trim() || "text-embedding-ada-002",
    dimensions: readPositiveInteger("OPENAI_EMBEDDING_DIMENSIONS", undefined),
    batchSize: readPositiveInteger("OPENAI_EMBEDDING_BATCH_SIZE", 100),
    timeout: readPositiveInteger("OPENAI_EMBEDDING_TIMEOUT_MS", 30000),
};

if (defaultEmbeddingConfig.batchSize > 2048) {
    throw new Error("OPENAI_EMBEDDING_BATCH_SIZE cannot exceed 2048");
}

if (
    defaultEmbeddingConfig.dimensions
    && !defaultEmbeddingConfig.model.startsWith("text-embedding-3")
) {
    throw new Error(
        "OPENAI_EMBEDDING_DIMENSIONS is only supported by text-embedding-3 models"
    );
}

export const DEFAULT_RUNTIME_SETTINGS = Object.freeze({
    chatModel: process.env.OPENAI_CHAT_MODEL?.trim() || "gpt-4o-mini",
    embeddingConfig: Object.freeze(defaultEmbeddingConfig),
});

export const LEGACY_OPENAI_EMBEDDING_CONFIG_HASH = createEmbeddingConfigHash({
    model: "text-embedding-ada-002",
    dimensions: undefined,
});
