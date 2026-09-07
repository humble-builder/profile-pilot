import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/profile_pilot_test";
process.env.OPENAI_API_KEY ||= "test-only";

const { createChat } = await import("../src/controllers/chatController.js");
const { getFile } = await import("../src/controllers/serviceController.js");
const { readRuntimeSettings } = await import("../src/controllers/runtimeSettingsController.js");
const { activateSource, uploadSource } = await import("../src/controllers/sourceAdminController.js");
const { requireAdminToken } = await import("../src/middleware/requireAdminToken.js");

const createResponse = () => ({
    statusCode: 200,
    payload: undefined,
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(payload) {
        this.payload = payload;
        return this;
    },
    download(filePath, filename) {
        this.downloaded = { filePath, filename };
        return this;
    },
});

test("admin-token middleware handles missing, invalid, and valid configuration", () => {
    const previousToken = process.env.ADMIN_API_TOKEN;
    try {
        delete process.env.ADMIN_API_TOKEN;
        let response = createResponse();
        requireAdminToken({ get: () => "" }, response, () => assert.fail("must not continue"));
        assert.equal(response.statusCode, 503);

        process.env.ADMIN_API_TOKEN = "expected-token";
        response = createResponse();
        requireAdminToken({ get: () => "wrong-token" }, response, () => assert.fail("must not continue"));
        assert.equal(response.statusCode, 401);

        let continued = false;
        requireAdminToken({ get: () => "expected-token" }, createResponse(), () => { continued = true; });
        assert.equal(continued, true);
    } finally {
        if (previousToken === undefined) delete process.env.ADMIN_API_TOKEN;
        else process.env.ADMIN_API_TOKEN = previousToken;
    }
});

test("chat controller rejects incomplete requests before invoking services", async () => {
    for (const [body, expectedError] of [
        [{}, "User ID required"],
        [{ userId: "user" }, "Session ID required"],
        [{ userId: "user", sessionId: "session", message: " " }, "Valid message required"],
    ]) {
        const response = createResponse();
        await createChat({ body }, response);
        assert.equal(response.statusCode, 400);
        assert.equal(response.payload.error, expectedError);
    }
});

test("runtime settings controller serializes the active settings", () => {
    const response = createResponse();
    readRuntimeSettings({}, response);
    assert.equal(typeof response.payload.chatModel, "string");
    assert.equal(typeof response.payload.embeddingConfigHash, "string");
});

test("source controllers reject invalid inputs and release their operation locks", async () => {
    let response = createResponse();
    await uploadSource({
        query: { category: "../outside", filename: "bad.txt", activateAfterIngestion: "true" },
        body: Buffer.from("content"),
    }, response);
    assert.equal(response.statusCode, 400);

    response = createResponse();
    await activateSource({ body: {} }, response);
    assert.equal(response.statusCode, 400);

    response = createResponse();
    await activateSource({ body: {} }, response);
    assert.equal(response.statusCode, 400);
});

test("file controller finds only known downloadable basenames", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "profilepilot-download-"));
    const filePath = path.join(directory, "resume.pdf");
    const previousUploadDirectory = process.env.UPLOAD_DIR;
    try {
        process.env.UPLOAD_DIR = directory;
        await writeFile(filePath, "mock resume");

        let response = createResponse();
        await getFile({ params: { filename: "resume.pdf" } }, response);
        assert.deepEqual(response.downloaded, { filePath, filename: "resume.pdf" });

        response = createResponse();
        await getFile({ params: { filename: "missing.pdf" } }, response);
        assert.equal(response.statusCode, 404);

        response = createResponse();
        await getFile({ params: { filename: "" } }, response);
        assert.equal(response.statusCode, 400);
    } finally {
        if (previousUploadDirectory === undefined) delete process.env.UPLOAD_DIR;
        else process.env.UPLOAD_DIR = previousUploadDirectory;
        await rm(directory, { recursive: true, force: true });
    }
});
