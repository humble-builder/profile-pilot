import assert from "node:assert/strict";
import test from "node:test";

process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/profile_pilot_test";
process.env.OPENAI_API_KEY ||= "test-only";

const runtimeSettings = await import("../src/config/runtimeSettings.js");
const { searchSimilarDocs } = await import("../src/retrieval/searchSimilarDocs.js");
const { getLLMResponse } = await import("../src/services/llmService.js");
const { getAnswer } = await import("../src/services/vectorSearchService.js");
const { normalizeWebResults, searchWeb } = await import("../src/services/webSearchService.js");

const vectorRoute = {
    strategy: "vector",
    vectorPolicy: "required",
    webPolicy: "blocked",
    fallbackStrategy: "safe_response",
    confidenceThresholds: { vector: 0.5, web: 0.7 },
    reason: "test vector route",
};
const intentResult = {
    predictedIntent: "skills",
    detectedIntents: { domainIntents: [], shapeIntents: [] },
};

test("LLM service uses the active runtime model and joins mock stream chunks", async () => {
    runtimeSettings.setRuntimeSettings(runtimeSettings.normalizeRuntimeSettings({
        chatModel: "mock-chat-model",
    }));
    let request;
    const openAIClient = {
        chat: {
            completions: {
                create: async (input) => {
                    request = input;
                    return (async function* stream() {
                        yield { choices: [{ delta: { content: "Mock " } }] };
                        yield { choices: [{ delta: { content: "reply" } }] };
                    }());
                },
            },
        },
    };

    const messages = [{ role: "user", content: "hello" }];
    assert.equal(await getLLMResponse(messages, { openAIClient }), "Mock reply");
    assert.deepEqual(request, { model: "mock-chat-model", messages, stream: true });
});

test("web service passes routed configuration to a mock API and normalizes results", async () => {
    let receivedRequest;
    const results = await searchWeb("latest backend news", {
        search: async (query, config) => {
            receivedRequest = { query, config };
            return { results: [{ title: "Result", content: "Current fact", score: 0.9, url: "https://example.com" }] };
        },
    });

    assert.equal(receivedRequest.query, "latest backend news");
    assert.equal(results[0].metadata.sourceType, "web");
    assert.equal(results[0].metadata.url, "https://example.com");
    assert.equal(results[0].metadata.queryType, receivedRequest.config.topic);
    assert.deepEqual(normalizeWebResults({}, "general"), []);
});

test("web service degrades mock provider failures to no results", async () => {
    assert.deepEqual(await searchWeb("latest news", {
        search: async () => { throw new Error("mock provider unavailable"); },
    }), []);
});

test("vector search embeds with a mock client and filters incompatible documents", async () => {
    runtimeSettings.setRuntimeSettings(runtimeSettings.normalizeRuntimeSettings({
        embeddingModel: "text-embedding-3-small",
        embeddingDimensions: 3,
    }));
    let mongoFilter;
    const collection = {
        find: (filter) => {
            mongoFilter = filter;
            return {
                toArray: async () => [
                    { content: "backend skills", embedding: [1, 0, 0], metadata: { source: "skills.txt", category: "capabilities" } },
                    { content: "unrelated", embedding: [0, 1, 0], metadata: { source: "other.txt", category: "profile" } },
                ],
            };
        },
    };
    const results = await searchSimilarDocs({
        message: "backend skills",
        intent: intentResult,
    }, {
        embeddings: { embedQuery: async () => [1, 0, 0] },
        collection,
    });

    assert.equal(mongoFilter.active, true);
    assert.equal(typeof mongoFilter["metadata.embeddingConfigHash"], "string");
    assert.equal(results[0].content, "backend skills");
    assert.ok(results[0].score > results[1].score);
});

test("RAG orchestration uses mock services and groups vector citations", async () => {
    let generatedPrompt;
    const response = await getAnswer({ message: "skills" }, {
        loadConversation: async () => [{ role: "user", content: "earlier" }],
        routeRequest: async () => ({ intentResult, vectorRoute }),
        searchVector: async () => [{
            content: "backend skills",
            score: 0.9,
            metadata: {
                hash: "chunk-1",
                sourceType: "vector",
                source: "skills.txt",
                category: "capabilities",
                chunk: 1,
            },
        }],
        searchExternalWeb: async () => { throw new Error("web should not run"); },
        generateReply: async (prompt) => {
            generatedPrompt = prompt;
            return "Mock answer";
        },
    });

    assert.equal(response.reply, "Mock answer");
    assert.equal(response.sources.length, 1);
    assert.equal(response.sources[0].source, "skills.txt");
    assert.deepEqual(response.sources[0].chunks, [{ number: 1, score: 0.9 }]);
    assert.match(generatedPrompt[0].content, /backend skills/);
});

test("RAG orchestration falls back safely when a required mock provider fails", async () => {
    let generatedPrompt;
    const response = await getAnswer({ message: "skills" }, {
        loadConversation: async () => [],
        routeRequest: async () => ({ intentResult, vectorRoute }),
        searchVector: async () => { throw new Error("mock vector failure"); },
        generateReply: async (prompt) => {
            generatedPrompt = prompt;
            return "Safe fallback";
        },
    });

    assert.equal(response.reply, "Safe fallback");
    assert.deepEqual(response.sources, []);
    assert.equal(generatedPrompt.at(-1).content, "skills");
});
