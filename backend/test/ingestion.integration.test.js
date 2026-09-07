import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testMongoUri = process.env.TEST_MONGO_URI;

test("ingestion revisions and embedding migrations remain consistent", {
    skip: !testMongoUri && "TEST_MONGO_URI is required",
}, async () => {
    const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "profilepilot-ingestion-"));
    const categoryDirectory = path.join(dataDirectory, "profile");
    const firstSourcePath = path.join(categoryDirectory, "first.txt");
    const secondSourcePath = path.join(categoryDirectory, "second.txt");

    process.env.MONGO_URI = testMongoUri;
    process.env.DATA_DIR = dataDirectory;
    process.env.OPENAI_API_KEY = "test-only";

    await mkdir(categoryDirectory, { recursive: true });
    await writeFile(firstSourcePath, "Initial profile content.");
    await writeFile(secondSourcePath, "Second profile source.");

    const database = await import("../src/config/db.js");
    const runtimeSettings = await import("../src/config/runtimeSettings.js");
    const ingestion = await import("../src/retrieval/ingestDocuments.js");
    const embedDocuments = async (texts) => texts.map((text, index) => [
        text.length,
        index + 1,
        1,
    ]);

    try {
        await database.connectDB();
        await Promise.all([
            database.documentsCollection.deleteMany({}),
            database.ingestionManifestCollection.deleteMany({}),
            database.applicationSettingsCollection.deleteMany({}),
        ]);
        await runtimeSettings.initializeRuntimeSettings();

        const firstResult = await ingestion.ingestSourceFile(firstSourcePath, {
            embedDocuments,
        });
        const secondResult = await ingestion.ingestSourceFile(secondSourcePath, {
            embedDocuments,
        });
        assert.equal(firstResult.status, "updated");
        assert.equal(secondResult.status, "updated");

        const unchangedResult = await ingestion.ingestSourceFile(firstSourcePath, {
            embedDocuments,
        });
        assert.equal(unchangedResult.status, "unchanged");

        await writeFile(firstSourcePath, "Revised profile content.");
        const stagedResult = await ingestion.ingestSourceFile(firstSourcePath, {
            activateAfterIngestion: false,
            embedDocuments,
        });
        assert.equal(stagedResult.status, "staged");

        const stagedDuplicateResult = await ingestion.ingestSourceFile(firstSourcePath, {
            activateAfterIngestion: false,
            embedDocuments,
        });
        assert.equal(stagedDuplicateResult.status, "pending_activation");

        const migratedSettings = runtimeSettings.normalizeRuntimeSettings({
            embeddingModel: "text-embedding-3-small",
            embeddingDimensions: 512,
        });
        const migrationResult = await ingestion.migrateEmbeddingConfiguration(
            migratedSettings,
            { embedDocuments }
        );
        assert.equal(migrationResult.migratedSourceCount, 2);
        assert.equal(
            runtimeSettings.getRuntimeSettings().embeddingConfig.model,
            "text-embedding-3-small"
        );

        const migratedManifests = await database.ingestionManifestCollection
            .find({})
            .toArray();
        assert.equal(migratedManifests.length, 2);
        assert.ok(migratedManifests.every((manifest) =>
            manifest.activeSourceRevision === manifest.latestSourceRevision
            && manifest.updateAvailable === false
            && manifest.embeddingConfigHash === migrationResult.embeddingConfigHash
        ));
        const activeDocuments = await database.documentsCollection.find({ active: true }).toArray();
        assert.ok(activeDocuments.length > 0);
        assert.ok(activeDocuments.every((document) =>
            document.metadata.embeddingConfigHash === migrationResult.embeddingConfigHash
        ));

        const settingsBeforeFailure = runtimeSettings.serializeRuntimeSettings();
        const manifestsBeforeFailure = new Map(migratedManifests.map((manifest) => [
            manifest.sourceId,
            manifest.activeSourceRevision,
        ]));
        const rejectedSettings = runtimeSettings.normalizeRuntimeSettings({
            embeddingModel: "text-embedding-3-large",
            embeddingDimensions: 1024,
        });
        let embeddingCallCount = 0;
        const rejectSecondSource = async (texts) => {
            embeddingCallCount += 1;
            if (embeddingCallCount > 1) throw new Error("Injected embedding failure");
            return embedDocuments(texts);
        };

        await assert.rejects(
            ingestion.migrateEmbeddingConfiguration(rejectedSettings, {
                embedDocuments: rejectSecondSource,
            }),
            /Injected embedding failure/
        );
        assert.deepEqual(
            runtimeSettings.serializeRuntimeSettings(),
            settingsBeforeFailure
        );

        const manifestsAfterFailure = await database.ingestionManifestCollection
            .find({})
            .toArray();
        assert.ok(manifestsAfterFailure.every((manifest) =>
            manifest.activeSourceRevision === manifestsBeforeFailure.get(manifest.sourceId)
        ));
        const rejectedHash = runtimeSettings.serializeRuntimeSettings(
            rejectedSettings
        ).embeddingConfigHash;
        assert.equal(await database.documentsCollection.countDocuments({
            "metadata.embeddingConfigHash": rejectedHash,
        }), 0);
    } finally {
        await database.disconnectDB();
        await rm(dataDirectory, { recursive: true, force: true });
    }
});
