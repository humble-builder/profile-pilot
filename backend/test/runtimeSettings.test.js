import assert from "node:assert/strict";
import test from "node:test";

process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/profile_pilot_test";

const {
    normalizeRuntimeSettings,
    serializeRuntimeSettings,
} = await import("../src/config/runtimeSettings.js");
const { getDuplicateUploadConflict } = await import(
    "../src/controllers/sourceAdminController.js"
);
const operationGuard = await import("../src/services/adminOperationGuard.js");

test("runtime settings normalize supported embedding dimensions", () => {
    const settings = normalizeRuntimeSettings({
        chatModel: "gpt-4o-mini",
        embeddingModel: "text-embedding-3-small",
        embeddingDimensions: 512,
        embeddingBatchSize: 64,
        embeddingTimeoutMs: 15000,
    });

    assert.deepEqual(serializeRuntimeSettings(settings), {
        chatModel: "gpt-4o-mini",
        embeddingModel: "text-embedding-3-small",
        embeddingDimensions: 512,
        embeddingBatchSize: 64,
        embeddingTimeoutMs: 15000,
        embeddingConfigHash: serializeRuntimeSettings(settings).embeddingConfigHash,
    });
});

test("runtime settings reject invalid model and batching values", () => {
    assert.throws(
        () => normalizeRuntimeSettings({ chatModel: 42 }),
        /chatModel must be a non-empty string/
    );
    assert.throws(
        () => normalizeRuntimeSettings({ embeddingBatchSize: 0 }),
        /embeddingBatchSize must be a positive integer/
    );
    assert.throws(
        () => normalizeRuntimeSettings({ embeddingBatchSize: 2049 }),
        /embeddingBatchSize cannot exceed 2048/
    );
    assert.throws(
        () => normalizeRuntimeSettings({
            embeddingModel: "text-embedding-ada-002",
            embeddingDimensions: 512,
        }),
        /only supported by text-embedding-3 models/
    );
});

test("duplicate ingestion statuses map to distinct upload conflicts", () => {
    assert.deepEqual(getDuplicateUploadConflict("unchanged"), {
        error: "This document is identical to the active revision",
        code: "ACTIVE_DUPLICATE",
    });
    assert.deepEqual(getDuplicateUploadConflict("pending_activation"), {
        error: "This document is already staged and awaiting activation",
        code: "STAGED_DUPLICATE",
    });
    assert.equal(getDuplicateUploadConflict("updated"), null);
});

test("settings updates and source operations exclude each other", () => {
    assert.equal(operationGuard.tryStartSourceOperation(), true);
    assert.equal(operationGuard.tryStartSettingsUpdate(), false);
    operationGuard.finishSourceOperation();

    assert.equal(operationGuard.tryStartSettingsUpdate(), true);
    assert.equal(operationGuard.tryStartSourceOperation(), false);
    operationGuard.finishSettingsUpdate();

    assert.equal(operationGuard.tryStartSourceOperation(), true);
    operationGuard.finishSourceOperation();
});
