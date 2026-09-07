/**
 * Vector-retrieval workflow:
 * embed with the active runtime configuration -> load only compatible active documents -> score
 * and rerank -> expand or deduplicate results according to the detected query shape.
 */
import { OpenAIEmbeddings } from "@langchain/openai";
import { documentsCollection } from "../config/db.js";
import { rerankDocuments } from "./rerankDocuments.js";
import { cosineSimilarity } from "./cosineSimilarity.js";
import { semanticDedup } from "./semanticDedup.js";
import { intentToDocumentMap } from "../../constants/maps.js";
import {
    createEmbeddingConfigHash,
    LEGACY_OPENAI_EMBEDDING_CONFIG_HASH,
} from "../config/env.js";
import { getRuntimeSettings } from "../config/runtimeSettings.js";

/** Return the document chunks most relevant to a routed query and its detected intent. */
export const searchSimilarDocs = async (
    query,
    { embeddings: injectedEmbeddings, collection } = {}
) => {
    const { embeddingConfig } = getRuntimeSettings();
    const embeddingConfigHash = createEmbeddingConfigHash(embeddingConfig);
    const embeddings = injectedEmbeddings ?? new OpenAIEmbeddings({
        apiKey: process.env.OPENAI_API_KEY,
        ...embeddingConfig,
    });
    const documentStore = collection ?? documentsCollection;

    const { message: userQuery, intent: userIntent } = query;
    const queryEmbedding = await embeddings.embedQuery(userQuery);
    const embeddingCompatibilityFilter = embeddingConfigHash
        === LEGACY_OPENAI_EMBEDDING_CONFIG_HASH
        ? {
            $or: [
                { "metadata.embeddingConfigHash": embeddingConfigHash },
                { "metadata.embeddingConfigHash": { $exists: false } },
            ],
        }
        : { "metadata.embeddingConfigHash": embeddingConfigHash };
    const documents = await documentStore.find({
        active: true,
        "metadata.sourceType": "vector",
        ...embeddingCompatibilityFilter,
    }).toArray();

    const scoredDocs = documents
        .filter((doc) => doc.embedding !== undefined && doc.embedding !== null)
        .map((doc) => ({
            ...doc,
            semanticScore: cosineSimilarity(queryEmbedding, doc.embedding),
        }));

    const rerankedDocs = rerankDocuments(scoredDocs, userIntent);
    let k = 5; // Default number of top documents to return

    if (userIntent.detectedIntents.shapeIntents.length > 0) {
        const mappedIntentMetadata = intentToDocumentMap[userIntent.predictedIntent];
        const queryShapes = userIntent.detectedIntents.shapeIntents.toSorted((a, b) => b.confidence - a.confidence);
        if (queryShapes[0].intent === "detail_query") {
            k = 10; // Return top 10 relevant documents for detail queries
        }
        else if (queryShapes[0].intent === "evaluation_query") {
            // Return relevant documents from multiple sources under category from matched intent metadata
            const matchedCategoryDocs = mappedIntentMetadata
                ? rerankedDocs.filter((doc) =>
                    doc.metadata.category === mappedIntentMetadata.category
                )
                : rerankedDocs;

            const sourceCategoryHashMap = {};
            const reducedDocChunks = [];
            for (const doc of matchedCategoryDocs) {
                const key = `${doc.metadata.category}-${doc.metadata.source}`;
                const isMappedSource = doc.metadata.source === mappedIntentMetadata?.source;
                const sourceChunkLimit = isMappedSource ? 5 : 3;

                if (sourceCategoryHashMap[key] === undefined) {
                    reducedDocChunks.push(doc);
                    sourceCategoryHashMap[key] = 1;
                }
                else if (sourceCategoryHashMap[key] < sourceChunkLimit) {
                    reducedDocChunks.push(doc);
                    sourceCategoryHashMap[key] += 1;
                }
            }

            return reducedDocChunks;
        }
        else {
            if (!mappedIntentMetadata) return [];
            // Return expanded results by matched metadata for list queries
            const matchedSourceDocs = rerankedDocs
                .filter(doc =>
                    doc.metadata.source === mappedIntentMetadata.source &&
                    doc.metadata.category === mappedIntentMetadata.category
                )
                .toSorted((a, b) => a.metadata.chunk - b.metadata.chunk);

            return matchedSourceDocs;
        }
    }

    const uniqueDocs = semanticDedup(rerankedDocs, 0.90);
    return uniqueDocs.slice(0, k); // Return top k relevant documents
};
