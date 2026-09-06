import { createEmbeddingConfigHash } from "../config/env.js";
import {
    getRuntimeSettings,
    normalizeRuntimeSettings,
    persistRuntimeSettings,
    serializeRuntimeSettings,
    setRuntimeSettings,
} from "../config/runtimeSettings.js";
import { migrateEmbeddingConfiguration } from "../retrieval/ingestDocuments.js";
import {
    finishSettingsUpdate,
    tryStartSettingsUpdate,
} from "../services/adminOperationGuard.js";

export const readRuntimeSettings = (_req, res) => {
    return res.json(serializeRuntimeSettings());
};

export const updateRuntimeSettings = async (req, res) => {
    if (!tryStartSettingsUpdate()) {
        return res.status(409).json({
            error: "Another source or settings operation is already running",
        });
    }

    try {
        const currentSettings = getRuntimeSettings();
        const nextSettings = normalizeRuntimeSettings(req.body, currentSettings);
        const currentEmbeddingHash = createEmbeddingConfigHash(
            currentSettings.embeddingConfig
        );
        const nextEmbeddingHash = createEmbeddingConfigHash(
            nextSettings.embeddingConfig
        );
        let migrationResult = null;

        if (currentEmbeddingHash !== nextEmbeddingHash) {
            migrationResult = await migrateEmbeddingConfiguration(nextSettings);
        } else {
            await persistRuntimeSettings(nextSettings);
            setRuntimeSettings(nextSettings);
        }

        return res.json({
            settings: serializeRuntimeSettings(nextSettings),
            embeddingMigration: migrationResult,
        });
    } catch (error) {
        const validationError = error.message?.includes("must be")
            || error.message?.includes("cannot exceed")
            || error.message?.includes("only supported");
        console.error("Runtime settings update failed:", error);
        return res.status(validationError ? 400 : 500).json({
            error: validationError ? error.message : "Runtime settings update failed",
        });
    } finally {
        finishSettingsUpdate();
    }
};
