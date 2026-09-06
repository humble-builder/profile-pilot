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
import {
    createEmbeddingConfigHash,
    LEGACY_OPENAI_EMBEDDING_CONFIG_HASH,
} from "../config/env.js";
import {
    getRuntimeSettings,
    persistRuntimeSettings,
    setRuntimeSettings,
} from "../config/runtimeSettings.js";

const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 100,
});

const DATA_DIR = process.env.DATA_DIR || "../documents/ingestables";
const PREVIOUS_REVISIONS_TO_RETAIN = 3;
let embeddingMigrationInProgress = false;

export const isEmbeddingMigrationInProgress = () => embeddingMigrationInProgress;

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

const embedWithOpenAI = async (texts, embeddingConfig) => {
    const embeddings = new OpenAIEmbeddings({
        apiKey: process.env.OPENAI_API_KEY,
        ...embeddingConfig,
    });
    return embeddings.embedDocuments(texts);
};

const embedMissingChunks = async (
    chunks,
    embeddingConfig
) => {
    if (!chunks.length) return [];

    const chunkBatches = generateBatches(
        chunks.map((chunk) => chunk.content),
        embeddingConfig.batchSize
    );
    const embeddedBatches = await Promise.all(
        chunkBatches.map((batch) => embedWithOpenAI(batch, embeddingConfig))
    );
    const embeddingsArray = embeddedBatches.flat();

    if (embeddingsArray.length !== chunks.length) {
        throw new Error("Embedding count does not match changed chunk count");
    }

    return embeddingsArray;
};

