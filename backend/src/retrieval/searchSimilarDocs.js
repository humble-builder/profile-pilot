import { OpenAIEmbeddings } from "@langchain/openai";
import { documentsCollection } from "../config/db.js";
import { detectIntent } from "../intent/detectIntent.js";
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

    const queryIntent = detectIntent(query);
    const queryEmbedding = await embeddings.embedQuery(query);
    const documents = await documentsCollection.find({}).toArray();

    const scoredDocs = documents
        .filter((doc) => doc.embedding !== undefined && doc.embedding !== null)
        .map((doc) => ({
            ...doc,
            semanticScore: cosineSimilarity(queryEmbedding, doc.embedding),
        }));

    const rerankedDocs = rerankDocuments(scoredDocs, queryIntent);
    const uniqueDocs = semanticDedup(rerankedDocs, 0.90);
    let k = 5; // Default number of top documents to return

    if (queryIntent.detectedIntents.shapeIntents.length > 0) {
        const mappedIntentMetadata = intentToDocumentMap[queryIntent.predictedIntent];
        const queryShapes = queryIntent.detectedIntents.shapeIntents.toSorted((a, b) => b.confidence - a.confidence);
        if (queryShapes[0].intent === "detail_query") {
            k = 10; // Return top 10 relevant documents for detail queries
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

    return uniqueDocs.slice(0, k); // Return top k relevant documents
};

