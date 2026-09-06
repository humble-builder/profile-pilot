import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { OpenAIEmbeddings } from "@langchain/openai";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { getAllFiles } from "../data/getFilePaths.js";
import { hashContent } from "../utils/hashContent.js";
import { generateBatches } from "../data/generateBatches.js";
import {
    documentsCollection,
    ingestionManifestCollection,
    runInTransaction,
} from "../config/db.js";
import { loadDocument } from "../data/loadDataFiles.js";
import { startCursor, stopCursor } from "../utils/taskProgressCursor.js";
import { logger } from "../utils/logger.js";

const embeddings = new OpenAIEmbeddings({
    apiKey: process.env.OPENAI_API_KEY,
});

const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 100,
});

const DATA_DIR = process.env.DATA_DIR || "../documents/ingestables";
const PREVIOUS_REVISIONS_TO_RETAIN = 3;

const createChunkKey = (chunkHash, occurrence) => `${chunkHash}:${occurrence}`;
const createSourceRevisionId = (sourceId, createdAt) => hashContent(
    `${sourceId}|${createdAt}|${uuidv4()}`
);

const addChunkKeys = (documents) => {
    const hashOccurrences = new Map();

    return documents.map((document, index) => {
        const chunkHash = document.metadata.hash ?? hashContent(document.content);
        const occurrence = (hashOccurrences.get(chunkHash) ?? 0) + 1;
        hashOccurrences.set(chunkHash, occurrence);

        return {
            ...document,
            metadata: {
                ...document.metadata,
                chunk: index + 1,
                hash: chunkHash,
                chunkKey: createChunkKey(chunkHash, occurrence),
            },
        };
    });
};

const loadSourceChunks = async (filePath) => {
    const source = path.basename(filePath);
    const category = path.basename(path.dirname(filePath));
    const sourceId = path.relative(DATA_DIR, filePath).split(path.sep).join("/");
    const loadedDocuments = await loadDocument(filePath);
    const splitDocuments = await splitter.splitDocuments(loadedDocuments);
    const chunks = addChunkKeys(splitDocuments.map((document) => ({
        content: document.pageContent,
        metadata: {
            source,
            sourceId,
            category,
        },
    })));

    return {
        source,
        sourceId,
        category,
        chunks,
    };
};

const getExistingSourceDocuments = async ({ source, sourceId, category, manifest }) => {
    if (manifest?.activeSourceRevision) {
        return documentsCollection.find({
            "metadata.sourceId": sourceId,
            sourceRevision: manifest.activeSourceRevision,
            active: true,
        }).sort({ "metadata.chunk": 1 }).toArray();
    }

    return documentsCollection.find({
        "metadata.sourceType": "vector",
        "metadata.source": source,
        "metadata.category": category,
        "metadata.sourceId": { $exists: false },
    }).sort({ "metadata.chunk": 1 }).toArray();
};

const arraysMatch = (left, right) => left.length === right.length
    && left.every((item, index) => item === right[index]);

const embedMissingChunks = async (chunks) => {
    if (!chunks.length) return [];

    const chunkBatches = generateBatches(chunks.map((chunk) => chunk.content), 100);
    const embeddedBatches = await Promise.all(
        chunkBatches.map((batch) => embeddings.embedDocuments(batch))
    );
    const embeddingsArray = embeddedBatches.flat();

    if (embeddingsArray.length !== chunks.length) {
        throw new Error("Embedding count does not match changed chunk count");
    }

    return embeddingsArray;
};

