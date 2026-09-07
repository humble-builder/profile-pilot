import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { generateBatches } from "../src/data/generateBatches.js";
import { loadDocument } from "../src/data/loadDataFiles.js";
import { detectEntity } from "../src/entity/detectEntity.js";
import { detectIntent } from "../src/intent/detectIntent.js";
import { cosineSimilarity } from "../src/retrieval/cosineSimilarity.js";
import { fuseSearchResults } from "../src/retrieval/fuseSearchResults.js";
import { semanticDedup } from "../src/retrieval/semanticDedup.js";
import { evaluateRetrievalStrategy, routeStrategy } from "../src/strategy/routeStrategy.js";
import { routeIntent } from "../src/strategy/routeIntent.js";
import { routeTavilyConfig } from "../src/strategy/routeTavilyQuery.js";
import { routeVectorQuery } from "../src/strategy/routeVectorQuery.js";
import { buildContext } from "../src/utils/buildContext.js";
import { buildPrompt } from "../src/utils/buildPrompt.js";
import { hashContent } from "../src/utils/hashContent.js";

test("batching and hashing keep stable data boundaries", () => {
    assert.deepEqual(generateBatches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(generateBatches([], 10), []);
    assert.equal(hashContent("  Profile Content "), hashContent("profile content"));
    assert.notEqual(hashContent("profile content"), hashContent("different content"));
});

test("cosine similarity and semantic dedup retain distinct vectors", () => {
    assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
    assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);

    const first = { content: "first", embedding: [1, 0] };
    const duplicate = { content: "duplicate", embedding: [0.99, 0.01] };
    const distinct = { content: "distinct", embedding: [0, 1] };
    assert.deepEqual(semanticDedup([first, duplicate, distinct], 0.95), [first, distinct]);
});

test("entity and intent detection identify profile and query shape", () => {
    const entities = detectEntity("List every skill for Vishal Singh");
    assert.equal(entities.predictedEntity.normalizedValue, "profile_owner");
    assert.equal(entities.predictedEntity.matchedText, "Vishal Singh");

    const intent = detectIntent("List every backend skill and technology");
    assert.equal(intent.predictedIntent, "skills");
    assert.ok(intent.detectedIntents.shapeIntents.some(({ intent: name }) =>
        name === "list_query"
    ));
});

test("combined intent routing and Tavily policy choose expected strategies", async () => {
    const routed = await routeIntent("List Vishal's backend skills");
    assert.equal(routed.intentResult.predictedIntent, "skills");
    assert.equal(routed.vectorRoute.strategy, "vector");
    assert.equal(routeTavilyConfig("latest technology news").topic, "news");
    assert.equal(routeTavilyConfig("deep dive into architecture").search_depth, "advanced");
    assert.equal(routeTavilyConfig("deep dive into architecture").include_answer, false);
});

test("document loader reads text and rejects unsupported formats", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "profilepilot-loader-"));
    const textPath = path.join(directory, "profile.txt");
    try {
        await writeFile(textPath, "Profile text");
        const documents = await loadDocument(textPath);
        assert.equal(documents[0].pageContent, "Profile text");
        assert.equal(documents[0].metadata.type, "txt");
        await assert.rejects(loadDocument(path.join(directory, "profile.csv")), /Unsupported file type/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("vector routing distinguishes profile, fresh web, and unresolved pronoun requests", () => {
    const profileRoute = routeVectorQuery({
        message: "What skills does Vishal have?",
        intentResult: detectIntent("What skills does Vishal have?"),
        entityResult: detectEntity("What skills does Vishal have?"),
    });
    assert.equal(profileRoute.strategy, "vector");

    const webRoute = routeVectorQuery({
        message: "What is the latest Node.js release?",
        intentResult: detectIntent("What is the latest Node.js release?"),
        entityResult: detectEntity("What is the latest Node.js release?"),
    });
    assert.equal(webRoute.strategy, "web");

    const clarificationRoute = routeVectorQuery({
        message: "What are his skills?",
        intentResult: detectIntent("What are his skills?"),
        entityResult: detectEntity("What are his skills?"),
    });
    assert.equal(clarificationRoute.strategy, "clarify");
});

test("retrieval evaluation requires every required provider to meet confidence", () => {
    const plan = routeStrategy({
        strategy: "hybrid",
        vectorPolicy: "required",
        webPolicy: "required",
        fallbackStrategy: "safe_response",
        confidenceThresholds: { vector: 0.5, web: 0.7 },
        reason: "test",
    });

    assert.equal(evaluateRetrievalStrategy(plan, {
        vectorResults: [{ score: 0.8 }],
        webResults: [{ score: 0.75 }],
    }).llmContextMode, "hybrid");
    assert.equal(evaluateRetrievalStrategy(plan, {
        vectorResults: [{ score: 0.8 }],
        webResults: [{ score: 0.6 }],
    }).llmContextMode, "none");
});

test("context and prompt builders preserve source labels and history order", () => {
    const context = buildContext({
        mode: "hybrid",
        results: [
            { retrievalType: "vector", content: "profile fact" },
            { retrievalType: "web", content: "market fact" },
        ],
    });
    assert.match(context, /Document 1:\nprofile fact/);
    assert.match(context, /Web 2:\nmarket fact/);

    const prompt = buildPrompt({
        requestContext: { message: "Question", assistantPrompt: "Grounded assistant" },
        history: [{ role: "assistant", content: "Earlier answer" }],
        retrievalContext: {
            mode: "hybrid",
            responseStrategy: "grounded_response",
            results: [{ retrievalType: "vector", content: "profile fact" }],
        },
    });
    assert.deepEqual(prompt.at(-1), { role: "user", content: "Question" });
    assert.deepEqual(prompt.at(-2), { role: "assistant", content: "Earlier answer" });
    assert.match(prompt[0].content, /profile fact/);
});

test("fusion applies provider boosts and returns a global ranking", () => {
    const results = fuseSearchResults({
        vectorResults: [{ content: "vector", score: 0.8, metadata: {} }],
        webResults: [{ content: "web", score: 0.9, metadata: { queryType: "news" } }],
    });
    assert.equal(results[0].content, "web");
    assert.equal(results[0].retrievalType, "web");
    assert.equal(results[1].retrievalType, "vector");
});