const stageSourceRevision = async ({
    sourceDetails,
    existingDocuments,
    sourceRevision,
    canReuseEmbeddings,
    embeddingConfig,
    embeddingConfigHash,
}) => {
    const existingChunks = addChunkKeys(existingDocuments);
    const existingByChunkKey = new Map(existingChunks.map((document) => [
        document.metadata.chunkKey,
        document,
    ]));
    const chunksNeedingEmbeddings = sourceDetails.chunks.filter((chunk) =>
        !canReuseEmbeddings
        || !existingByChunkKey.get(chunk.metadata.chunkKey)?.embedding
    );
    const generatedEmbeddings = await embedMissingChunks(
        chunksNeedingEmbeddings,
        embeddingConfig
    );
    const generatedEmbeddingByChunkKey = new Map(chunksNeedingEmbeddings.map((chunk, index) => [
        chunk.metadata.chunkKey,
        generatedEmbeddings[index],
    ]));
    const currentDateTime = Date.now();
    const stagingOperations = sourceDetails.chunks.map((chunk) => {
        const existingDocument = existingByChunkKey.get(chunk.metadata.chunkKey);
        const embedding = canReuseEmbeddings
            ? (existingDocument?.embedding
                ?? generatedEmbeddingByChunkKey.get(chunk.metadata.chunkKey))
            : generatedEmbeddingByChunkKey.get(chunk.metadata.chunkKey);

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
                        "metadata.embeddingConfigHash": embeddingConfigHash,
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
    if (manifest?.revisions?.length) {
        return manifest.revisions.map((revision) => ({
            ...revision,
            embeddingConfigHash: revision.embeddingConfigHash
                ?? manifest.embeddingConfigHash
                ?? LEGACY_OPENAI_EMBEDDING_CONFIG_HASH,
        }));
    }
    if (!manifest?.activeSourceRevision) return [];

    return [{
        id: manifest.activeSourceRevision,
        sourceHash: manifest.sourceHash,
        chunkKeys: manifest.chunkKeys ?? [],
        chunkCount: manifest.chunkCount ?? 0,
        embeddingConfigHash: manifest.embeddingConfigHash
            ?? LEGACY_OPENAI_EMBEDDING_CONFIG_HASH,
        createdAt: manifest.lastUpdatedAt ?? manifest.createdAt ?? 0,
        lastActivatedAt: manifest.lastUpdatedAt ?? manifest.createdAt ?? 0,
    }];
};

const createRevisionEntry = ({
    sourceDetails,
    sourceRevision,
    createdAt,
    activated,
    embeddingConfigHash,
}) => {
    const chunkKeys = sourceDetails.chunks.map((chunk) => chunk.metadata.chunkKey);

    return {
        id: sourceRevision,
        sourceHash: hashContent(chunkKeys.join("|")),
        chunkKeys,
        chunkCount: chunkKeys.length,
        embeddingConfigHash,
        createdAt,
        lastActivatedAt: activated ? createdAt : null,
    };
};

const retainSourceRevisions = ({ revisions, activeRevisionId, latestRevisionId }) => {
    const maximumRevisions = PREVIOUS_REVISIONS_TO_RETAIN + 1;
    const sortedRevisions = revisions.toSorted(
        (left, right) => right.createdAt - left.createdAt
    );
    const requiredRevisionIds = new Set(
        [activeRevisionId, latestRevisionId].filter(Boolean)
    );
    const retainedRevisions = sortedRevisions.filter((revision) =>
        requiredRevisionIds.has(revision.id)
    );

    for (const revision of sortedRevisions) {
        if (retainedRevisions.length >= maximumRevisions) break;
        if (!retainedRevisions.some((retained) => retained.id === revision.id)) {
            retainedRevisions.push(revision);
        }
    }

    const retainedRevisionIds = new Set(retainedRevisions.map((revision) => revision.id));
    const prunedRevisionIds = sortedRevisions
        .filter((revision) => !retainedRevisionIds.has(revision.id))
        .map((revision) => revision.id);

    return { retainedRevisions, prunedRevisionIds };
};

const activateSourceRevision = async ({
    sourceDetails,
    sourceRevision,
    createdAt,
    embeddingConfigHash,
}) => {
    const revisionEntry = createRevisionEntry({
        sourceDetails,
        sourceRevision,
        createdAt,
        activated: true,
        embeddingConfigHash,
    });

    return runInTransaction(async (session) => {
        const currentManifest = await ingestionManifestCollection.findOne(
            { _id: sourceDetails.sourceId },
            { session }
        );
        const previousRevisions = normalizeManifestRevisions(currentManifest)
            .filter((revision) => revision.id !== sourceRevision);
        const { retainedRevisions, prunedRevisionIds } = retainSourceRevisions({
            revisions: [revisionEntry, ...previousRevisions],
            activeRevisionId: sourceRevision,
            latestRevisionId: sourceRevision,
        });
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
                    latestSourceRevision: sourceRevision,
                    updateAvailable: false,
                    sourceHash: revisionEntry.sourceHash,
                    chunkKeys: revisionEntry.chunkKeys,
                    chunkCount: revisionEntry.chunkCount,
                    embeddingConfigHash: revisionEntry.embeddingConfigHash,
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

const recordStagedSourceRevision = async ({
    sourceDetails,
    sourceRevision,
    createdAt,
    embeddingConfigHash,
}) => {
    const revisionEntry = createRevisionEntry({
        sourceDetails,
        sourceRevision,
        createdAt,
        activated: false,
        embeddingConfigHash,
    });

    return runInTransaction(async (session) => {
        const currentManifest = await ingestionManifestCollection.findOne(
            { _id: sourceDetails.sourceId },
            { session }
        );

        if (!currentManifest?.activeSourceRevision) {
            throw new Error(`Cannot stage a revision without an active source revision`);
        }

        const previousPendingRevisionId = currentManifest.latestSourceRevision
            !== currentManifest.activeSourceRevision
            ? currentManifest.latestSourceRevision
            : null;
        const previousRevisions = normalizeManifestRevisions(currentManifest)
            .filter((revision) => revision.id !== sourceRevision)
            .filter((revision) => revision.id !== previousPendingRevisionId);
        const { retainedRevisions, prunedRevisionIds } = retainSourceRevisions({
            revisions: [revisionEntry, ...previousRevisions],
            activeRevisionId: currentManifest.activeSourceRevision,
            latestRevisionId: sourceRevision,
        });

        const stagedChunkCount = await documentsCollection.countDocuments(
            {
                "metadata.sourceId": sourceDetails.sourceId,
                sourceRevision,
                active: false,
            },
            { session }
        );

        if (stagedChunkCount !== revisionEntry.chunkCount) {
            throw new Error(`Staged chunk count mismatch for ${sourceDetails.sourceId}`);
        }

        if (previousPendingRevisionId) {
            prunedRevisionIds.push(previousPendingRevisionId);
        }

        await ingestionManifestCollection.updateOne(
            { _id: sourceDetails.sourceId },
            {
                $set: {
                    source: sourceDetails.source,
                    sourceId: sourceDetails.sourceId,
                    category: sourceDetails.category,
                    latestSourceRevision: sourceRevision,
                    updateAvailable: true,
                    revisions: retainedRevisions,
                    lastUpdatedAt: createdAt,
                },
            },
            { session }
        );

        return { prunedRevisionIds: [...new Set(prunedRevisionIds)] };
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

const processSource = async (
    filePath,
    { activateAfterIngestion } = {}
) => {
    const { embeddingConfig } = getRuntimeSettings();
    const embeddingConfigHash = createEmbeddingConfigHash(embeddingConfig);
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
    const existingEmbeddingConfigHash = manifest?.embeddingConfigHash
        ?? LEGACY_OPENAI_EMBEDDING_CONFIG_HASH;
    const canReuseEmbeddings = existingEmbeddingConfigHash
        === embeddingConfigHash;
    const latestSourceRevision = manifest?.latestSourceRevision
        ?? manifest?.activeSourceRevision;

    if (
        manifest?.activeSourceRevision
        && latestSourceRevision !== manifest.activeSourceRevision
    ) {
        const latestRevision = normalizeManifestRevisions(manifest)
            .find((revision) => revision.id === latestSourceRevision);
        const latestDocuments = await documentsCollection.find({
            "metadata.sourceId": sourceDetails.sourceId,
            sourceRevision: latestSourceRevision,
        }).sort({ "metadata.chunk": 1 }).toArray();
        const latestChunkKeys = addChunkKeys(latestDocuments)
            .map((document) => document.metadata.chunkKey);

        if (
            latestRevision?.embeddingConfigHash === embeddingConfigHash
            && arraysMatch(newChunkKeys, latestChunkKeys)
        ) {
            return {
                sourceId: sourceDetails.sourceId,
                sourceRevision: latestSourceRevision,
                status: "pending_activation",
            };
        }
    }

    if (
        manifest
        && canReuseEmbeddings
        && arraysMatch(newChunkKeys, existingChunkKeys)
    ) {
        return {
            sourceId: sourceDetails.sourceId,
            status: "unchanged",
        };
    }

    const createdAt = Date.now();
    const sourceRevision = createSourceRevisionId(sourceDetails.sourceId, createdAt);
    let activationResult;
    const shouldActivate = !manifest?.activeSourceRevision
        || activateAfterIngestion === true
        || (activateAfterIngestion === undefined && !manifest?.updateAvailable);

    try {
        await stageSourceRevision({
            sourceDetails,
            existingDocuments,
            sourceRevision,
            canReuseEmbeddings,
            embeddingConfig,
            embeddingConfigHash,
        });
        activationResult = shouldActivate
            ? await activateSourceRevision({
                sourceDetails,
                sourceRevision,
                createdAt,
                embeddingConfigHash,
            })
            : await recordStagedSourceRevision({
                sourceDetails,
                sourceRevision,
                createdAt,
                embeddingConfigHash,
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
        status: shouldActivate ? "updated" : "staged",
        chunkCount: sourceDetails.chunks.length,
    };
};

export const ingestSourceFile = async (filePath, options) => processSource(
    filePath,
    options
);

/**
 * Atomically switches a source to one of its retained revisions.
 */
export const activateRetainedSourceRevision = async (sourceId, targetRevisionId) =>
    runInTransaction(async (session) => {
        const activeEmbeddingConfigHash = createEmbeddingConfigHash(
            getRuntimeSettings().embeddingConfig
        );
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

        if (targetRevision.embeddingConfigHash !== activeEmbeddingConfigHash) {
            throw new Error(
                `Revision ${targetRevisionId} uses a different embedding configuration`
            );
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
        const latestSourceRevision = manifest.latestSourceRevision
            ?? manifest.activeSourceRevision;
        const updatedRevisions = revisions.map((revision) => revision.id === targetRevisionId
            ? { ...revision, lastActivatedAt: activatedAt }
            : revision
        );

        await ingestionManifestCollection.updateOne(
            { _id: sourceId },
            {
                $set: {
                    activeSourceRevision: targetRevisionId,
                    latestSourceRevision,
                    updateAvailable: targetRevisionId !== latestSourceRevision,
                    sourceHash: targetRevision.sourceHash,
                    chunkKeys: targetRevision.chunkKeys,
                    chunkCount: targetRevision.chunkCount,
                    embeddingConfigHash: targetRevision.embeddingConfigHash,
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

export const migrateEmbeddingConfiguration = async (nextSettings) => {
    if (embeddingMigrationInProgress) {
        throw new Error("An embedding configuration migration is already running");
    }

    embeddingMigrationInProgress = true;
    const embeddingConfig = nextSettings.embeddingConfig;
    const embeddingConfigHash = createEmbeddingConfigHash(embeddingConfig);
    const preparedSources = [];

    try {
        const filePaths = getAllFiles(DATA_DIR);
        if (!filePaths.length) {
            throw new Error(`No ingestable documents found in ${DATA_DIR}`);
        }

        for (const filePath of filePaths) {
            const sourceDetails = await loadSourceChunks(filePath);
            const manifest = await ingestionManifestCollection.findOne({
                _id: sourceDetails.sourceId,
            });
            const existingDocuments = await getExistingSourceDocuments({
                ...sourceDetails,
                manifest,
            });
            const existingEmbeddingConfigHash = manifest?.embeddingConfigHash
                ?? LEGACY_OPENAI_EMBEDDING_CONFIG_HASH;
            const sourceRevision = createSourceRevisionId(
                sourceDetails.sourceId,
                Date.now()
            );
            const preparedSource = {
                sourceDetails,
                sourceRevision,
                createdAt: Date.now(),
            };
            preparedSources.push(preparedSource);

            await stageSourceRevision({
                sourceDetails,
                existingDocuments,
                sourceRevision,
                canReuseEmbeddings: existingEmbeddingConfigHash === embeddingConfigHash,
                embeddingConfig,
                embeddingConfigHash,
            });
        }

        const cleanupPlans = await runInTransaction(async (session) => {
            const plans = [];

            for (const preparedSource of preparedSources) {
                const { sourceDetails, sourceRevision, createdAt } = preparedSource;
                const currentManifest = await ingestionManifestCollection.findOne(
                    { _id: sourceDetails.sourceId },
                    { session }
                );
                const revisionEntry = createRevisionEntry({
                    sourceDetails,
                    sourceRevision,
                    createdAt,
                    activated: true,
                    embeddingConfigHash,
                });
                const previousRevisions = normalizeManifestRevisions(currentManifest)
                    .filter((revision) => revision.id !== sourceRevision);
                const { retainedRevisions, prunedRevisionIds } = retainSourceRevisions({
                    revisions: [revisionEntry, ...previousRevisions],
                    activeRevisionId: sourceRevision,
                    latestRevisionId: sourceRevision,
                });

                await documentsCollection.updateMany(
                    {
                        "metadata.sourceType": "vector",
                        $or: [
                            { "metadata.sourceId": sourceDetails.sourceId, active: true },
                            {
                                "metadata.source": sourceDetails.source,
                                "metadata.category": sourceDetails.category,
                                "metadata.sourceId": { $exists: false },
                            },
                        ],
                    },
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
                    throw new Error(
                        `Prepared chunk count mismatch for ${sourceDetails.sourceId}`
                    );
                }

                await ingestionManifestCollection.updateOne(
                    { _id: sourceDetails.sourceId },
                    {
                        $set: {
                            source: sourceDetails.source,
                            sourceId: sourceDetails.sourceId,
                            category: sourceDetails.category,
                            activeSourceRevision: sourceRevision,
                            latestSourceRevision: sourceRevision,
                            updateAvailable: false,
                            sourceHash: revisionEntry.sourceHash,
                            chunkKeys: revisionEntry.chunkKeys,
                            chunkCount: revisionEntry.chunkCount,
                            embeddingConfigHash,
                            revisions: retainedRevisions,
                            lastUpdatedAt: createdAt,
                        },
                        $setOnInsert: { createdAt },
                    },
                    { upsert: true, session }
                );
                plans.push({ sourceDetails, prunedRevisionIds });
            }

            await persistRuntimeSettings(nextSettings, { session });
            return plans;
        });

        setRuntimeSettings(nextSettings);

        for (const cleanupPlan of cleanupPlans) {
            try {
                await removePrunedSourceRevisions(cleanupPlan);
            } catch (error) {
                logger.warn(
                    `Pruned revision cleanup failed for ${cleanupPlan.sourceDetails.sourceId}:`,
                    error
                );
            }
        }

        return {
            embeddingConfigHash,
            migratedSourceCount: preparedSources.length,
        };
    } catch (error) {
        await Promise.allSettled(preparedSources.map(({ sourceDetails, sourceRevision }) =>
            documentsCollection.deleteMany({
                "metadata.sourceId": sourceDetails.sourceId,
                sourceRevision,
                active: false,
            })
        ));
        throw error;
    } finally {
        embeddingMigrationInProgress = false;
    }
};

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