const stageSourceRevision = async ({ sourceDetails, existingDocuments, sourceRevision }) => {
    const existingChunks = addChunkKeys(existingDocuments);
    const existingByChunkKey = new Map(existingChunks.map((document) => [
        document.metadata.chunkKey,
        document,
    ]));
    const chunksNeedingEmbeddings = sourceDetails.chunks.filter((chunk) =>
        !existingByChunkKey.get(chunk.metadata.chunkKey)?.embedding
    );
    const generatedEmbeddings = await embedMissingChunks(chunksNeedingEmbeddings);
    const generatedEmbeddingByChunkKey = new Map(chunksNeedingEmbeddings.map((chunk, index) => [
        chunk.metadata.chunkKey,
        generatedEmbeddings[index],
    ]));
    const currentDateTime = Date.now();
    const stagingOperations = sourceDetails.chunks.map((chunk) => {
        const existingDocument = existingByChunkKey.get(chunk.metadata.chunkKey);
        const embedding = existingDocument?.embedding
            ?? generatedEmbeddingByChunkKey.get(chunk.metadata.chunkKey);

        if (!embedding) {
            throw new Error(`Missing embedding for chunk ${chunk.metadata.chunkKey}`);
        }

        return {
            updateOne: {
                filter: {
                    sourceRevision,
                    "metadata.sourceId": sourceDetails.sourceId,
                    "metadata.chunkKey": chunk.metadata.chunkKey,
                },
                update: {
                    $set: {
                        content: chunk.content,
                        embedding,
                        active: false,
                        sourceRevision,
                        "metadata.sourceType": "vector",
                        "metadata.source": sourceDetails.source,
                        "metadata.sourceId": sourceDetails.sourceId,
                        "metadata.category": sourceDetails.category,
                        "metadata.chunk": chunk.metadata.chunk,
                        "metadata.hash": chunk.metadata.hash,
                        "metadata.chunkKey": chunk.metadata.chunkKey,
                        "metadata.lastUpdatedAt": currentDateTime,
                    },
                    $setOnInsert: {
                        id: uuidv4(),
                        "metadata.uploadedAt": existingDocument?.metadata?.uploadedAt
                            ?? currentDateTime,
                    },
                },
                upsert: true,
            },
        };
    });

    if (stagingOperations.length) {
        await documentsCollection.bulkWrite(stagingOperations, { ordered: false });
    }
};

const normalizeManifestRevisions = (manifest) => {
    if (manifest?.revisions?.length) return manifest.revisions;
    if (!manifest?.activeSourceRevision) return [];

    return [{
        id: manifest.activeSourceRevision,
        sourceHash: manifest.sourceHash,
        chunkKeys: manifest.chunkKeys ?? [],
        chunkCount: manifest.chunkCount ?? 0,
        createdAt: manifest.lastUpdatedAt ?? manifest.createdAt ?? 0,
        lastActivatedAt: manifest.lastUpdatedAt ?? manifest.createdAt ?? 0,
    }];
};

const createRevisionEntry = ({ sourceDetails, sourceRevision, createdAt }) => {
    const chunkKeys = sourceDetails.chunks.map((chunk) => chunk.metadata.chunkKey);

    return {
        id: sourceRevision,
        sourceHash: hashContent(chunkKeys.join("|")),
        chunkKeys,
        chunkCount: chunkKeys.length,
        createdAt,
        lastActivatedAt: createdAt,
    };
};

const activateSourceRevision = async ({ sourceDetails, sourceRevision, createdAt }) => {
    const revisionEntry = createRevisionEntry({
        sourceDetails,
        sourceRevision,
        createdAt,
    });

    return runInTransaction(async (session) => {
        const currentManifest = await ingestionManifestCollection.findOne(
            { _id: sourceDetails.sourceId },
            { session }
        );
        const previousRevisions = normalizeManifestRevisions(currentManifest)
            .filter((revision) => revision.id !== sourceRevision)
            .toSorted((left, right) => right.createdAt - left.createdAt);
        const retainedRevisions = [
            revisionEntry,
            ...previousRevisions.slice(0, PREVIOUS_REVISIONS_TO_RETAIN),
        ];
        const retainedRevisionIds = new Set(retainedRevisions.map((revision) => revision.id));
        const prunedRevisionIds = previousRevisions
            .filter((revision) => !retainedRevisionIds.has(revision.id))
            .map((revision) => revision.id);
        const previousRevisionFilter = {
            "metadata.sourceType": "vector",
            $or: [
                {
                    "metadata.sourceId": sourceDetails.sourceId,
                    active: true,
                },
                {
                    "metadata.source": sourceDetails.source,
                    "metadata.category": sourceDetails.category,
                    "metadata.sourceId": { $exists: false },
                },
            ],
        };

        await documentsCollection.updateMany(
            previousRevisionFilter,
            { $set: { active: false } },
            { session }
        );
        const activationResult = await documentsCollection.updateMany(
            {
                "metadata.sourceId": sourceDetails.sourceId,
                sourceRevision,
            },
            { $set: { active: true } },
            { session }
        );

        if (activationResult.matchedCount !== revisionEntry.chunkCount) {
            throw new Error(`Staged chunk count mismatch for ${sourceDetails.sourceId}`);
        }

        await ingestionManifestCollection.updateOne(
            { _id: sourceDetails.sourceId },
            {
                $set: {
                    source: sourceDetails.source,
                    sourceId: sourceDetails.sourceId,
                    category: sourceDetails.category,
                    activeSourceRevision: sourceRevision,
                    sourceHash: revisionEntry.sourceHash,
                    chunkKeys: revisionEntry.chunkKeys,
                    chunkCount: revisionEntry.chunkCount,
                    revisions: retainedRevisions,
                    lastUpdatedAt: createdAt,
                },
                $setOnInsert: {
                    createdAt,
                },
            },
            { upsert: true, session }
        );

        return { prunedRevisionIds };
    });
};

