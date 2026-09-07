/**
 * Runtime-settings lifecycle:
 * environment defaults -> MongoDB initialization -> validation/normalization -> in-memory reads.
 * The in-memory copy keeps request paths synchronous; MongoDB remains the durable source across
 * process restarts.
 */
import {
    applicationSettingsCollection,
} from "./db.js";
import {
    createEmbeddingConfigHash,
    DEFAULT_RUNTIME_SETTINGS,
} from "./env.js";

const SETTINGS_ID = "active";
let activeSettings = DEFAULT_RUNTIME_SETTINGS;

const readPositiveInteger = (value, name, { optional = false } = {}) => {
    if ((value === undefined || value === null || value === "") && optional) {
        return undefined;
    }

    const parsedValue = Number(value);
    if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }

    return parsedValue;
};

const readModelName = (input, field, fallback) => {
    if (!input || !Object.hasOwn(input, field)) return fallback;
    if (typeof input[field] !== "string" || !input[field].trim()) {
        throw new Error(`${field} must be a non-empty string`);
    }
    return input[field].trim();
};

/** Merge partial input with a base configuration and enforce supported value combinations. */
export const normalizeRuntimeSettings = (input, base = activeSettings) => {
    const chatModel = readModelName(input, "chatModel", base.chatModel);
    const model = readModelName(input, "embeddingModel", base.embeddingConfig.model);
    const dimensions = input && Object.hasOwn(input, "embeddingDimensions")
        ? readPositiveInteger(
            input.embeddingDimensions,
            "embeddingDimensions",
            { optional: true }
        )
        : base.embeddingConfig.dimensions;
    const batchSize = input && Object.hasOwn(input, "embeddingBatchSize")
        ? readPositiveInteger(input.embeddingBatchSize, "embeddingBatchSize")
        : base.embeddingConfig.batchSize;
    const timeout = input && Object.hasOwn(input, "embeddingTimeoutMs")
        ? readPositiveInteger(input.embeddingTimeoutMs, "embeddingTimeoutMs")
        : base.embeddingConfig.timeout;

    if (batchSize > 2048) {
        throw new Error("embeddingBatchSize cannot exceed 2048");
    }

    if (dimensions && !model.startsWith("text-embedding-3")) {
        throw new Error(
            "embeddingDimensions is only supported by text-embedding-3 models"
        );
    }

    return Object.freeze({
        chatModel,
        embeddingConfig: Object.freeze({ model, dimensions, batchSize, timeout }),
    });
};

/** Flatten the internal settings shape for API and database boundaries. */
export const serializeRuntimeSettings = (settings = activeSettings) => ({
    chatModel: settings.chatModel,
    embeddingModel: settings.embeddingConfig.model,
    embeddingDimensions: settings.embeddingConfig.dimensions ?? null,
    embeddingBatchSize: settings.embeddingConfig.batchSize,
    embeddingTimeoutMs: settings.embeddingConfig.timeout,
    embeddingConfigHash: createEmbeddingConfigHash(settings.embeddingConfig),
});

/** Return the immutable settings snapshot currently used by request handlers. */
export const getRuntimeSettings = () => activeSettings;

/** Replace the process-local settings snapshot after durable persistence succeeds. */
export const setRuntimeSettings = (settings) => {
    activeSettings = settings;
};

/** Upsert normalized settings, optionally as part of a caller-owned MongoDB transaction. */
export const persistRuntimeSettings = async (settings, { session } = {}) => {
    await applicationSettingsCollection.updateOne(
        { _id: SETTINGS_ID },
        {
            $set: {
                ...serializeRuntimeSettings(settings),
                updatedAt: Date.now(),
            },
            $setOnInsert: { createdAt: Date.now() },
        },
        { upsert: true, session }
    );
};

/** Load persisted settings during startup, creating the defaults on the first run. */
export const initializeRuntimeSettings = async () => {
    const storedSettings = await applicationSettingsCollection.findOne({ _id: SETTINGS_ID });

    if (storedSettings) {
        activeSettings = normalizeRuntimeSettings(storedSettings, DEFAULT_RUNTIME_SETTINGS);
        return activeSettings;
    }

    await persistRuntimeSettings(activeSettings);
    return activeSettings;
};
