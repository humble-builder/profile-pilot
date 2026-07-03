import { scoreIntent } from "./scoreIntent.js";
import { intentMaxScores } from "../../constants/intentDictionary.js"
import { logger } from "../utils/logger.js";

/**
 * Detects the intent of a given query by scoring it against predefined intent keywords and calculating confidence scores
 * @param {*} query The user's query string for which we want to detect the intent
 * @returns An object containing the predicted intent with the highest confidence and a list of all detected intents with their confidence scores
 */
export const detectIntent = (query) => {
    logger.info(`User query received: ${query.substring(0, 100)}...`);
    logger.info("Starting intent detection...");

    const domainIntents = [];
    const shapeIntents = [];
    const intentScores = scoreIntent(query);
    logger.info("Scoring complete. Listing detected intents...")

    for (const [intent, score] of Object.entries(intentScores)) {
        const confidence = score > 0 ? Number((score / intentMaxScores[intent]).toFixed(3)) : 0;
        if (confidence > 0) {
            if (["list_query", "explain_query"].includes(intent)) {
                shapeIntents.push({ intent, confidence: confidence });
            }
            else {
                domainIntents.push({ intent, confidence: confidence });
            }
            logger.info(`[Intent Match] "${intent}" | Score = ${score} | Confidence = ${confidence})`);
        }
    }

    const sortedIntents = domainIntents.toSorted((a, b) => b.confidence - a.confidence);
    const topIntent = sortedIntents.length > 0 && sortedIntents[0].confidence > 0 ? sortedIntents[0].intent : "general";
    
    logger.info(`Predicted intent: ${topIntent}`);

    return {
        predictedIntent: topIntent,
        detectedIntents: {
            domainIntents,
            shapeIntents
        },
    };
};