const removePrunedSourceRevisions = async ({ sourceDetails, prunedRevisionIds }) => {
    const removableRevisionFilters = [{
        "metadata.source": sourceDetails.source,
        "metadata.category": sourceDetails.category,
        "metadata.sourceId": { $exists: false },
    }];

    if (prunedRevisionIds.length) {
        removableRevisionFilters.push({
            "metadata.sourceId": sourceDetails.sourceId,
            sourceRevision: { $in: prunedRevisionIds },
        });
    }

    await documentsCollection.deleteMany({
        active: { $ne: true },
        "metadata.sourceType": "vector",
        $or: removableRevisionFilters,
    });
};

const processSource = async (filePath) => {
    const sourceDetails = await loadSourceChunks(filePath);
    const manifest = await ingestionManifestCollection.findOne({
        _id: sourceDetails.sourceId,
    });
    const existingDocuments = await getExistingSourceDocuments({
        ...sourceDetails,
        manifest,
    });
    const newChunkKeys = sourceDetails.chunks.map((chunk) => chunk.metadata.chunkKey);
    const existingChunks = addChunkKeys(existingDocuments);
    const existingChunkKeys = existingChunks.map((document) => document.metadata.chunkKey);

    if (manifest && arraysMatch(newChunkKeys, existingChunkKeys)) {
        return {
            sourceId: sourceDetails.sourceId,
            status: "unchanged",
        };
    }

    const createdAt = Date.now();
    const sourceRevision = createSourceRevisionId(sourceDetails.sourceId, createdAt);
    let activationResult;

    try {
        await stageSourceRevision({ sourceDetails, existingDocuments, sourceRevision });
        activationResult = await activateSourceRevision({
            sourceDetails,
            sourceRevision,
            createdAt,
        });
    } catch (error) {
        await documentsCollection.deleteMany({
            "metadata.sourceId": sourceDetails.sourceId,
            sourceRevision,
            active: false,
        });
        throw error;
    }

    try {
        await removePrunedSourceRevisions({
            sourceDetails,
            prunedRevisionIds: activationResult.prunedRevisionIds,
        });
    } catch (error) {
        logger.warn(`Pruned revision cleanup failed for ${sourceDetails.sourceId}:`, error);
    }

    return {
        sourceId: sourceDetails.sourceId,
        sourceRevision,
        status: "updated",
        chunkCount: sourceDetails.chunks.length,
    };
};

/**
 * Atomically switches a source to one of its retained revisions.
 */
