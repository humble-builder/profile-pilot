import { getConversation } from "../config/memory.js";
import { searchSimilarDocs } from "../retrieval/searchSimilarDocs.js";
import { getLLMResponse } from "./llmService.js";
import { searchWeb } from "./webSearchService.js";
import { fuseSearchResults } from "../retrieval/fuseSearchResults.js";
import { logger } from "../utils/logger.js";
import { buildPrompt } from "../utils/buildPrompt.js";
import { v4 as uuidv4 } from "uuid";
import { CAREER_PROMPT, EVALUATION_PROMPT } from "../../constants/prompts.js";
import { routeIntent } from "../strategy/routeIntent.js";
import {
    evaluateRetrievalStrategy,
    routeStrategy,
} from "../strategy/routeStrategy.js";

const unwrapRetrievalResult = (settledResult, source) => {
    if (settledResult.status === "fulfilled") {
        return settledResult.value;
    }

    logger.error(`${source} retrieval failed:`, settledResult.reason);
    return [];
};

/**
 * Service to perform RAG operations (search doc, retreive history, call LLM service)
 * @param {*} request Request body from the controller
 * @returns LLM response back to controller
 */

export const getAnswer = async (query) => {
    const { message } = query;
    const sources = [];
    const requestContext = { message };

    const [conversation, routedRequest] = await Promise.all([
        getConversation(query),
        routeIntent(message),
    ]);

    const history = conversation.length
        ? conversation.map((conversationMessage) => ({
            role: conversationMessage.role,
            content: conversationMessage.content,
        })).slice(-6)
        : [];

    requestContext.intent = routedRequest.intentResult;
    requestContext.isEvaluationQuery = routedRequest.intentResult.detectedIntents.shapeIntents
        .some((item) => item.intent === "evaluation_query");
    requestContext.assistantPrompt = requestContext.isEvaluationQuery
        ? EVALUATION_PROMPT
        : CAREER_PROMPT;

    const executionPlan = routeStrategy(routedRequest.vectorRoute);
    const {
        shouldRetrieveVector,
        shouldRetrieveWeb,
    } = executionPlan.signals;

    const [vectorOutcome, webOutcome] = await Promise.allSettled([
        shouldRetrieveVector
            ? searchSimilarDocs(requestContext)
            : Promise.resolve([]),
        shouldRetrieveWeb
            ? searchWeb(message)
            : Promise.resolve([]),
    ]);

    const retreivedDocs = unwrapRetrievalResult(vectorOutcome, "Vector");
    const webSearchResults = unwrapRetrievalResult(webOutcome, "Web");
    const retrievalDecision = evaluateRetrievalStrategy(executionPlan, {
        vectorResults: retreivedDocs,
        webResults: webSearchResults,
    });

    logger.info("DEBUG_ROUTING", JSON.stringify({
        strategy: executionPlan.strategy,
        executionSignals: executionPlan.signals,
        retrievalSignals: retrievalDecision.signals,
        llmContextMode: retrievalDecision.llmContextMode,
        reason: retrievalDecision.reason,
    }));

    let llmContextResults = [];

    if (retrievalDecision.llmContextMode === "vector") {
        llmContextResults = retreivedDocs;
    }
    else if (retrievalDecision.llmContextMode === "web") {
        llmContextResults = webSearchResults;
    }
    else if (retrievalDecision.llmContextMode === "hybrid") {
        llmContextResults = fuseSearchResults({
            vectorResults: retreivedDocs,
            webResults: webSearchResults,
        });
    }

    const prompt = buildPrompt({
        requestContext,
        history,
        retrievalContext: {
            mode: retrievalDecision.llmContextMode,
            responseStrategy: retrievalDecision.responseStrategy,
            results: llmContextResults,
        },
    });

    const reply = await getLLMResponse(prompt);

    if (["vector", "hybrid"].includes(retrievalDecision.llmContextMode)) {
        sources.push(...retreivedDocs.map((doc) => ({
            ...doc.metadata,
            score: Number(doc.score.toFixed(3))
        })));
    }

    if (["web", "hybrid"].includes(retrievalDecision.llmContextMode)) {
        sources.push(...webSearchResults.map((result) => result.metadata));
    }

    const uniqueSources = new Map();
    sources.forEach((item) => {
        if (!uniqueSources.has(item.hash)) {
            uniqueSources.set(item.hash, item);
        }
    });

    const groupSources = new Map();
    uniqueSources.forEach((item) => {
        if (item.sourceType === "vector") {
            const chunkScore = {
                number: item.chunk,
                score: item.score
            };
            const key = `${item.sourceType}-${item.category}-${item.source}`;

            if (!groupSources.get(key)) {
                const newSourceObject = {
                    "id": uuidv4(),
                    "type": "vector",
                    "source": item.source,
                    "chunks": [chunkScore]
                };
                groupSources.set(key, newSourceObject);
            }

            else groupSources.get(key).chunks.push(chunkScore);
        }
        else if (item.sourceType === "web") {
            const key = `${item.sourceType}-${item.url}`;

            if (!groupSources.get(key)) {
                const newSourceObject = {
                    "id": uuidv4(),
                    "type": "web",
                    "title": item.title,
                    "url": item.url,
                    "tags": [item.queryType]
                };
                groupSources.set(key, newSourceObject);
            }

            else groupSources.get(key).tags.push(item.queryType);
        }
    })

    return {
        reply,
        sources: [...groupSources.values()]
    };
}
