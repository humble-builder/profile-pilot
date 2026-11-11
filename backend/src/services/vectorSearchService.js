/**
 * Answer-generation workflow:
 * load recent history and route intent -> run eligible retrieval providers in parallel ->
 * choose/fuse context -> build the prompt -> call the LLM -> normalize cited sources.
 * Retrieval failures degrade to the remaining provider instead of failing the whole chat request.
 */
import { getConversation } from "../config/memory.js";
import { searchSimilarDocs } from "../retrieval/searchSimilarDocs.js";
import { getLLMResponse } from "./llmService.js";
import { isWebSearchEnabled, searchWeb } from "./webSearchService.js";
import { fuseSearchResults } from "../retrieval/fuseSearchResults.js";
import { logger } from "../utils/logger.js";
import { buildPrompt } from "../utils/buildPrompt.js";
import { v4 as uuidv4 } from "uuid";
import {
    CAREER_PROMPT,
    EVALUATION_PROMPT,
    SAFE_FALLBACK_REPLY,
} from "../../constants/prompts.js";
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

/** Orchestrate retrieval-augmented generation for one normalized chat query. */
export const getAnswer = async (query, {
    loadConversation = getConversation,
    routeRequest = routeIntent,
    searchVector = searchSimilarDocs,
    searchExternalWeb = searchWeb,
    webSearchAvailable = isWebSearchEnabled(),
    generateReply = getLLMResponse,
} = {}) => {
    const { message } = query;
    const startedAt = performance.now();
    const stageDurationsMs = {};
    let currentStage = "conversation_and_routing";
    let stageStartedAt = startedAt;
    const telemetry = {
        intent: "unknown",
        plannedStrategy: "unknown",
        contextMode: "none",
        retrievalSignals: {},
        resultCounts: { vector: 0, web: 0 },
        sourceCount: 0,
    };
    const finishStage = (nextStage) => {
        stageDurationsMs[currentStage] = Math.round(performance.now() - stageStartedAt);
        currentStage = nextStage;
        stageStartedAt = performance.now();
    };

    try {
    const sources = [];
    const requestContext = { message };

    const [conversation, routedRequest] = await Promise.all([
        loadConversation(query),
        routeRequest(message),
    ]);

    const history = conversation.length
        ? conversation.map((conversationMessage) => ({
            role: conversationMessage.role,
            content: conversationMessage.content,
        })).slice(-6)
        : [];

    telemetry.intent = routedRequest.intentResult.predictedIntent;
    telemetry.plannedStrategy = routedRequest.vectorRoute.strategy;
    finishStage("retrieval");

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
            ? searchVector(requestContext)
            : Promise.resolve([]),
        shouldRetrieveWeb && webSearchAvailable
            ? searchExternalWeb(message)
            : Promise.resolve([]),
    ]);

    const retreivedDocs = unwrapRetrievalResult(vectorOutcome, "Vector");
    const webSearchResults = unwrapRetrievalResult(webOutcome, "Web");
    const retrievalDecision = evaluateRetrievalStrategy(executionPlan, {
        vectorResults: retreivedDocs,
        webResults: webSearchResults,
        webSearchAvailable,
    });

    logger.info("DEBUG_ROUTING", JSON.stringify({
        strategy: executionPlan.strategy,
        executionSignals: executionPlan.signals,
        retrievalSignals: retrievalDecision.signals,
        llmContextMode: retrievalDecision.llmContextMode,
        reason: retrievalDecision.reason,
    }));

    telemetry.contextMode = retrievalDecision.llmContextMode;
    telemetry.retrievalSignals = retrievalDecision.signals;
    telemetry.resultCounts = {
        vector: retreivedDocs.length,
        web: webSearchResults.length,
    };

    if (
        retrievalDecision.llmContextMode === "none"
        && retrievalDecision.responseStrategy === "safe_response"
    ) {
        finishStage("complete");
        return {
            reply: SAFE_FALLBACK_REPLY,
            sources: [],
            observability: { ...telemetry, stageDurationsMs: { ...stageDurationsMs } },
        };
    }

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

    finishStage("llm");
    const reply = await generateReply(prompt);
    finishStage("source_grouping");

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

    const groupedSources = [...groupSources.values()];
    telemetry.sourceCount = groupedSources.length;
    finishStage("complete");
    return {
        reply,
        sources: groupedSources,
        observability: { ...telemetry, stageDurationsMs: { ...stageDurationsMs } },
    };
    } catch (error) {
        stageDurationsMs[currentStage] = Math.round(performance.now() - stageStartedAt);
        error.observability = {
            ...telemetry,
            failureStage: currentStage,
            stageDurationsMs: { ...stageDurationsMs },
        };
        throw error;
    }
}
