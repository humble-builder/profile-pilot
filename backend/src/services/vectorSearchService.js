import { getConversation } from "../config/memory.js";
import { searchSimilarDocs } from "../retrieval/searchSimilarDocs.js";
import { getLLMResponse } from "./llmService.js";
import { searchWeb } from "./webSearchService.js";
import { fuseSearchResults } from "../retrieval/fuseSearchResults.js";
import { logger } from "../utils/logger.js";
import { v4 as uuidv4 } from "uuid";
import { CAREER_PROMPT, GENERAL_PROMPT } from "../../constants/prompts.js";

/**
 * Service to perform RAG operations (search doc, retreive history, call LLM service)
 * @param {*} request Request body from the controller
 * @returns LLM response back to controller
 */

export const getAnswer = async (query) => {

    const { message } = query;
    const webSearchResults = [];
    const retreivedDocs = [];
    const fusedResults = [];
    let prompt = [];
    const sources = [];

    // Retreive conversation history for the user to provide context to the LLM
    const conversation = await getConversation(query);
    let history = [];

    if (conversation.length) {
        history = conversation.map((message) => ({
            role: message.role,
            content: message.content
        })).slice(-6);
    }

    /**
     * Get the top K documents relevant to user query
     * Fallback to web search for better results
     * Fallback to generic LLM response if search fails
     */

    retreivedDocs.push(...await searchSimilarDocs(message)); // default vector search with cosine similarity
    const topScore = retreivedDocs.length > 0 ? retreivedDocs[0].score : 0;
    logger.info("DEBUG_RETRIEVAL", "Top retrieval score: ", topScore);

    const shouldUseWebSearch = topScore < 0.50; // use web search if document relevance is low
    const shouldUseHybridSearch = topScore >= 0.50 && topScore < 0.85; // Optional: use web search alongside RAG for mid-range scores

    const shouldRetrieveWeb = shouldUseWebSearch || shouldUseHybridSearch; // if we're doing hybrid or web-only search, we want to include web results in context
    const shouldRetrieveVector = !shouldUseWebSearch; // if we're doing hybrid or vector-only, we want to include vector results in context

    if (shouldRetrieveWeb) {
        logger.info("DEBUG_RETRIEVAL", `Document retrieval confidence is ${shouldUseWebSearch ? "low" : "average"}.`);
        webSearchResults.push(...await searchWeb(message)); // call web search service
    }

    const webSearchFailed = shouldRetrieveWeb && webSearchResults.length === 0;
    const webSearchLowConfidence = !webSearchFailed && webSearchResults.every(result => result.score < 0.5);

    // If web and vector search fail to provide relevant results, fallback to direct LLM response without context
    if (shouldUseWebSearch && (webSearchFailed || webSearchLowConfidence)) {
        logger.info("DEBUG_RETRIEVAL", "Web search yielded no results.");

        prompt = buildPrompt(false, false, history, message, [], []); // build prompt without any context
        const fallbackReply = await getLLMResponse(prompt);

        return { reply: fallbackReply, sources: [] }
    }

    /**
     * Build the prompt for the LLM based on the retrieved context and conversation history
     * LLM will use this context to generate a more informed and relevant response to the user's query
     */

    if (shouldRetrieveWeb && shouldRetrieveVector) {
        logger.info("DEBUG_RETRIEVAL", "Fusing document retrieval and web search results.");
        fusedResults.push(...fuseSearchResults({
            vectorResults: retreivedDocs,
            webResults: webSearchResults
        }));
        logger.info("DEBUG_RETRIEVAL", "Top fused result score: ", fusedResults[0]?.finalScore);

        // For hybrid approach, include fused results in the prompt
        prompt = buildPrompt(true,true,history,message,[],[],fusedResults);
    }

    logger.info("DEBUG_THRESHOLD", `Debug logs for threshold tuning:\n
        [use web search] = ${shouldUseWebSearch}
        [use hybrid search] = ${shouldUseHybridSearch}
        [original top vector score] = ${topScore}
        [fused top score] = ${fusedResults[0]?.finalScore}
        `);

    // If only vector results are relevant, include retreived documents in the prompt
    if (!shouldRetrieveWeb && shouldRetrieveVector) {
        logger.info("DEBUG_RETRIEVAL", "High document retrieval confidence.")
        prompt = buildPrompt(true,false,history,message,retreivedDocs);
    }

    // If only web results are relevant, include web search results in the prompt
    if (shouldRetrieveWeb && !shouldRetrieveVector) {
        prompt = buildPrompt(false,true,history,message,[],webSearchResults);
    }

    const reply = await getLLMResponse(prompt);

    /**
     * Compile sources for traceability - where did the LLM's answer come from?
     * This is important for user trust and also for debugging/improving the system over time
     * De-duplicate sources based on content hash
     */

    if (shouldRetrieveVector) {   // Add vector search sources
        sources.push(...retreivedDocs.map((doc) => ({
            ...doc.metadata,
            score: Number(doc.score.toFixed(3))
        })));
    }

    if (shouldRetrieveWeb) {    // Add web search sources
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

/**
 * Builds the prompt for the LLM based on the available context and conversation history
 * @param {*} useVector is vector search context relevant enough to include in prompt
 * @param {*} useWeb is web search context relevant enough to include in prompt
 * @param {*} history conversation history to include in prompt
 * @param {*} vectorResults vector search results to include in prompt
 * @param {*} webResults web search results to include in prompt
 * @param {*} fusedResults fused search results to include in prompt
 */

const buildPrompt = (useVector, useWeb, history, message, vectorResults, webResults, fusedResults) => {

    const pastContext = history.length
        ? history.map((item) => ({role: item.role, content: item.content}))
        : [];
    const prompt = [];

    if (!useVector && !useWeb) {
        prompt.push({
            role: "system",
            content: GENERAL_PROMPT
        });

        if (pastContext.length) {
            prompt.push(...pastContext);
        }

        prompt.push({
            role: "user",
            content: message
        })

        return prompt;
    }

    const context = buildContext(useVector, useWeb, vectorResults, webResults, fusedResults);

    prompt.push({
        role: "system",
        content: `
            ${CAREER_PROMPT}

            Context:
                ${context}
        `
    });

    if (pastContext.length) {
        prompt.push(...pastContext);
    }

    prompt.push({
        role: "user",
        content: message
    });

    return prompt;
}

const buildContext = (useVector, useWeb, vectorResults, webResults, fusedResults) => {
    let context = "";

    if (useVector && !useWeb) {
        context = vectorResults  // format vector documents for LLM prompt
            .map((doc, i) => `Document ${i+1}:\n${doc.content}`)
            .join("\n\n");
    }

    if (useWeb && !useVector) {
        context = webResults // format web search results for LLM prompt
            .map((result, i) => `Web ${i+1}:\n${result.content}`)
            .join("\n\n");
    }

    if (useVector && useWeb) {
        context = fusedResults
        .map((item, i) => {
            const sourceType =
                item.retrievalType === "vector"
                    ? "Document"
                    : "Web";

            return `${sourceType} ${i+1}:\n${item.content}`;
        })
        .join("\n\n");
    }

    return context;
}

