import { OpenAIEmbeddings } from "@langchain/openai";
import { documentsCollection } from "../config/db.js";
import { rerankDocuments } from "./rerankDocuments.js";
import { cosineSimilarity } from "./cosineSimilarity.js";
import { semanticDedup } from "./semanticDedup.js";
import { intentToDocumentMap } from "../../constants/maps.js";

/**
 * Searches for documents similar to the given query
 * @param {string} query The user's query string for which we want to find similar documents
 * @returns {Promise<Array>} Array of top relevant documents with their similarity scores
 */
export const searchSimilarDocs = async (query) => {
    const embeddings = new OpenAIEmbeddings({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const { message: userQuery, intent: userIntent } = query;
    const queryEmbedding = await embeddings.embedQuery(userQuery);
    const documents = await documentsCollection.find({
        active: true,
        "metadata.sourceType": "vector",
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
