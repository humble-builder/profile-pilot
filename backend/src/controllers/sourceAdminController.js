/**
 * Source-administration workflow:
 * - List retained revisions from ingestion manifests.
 * - Validate and write uploads inside DATA_DIR, then ask ingestion to stage or activate them.
 * - Restore the previous file when ingestion fails or detects a duplicate.
 * - Serialize uploads/activations against embedding-settings migrations.
 */
import fs from "fs/promises";
import path from "path";
import { ingestionManifestCollection } from "../config/db.js";
import {
    activateRetainedSourceRevision,
    ingestSourceFile,
} from "../retrieval/ingestDocuments.js";
import {
    finishSourceOperation,
    tryStartSourceOperation,
} from "../services/adminOperationGuard.js";

const DATA_DIR = path.resolve(process.env.DATA_DIR || "../documents/ingestables");
const SUPPORTED_EXTENSIONS = new Set([".pdf", ".docx", ".txt"]);
const activeUploads = new Set();

const parseActivationPreference = (value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    throw new Error("activateAfterIngestion must be true or false");
};

const resolveUploadTarget = (category, filename) => {
    if (!category || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(category)) {
        throw new Error("Category must contain only letters, numbers, hyphens, or underscores");
    }

    if (!filename || path.basename(filename) !== filename) {
        throw new Error("A valid file name is required");
    }

    const extension = path.extname(filename).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
        throw new Error("Only PDF, DOCX, and TXT files are supported");
    }

    const targetPath = path.resolve(DATA_DIR, category, filename);
    if (!targetPath.startsWith(`${DATA_DIR}${path.sep}`)) {
        throw new Error("Upload path escapes the document directory");
    }

    return targetPath;
};

const readExistingFile = async (filePath) => {
    try {
        return await fs.readFile(filePath);
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
    }
};

const restoreFile = async (filePath, previousContent) => {
    if (previousContent) {
        await fs.writeFile(filePath, previousContent);
        return;
    }

    await fs.rm(filePath, { force: true });
};

/** Convert ingestion duplicate states into stable HTTP conflict payloads. */
export const getDuplicateUploadConflict = (status) => {
    if (status === "unchanged") {
        return {
            error: "This document is identical to the active revision",
            code: "ACTIVE_DUPLICATE",
        };
    }

    if (status === "pending_activation") {
        return {
            error: "This document is already staged and awaiting activation",
            code: "STAGED_DUPLICATE",
        };
    }

    return null;
};

/** List each source and the active/latest revisions available to the admin UI. */
export const listSources = async (_req, res) => {
    try {
        const manifests = await ingestionManifestCollection.find({}, {
            projection: {
                _id: 0,
                source: 1,
                sourceId: 1,
                category: 1,
                activeSourceRevision: 1,
                latestSourceRevision: 1,
                updateAvailable: 1,
                lastUpdatedAt: 1,
                "revisions.id": 1,
                "revisions.createdAt": 1,
                "revisions.lastActivatedAt": 1,
                "revisions.chunkCount": 1,
            },
        }).sort({ sourceId: 1 }).toArray();

        return res.json(manifests.map((manifest) => {
            const latestSourceRevision = manifest.latestSourceRevision
                ?? manifest.activeSourceRevision;

            return {
                ...manifest,
                latestSourceRevision,
                updateAvailable: manifest.activeSourceRevision !== latestSourceRevision,
            };
        }));
    } catch (error) {
        console.error("Could not list source revisions:", error);
        return res.status(500).json({ error: "Could not list source revisions" });
    }
};

/**
 * Persist and ingest one raw document upload.
 * The filesystem write is rolled back unless ingestion produces a new revision.
 */
export const uploadSource = async (req, res) => {
    let targetPath;
    let previousContent;
    let uploadLockAcquired = false;
    let operationLockAcquired = false;
    let fileWritten = false;

    try {
        if (!tryStartSourceOperation()) {
            return res.status(409).json({
                error: "Settings are being updated; retry the upload shortly",
            });
        }
        operationLockAcquired = true;
        const { category, filename, activateAfterIngestion } = req.query;
        targetPath = resolveUploadTarget(category, filename);
        const shouldActivate = parseActivationPreference(activateAfterIngestion);

        if (!Buffer.isBuffer(req.body) || !req.body.length) {
            return res.status(400).json({ error: "Uploaded file is empty" });
        }

        if (activeUploads.has(targetPath)) {
            return res.status(409).json({ error: "This source is already being ingested" });
        }

        activeUploads.add(targetPath);
        uploadLockAcquired = true;
        previousContent = await readExistingFile(targetPath);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, req.body);
        fileWritten = true;

        const result = await ingestSourceFile(targetPath, {
            activateAfterIngestion: shouldActivate,
        });

        const duplicateConflict = getDuplicateUploadConflict(result.status);
        if (duplicateConflict) {
            await restoreFile(targetPath, previousContent);
            fileWritten = false;
            return res.status(409).json(duplicateConflict);
        }

        return res.status(201).json(result);
    } catch (error) {
        if (targetPath && fileWritten) {
            try {
                await restoreFile(targetPath, previousContent);
            } catch (restoreError) {
                console.error("Could not restore source after ingestion failure:", restoreError);
            }
        }

        const status = error.message?.includes("supported")
            || error.message?.includes("required")
            || error.message?.includes("Category")
            || error.message?.includes("activateAfterIngestion")
            ? 400
            : 500;
        console.error("Source upload failed:", error);
        return res.status(status).json({
            error: status === 400 ? error.message : "Source ingestion failed",
        });
    } finally {
        if (targetPath && uploadLockAcquired) activeUploads.delete(targetPath);
        if (operationLockAcquired) finishSourceOperation();
    }
};

/** Atomically make a retained, embedding-compatible source revision active. */
export const activateSource = async (req, res) => {
    if (!tryStartSourceOperation()) {
        return res.status(409).json({
            error: "Settings are being updated; retry activation shortly",
        });
    }

    try {
        const { sourceId, revisionId } = req.body ?? {};
        if (!sourceId || !revisionId) {
            return res.status(400).json({ error: "sourceId and revisionId are required" });
        }

        const result = await activateRetainedSourceRevision(sourceId, revisionId);
        return res.json(result);
    } catch (error) {
        console.error("Source activation failed:", error);
        return res.status(409).json({ error: error.message ?? "Source activation failed" });
    } finally {
        finishSourceOperation();
    }
};
