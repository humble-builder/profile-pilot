import { logger } from "../utils/logger.js";

export const fuseSearchResults = ({
    vectorResults = [],
    webResults = []
}) => {

    const fusedResults = [];

    // Vector weighting
    vectorResults.forEach((doc) => {

        let finalScore = doc.score * 1.2; // base boost for vector results

        // Additional boost for highly relevant documents
        if (doc.score > 0.85) {
            finalScore += 0.1;
        }

        fusedResults.push({
            ...doc,
            finalScore,
            retrievalType: "vector"
        });
    });

    // Web weighting
    webResults.forEach((result) => {

        let finalScore = result.score; // start with original web score

        // freshness boost for news/latest queries
        if (result.metadata.queryType === "news") {
            finalScore += 0.15;
        }

        fusedResults.push({
            ...result,
            finalScore,
            retrievalType: "web"
        });
    });

    // Global ranking
    const topKFusedResults = fusedResults
        .toSorted((a, b) => b.finalScore - a.finalScore)
        .slice(0, 8);

    logger.info("DEBUG_FUSION", "Top fused results:\n", topKFusedResults);

    return topKFusedResults;
};