export const activateRetainedSourceRevision = async (sourceId, targetRevisionId) =>
    runInTransaction(async (session) => {
        const manifest = await ingestionManifestCollection.findOne(
            { _id: sourceId },
            { session }
        );

        if (!manifest) throw new Error(`Manifest not found for source ${sourceId}`);

        const revisions = normalizeManifestRevisions(manifest);
        const targetRevision = revisions.find((revision) => revision.id === targetRevisionId);

        if (!targetRevision) {
            throw new Error(`Revision ${targetRevisionId} is not retained for ${sourceId}`);
        }

        const retainedChunkCount = await documentsCollection.countDocuments(
            {
                "metadata.sourceId": sourceId,
                sourceRevision: targetRevisionId,
            },
            { session }
        );

        if (retainedChunkCount !== targetRevision.chunkCount) {
            throw new Error(`Retained revision ${targetRevisionId} is incomplete`);
        }

        await documentsCollection.updateMany(
            {
                "metadata.sourceId": sourceId,
                active: true,
            },
            { $set: { active: false } },
            { session }
        );
        const activationResult = await documentsCollection.updateMany(
            {
                "metadata.sourceId": sourceId,
                sourceRevision: targetRevisionId,
            },
            { $set: { active: true } },
            { session }
        );

        if (activationResult.matchedCount !== targetRevision.chunkCount) {
            throw new Error(`Could not activate complete revision ${targetRevisionId}`);
        }

        const activatedAt = Date.now();
        const updatedRevisions = revisions.map((revision) => revision.id === targetRevisionId
            ? { ...revision, lastActivatedAt: activatedAt }
            : revision
        );

        await ingestionManifestCollection.updateOne(
            { _id: sourceId },
            {
                $set: {
                    activeSourceRevision: targetRevisionId,
                    sourceHash: targetRevision.sourceHash,
                    chunkKeys: targetRevision.chunkKeys,
                    chunkCount: targetRevision.chunkCount,
                    revisions: updatedRevisions,
                    lastUpdatedAt: activatedAt,
                },
            },
            { session }
        );

        return {
            sourceId,
            activeSourceRevision: targetRevisionId,
        };
    });

const removeDeletedSources = async (discoveredSourceIds) => {
    const manifests = await ingestionManifestCollection.find({}).toArray();
    const uniqueManifests = [...new Map(manifests.map((manifest) => [
        manifest.sourceId,
        manifest,
    ])).values()];
    const deletedManifests = uniqueManifests.filter((manifest) =>
        !discoveredSourceIds.has(manifest.sourceId)
    );

    const outcomes = await Promise.allSettled(deletedManifests.map((manifest) =>
        runInTransaction(async (session) => {
            await documentsCollection.deleteMany(
                { "metadata.sourceId": manifest.sourceId },
                { session }
            );
            await ingestionManifestCollection.deleteMany(
                { sourceId: manifest.sourceId },
                { session }
            );
        })
    ));
    const failedDeletion = outcomes.find((outcome) => outcome.status === "rejected");

    if (failedDeletion) throw failedDeletion.reason;
};

/**
 * Incrementally ingests local profile documents one source at a time.
 */
export const ingestDocuments = async () => {
    const cursorInterval = startCursor("Ingesting documents...");

    try {
        const filePaths = getAllFiles(DATA_DIR);

        if (!filePaths.length) {
            throw new Error(`No ingestable documents found in ${DATA_DIR}`);
        }

        const manifestsBeforeRun = await ingestionManifestCollection.find({}).toArray();
        const existingSourceIds = new Set(manifestsBeforeRun.map((manifest) => manifest.sourceId));
        const discoveredSourceIds = new Set(filePaths.map((filePath) =>
            path.relative(DATA_DIR, filePath).split(path.sep).join("/")
        ));
        const outcomes = await Promise.allSettled(filePaths.map(processSource));
        const failures = outcomes
            .map((outcome, index) => ({ outcome, filePath: filePaths[index] }))
            .filter(({ outcome }) => outcome.status === "rejected");
        const firstTimeFailures = failures.filter(({ filePath }) => {
            const sourceId = path.relative(DATA_DIR, filePath).split(path.sep).join("/");
            return !existingSourceIds.has(sourceId);
        });

        failures.forEach(({ outcome, filePath }) => {
            logger.error(`Ingestion failed for ${filePath}:`, outcome.reason);
        });

        if (firstTimeFailures.length) {
            throw new AggregateError(
                firstTimeFailures.map(({ outcome }) => outcome.reason),
                "Initial ingestion failed for one or more sources"
            );
        }

        await removeDeletedSources(discoveredSourceIds);
        stopCursor(cursorInterval, failures.length
            ? "Ingestion completed with existing-source fallbacks."
            : "Ingestion completed !!");
    } catch (error) {
        stopCursor(cursorInterval, "Ingestion failed !!");
        throw error;
    }
};
