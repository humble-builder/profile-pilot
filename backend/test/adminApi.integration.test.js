import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testMongoUri = process.env.TEST_MONGO_URI;

test("admin HTTP APIs authorize, persist settings, and manage source revisions", {
    skip: !testMongoUri && "TEST_MONGO_URI is required",
}, async () => {
    const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "profilepilot-admin-api-"));
    const categoryDirectory = path.join(dataDirectory, "profile");
    const sourcePath = path.join(categoryDirectory, "profile.txt");
    const adminToken = "integration-admin-token";

    process.env.MONGO_URI = testMongoUri;
    process.env.DATA_DIR = dataDirectory;
    process.env.OPENAI_API_KEY = "test-only";
    process.env.ADMIN_API_TOKEN = adminToken;

    await mkdir(categoryDirectory, { recursive: true });
    await writeFile(sourcePath, "Initial profile content.");

    const express = (await import("express")).default;
    const database = await import("../src/config/db.js");
    const runtimeSettings = await import("../src/config/runtimeSettings.js");
    const ingestion = await import("../src/retrieval/ingestDocuments.js");
    const serviceRoutes = (await import("../src/routes/serviceRoutes.js")).default;
    const embedDocuments = async (texts) => texts.map((text, index) => [
        text.length,
        index + 1,
        1,
    ]);
    let server;

    try {
        await database.connectDB();
        await Promise.all([
            database.documentsCollection.deleteMany({}),
            database.sessionsCollection.deleteMany({}),
            database.ingestionManifestCollection.deleteMany({}),
            database.applicationSettingsCollection.deleteMany({}),
        ]);
        await runtimeSettings.initializeRuntimeSettings();
        await ingestion.ingestSourceFile(sourcePath, { embedDocuments });

        await writeFile(sourcePath, "Revised profile content.");
        const staged = await ingestion.ingestSourceFile(sourcePath, {
            activateAfterIngestion: false,
            embedDocuments,
        });

        const app = express();
        app.use("/service", serviceRoutes);
        server = app.listen(0);
        await new Promise((resolve, reject) => {
            server.once("listening", resolve);
            server.once("error", reject);
        });
        const { port } = server.address();
        const baseUrl = `http://127.0.0.1:${port}/service/admin`;

        let response = await fetch(`${baseUrl}/settings`);
        assert.equal(response.status, 401);

        response = await fetch(`${baseUrl}/settings`, {
            headers: { "x-admin-token": adminToken },
        });
        assert.equal(response.status, 200);
        const originalSettings = await response.json();

        response = await fetch(`${baseUrl}/settings`, {
            method: "PUT",
            headers: {
                "content-type": "application/json",
                "x-admin-token": adminToken,
            },
            body: JSON.stringify({ chatModel: "mock-runtime-chat-model" }),
        });
        assert.equal(response.status, 200);
        const updatedSettings = await response.json();
        assert.equal(updatedSettings.settings.chatModel, "mock-runtime-chat-model");
        assert.equal(updatedSettings.embeddingMigration, null);
        assert.equal(
            updatedSettings.settings.embeddingConfigHash,
            originalSettings.embeddingConfigHash
        );

        response = await fetch(`${baseUrl}/sources`, {
            headers: { "x-admin-token": adminToken },
        });
        const sources = await response.json();
        assert.equal(response.status, 200);
        assert.equal(sources.length, 1);
        assert.equal(sources[0].updateAvailable, true);

        response = await fetch(`${baseUrl}/sources/activate`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-admin-token": adminToken,
            },
            body: JSON.stringify({
                sourceId: staged.sourceId,
                revisionId: staged.sourceRevision,
            }),
        });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).activeSourceRevision, staged.sourceRevision);

        const uploadQuery = new URLSearchParams({
            category: "profile",
            filename: "profile.txt",
            activateAfterIngestion: "false",
        });
        response = await fetch(`${baseUrl}/sources/upload?${uploadQuery}`, {
            method: "POST",
            headers: {
                "content-type": "text/plain",
                "x-admin-token": adminToken,
            },
            body: "Revised profile content.",
        });
        assert.equal(response.status, 409);
        assert.equal((await response.json()).code, "ACTIVE_DUPLICATE");

        const storedSettings = await database.applicationSettingsCollection.findOne({
            _id: "active",
        });
        assert.equal(storedSettings.chatModel, "mock-runtime-chat-model");
    } finally {
        if (server) await new Promise((resolve) => server.close(resolve));
        await database.disconnectDB();
        await rm(dataDirectory, { recursive: true, force: true });
    }
});
