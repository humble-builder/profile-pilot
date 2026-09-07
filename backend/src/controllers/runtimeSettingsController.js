/**
 * Runtime-settings workflow:
 * 1. Reject the update while a source operation is active.
 * 2. Normalize the submitted values against the current settings.
 * 3. Re-embed and atomically switch every source when the embedding shape changes.
 * 4. Otherwise persist the lightweight settings update and refresh the in-memory copy.
 */
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

/** Return the settings currently used by chat and retrieval services. */
export const readRuntimeSettings = (_req, res) => {
    return res.json(serializeRuntimeSettings());
};

/** Validate and apply a runtime-settings update submitted by an administrator. */
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
