import { detectIntent } from "../intent/detectIntent.js";
import { logger } from "../utils/logger.js";
import { intentToDocumentMap } from "../../constants/maps.js";
/**
 * Reranks a list of retrieved documents based on their relevance to the user's query intent
 * @param {*} retreivedDocs Array of documents retrieved from the search step, each with a relevance score
 * @param {*} queryIntent The detected intent of the user's query, used to adjust relevance scores of documents
 * @return {Array} Array of reranked documents based on relevance to query intent
 */
export const rerankDocuments = (retreivedDocs, queryIntent) => {
    // For simplicity, we will boost the relevance score of documents that match the query intent
    const rerankedDocs = retreivedDocs.map((doc) => {
        const docIntent = detectIntent(doc.content);
        const intentMatch = docIntent.predictedIntent === queryIntent.predictedIntent;
        const intentScore = 0.2 * (intentMatch ? 1 : 0); // Boost score by 30% if intent matches
        const semanticScore = 0.6 * doc.semanticScore; // Original semantic score contributes 70%
        let adjustedScore = semanticScore + intentScore; // Combine both scores

        if (adjustedScore < 0.80) {
            const intentDocumentSourceMatch = intentToDocumentMap[queryIntent.predictedIntent]?.source === doc.metadata.source;
            const intentDocumentCategoryMatch = intentToDocumentMap[queryIntent.predictedIntent]?.category === doc.metadata.category;
            const needMetadataBoost = intentDocumentSourceMatch && intentDocumentCategoryMatch;
            const metadataBoost = needMetadataBoost ? 0.2 : 0; // Boost score by 20% if metadata matches
            adjustedScore += metadataBoost;
        }

        return {
            ...doc,
            intentScore,
            semanticScore,
            score: adjustedScore
        };
    });

    const sortedDocs = rerankedDocs.toSorted((a, b) => b.score - a.score); // Sort documents by adjusted score in descending order
    logger.info("DEBUG_RERANK", `Top reranked documents after intent adjustment for ${queryIntent.predictedIntent}:`,
        sortedDocs.slice(0, 3).map(doc => ({
            intentScore: doc.intentScore.toFixed(2),
            semanticScore: doc.semanticScore.toFixed(2),
            totalScore: doc.score.toFixed(2),
            contentSnippet: doc.content.substring(0, 100) + '...' // Show a snippet of the content
        }))
    );

    return sortedDocs;
}
