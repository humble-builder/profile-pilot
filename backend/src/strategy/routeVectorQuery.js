import {
    freshnessKeywords,
    quickLookupKeywords,
    researchBoundKeywords,
} from "../../constants/tavilyQueryKeywords.js";

const CONFIDENCE_THRESHOLDS = Object.freeze({
    vector: 0.50,
    web: 0.70,
});

const matchIfAny = (query, keywords) => keywords.some((keyword) => query.includes(keyword));

const createVectorStrategy = ({
    strategy,
    vectorPolicy,
    webPolicy,
    fallbackStrategy,
    reason,
}) => ({
    strategy,
    vectorPolicy,
    webPolicy,
    fallbackStrategy,
    confidenceThresholds: CONFIDENCE_THRESHOLDS,
    reason,
});

const personOrComparisonMarkers = new Set([
    "who is",
    "compare",
    "vs",
]);

const generalKnowledgeMarkers = [
    ...quickLookupKeywords,
    ...researchBoundKeywords,
].filter((keyword) => !personOrComparisonMarkers.has(keyword));

const selectVectorStrategy = ({ signals, hasEvaluationIntent }) => {
    const {
        hasProfileOwner,
        hasExternalReference,
        hasUnresolvedReference,
        hasContextualPronoun,
        requiresCurrentInformation,
        isGeneralKnowledge,
    } = signals;

    if (hasUnresolvedReference || hasContextualPronoun) {
        return createVectorStrategy({
            strategy: "clarify",
            vectorPolicy: "blocked",
            webPolicy: "blocked",
            fallbackStrategy: "clarification",
            reason: hasUnresolvedReference
                ? "The referenced person is unresolved."
                : "The contextual pronoun has not been resolved.",
        });
    }

    if (hasProfileOwner && hasExternalReference) {
        return createVectorStrategy({
            strategy: "hybrid",
            vectorPolicy: "required",
            webPolicy: "required",
            fallbackStrategy: "safe_response",
            reason: "The query compares the profile owner with an external entity.",
        });
    }

    if (hasProfileOwner && requiresCurrentInformation && hasEvaluationIntent) {
        return createVectorStrategy({
            strategy: "hybrid",
            vectorPolicy: "required",
            webPolicy: "required",
            fallbackStrategy: "safe_response",
            reason: "The profile evaluation requires current external information.",
        });
    }

    if (hasExternalReference) {
        return createVectorStrategy({
            strategy: "web",
            vectorPolicy: "blocked",
            webPolicy: "required",
            fallbackStrategy: "safe_response",
            reason: "The query concerns a resolved external entity.",
        });
    }

    if (hasProfileOwner) {
        return createVectorStrategy({
            strategy: "vector",
            vectorPolicy: "required",
            webPolicy: "blocked",
            fallbackStrategy: "safe_response",
            reason: requiresCurrentInformation
                ? "The profile intent is locally grounded, so generic freshness is ignored."
                : "The query concerns the locally verified profile owner.",
        });
    }

    if (isGeneralKnowledge && requiresCurrentInformation) {
        return createVectorStrategy({
            strategy: "web",
            vectorPolicy: "blocked",
            webPolicy: "required",
            fallbackStrategy: "safe_response",
            reason: "The general-knowledge query requires current information.",
        });
    }

    if (isGeneralKnowledge) {
        return createVectorStrategy({
            strategy: "direct",
            vectorPolicy: "blocked",
            webPolicy: "blocked",
            fallbackStrategy: "direct_response",
            reason: "The stable general-knowledge query needs no retrieval.",
        });
    }

    return createVectorStrategy({
        strategy: "clarify",
        vectorPolicy: "blocked",
        webPolicy: "blocked",
        fallbackStrategy: "clarification",
        reason: "The query does not contain enough routing information.",
    });
};

export const routeVectorQuery = ({ message, intentResult, entityResult }) => {
    const normalizedQuery = message.toLowerCase();
    const detectedEntities = entityResult.detectedEntities;
    const shapeIntents = intentResult.detectedIntents.shapeIntents;

    const hasProfileOwner = detectedEntities.some((entity) =>
        entity.entityRole === "primary"
        && entity.normalizedValue === "profile_owner"
    );

    const hasExternalReference = detectedEntities.some((entity) =>
        entity.entityRole === "reference"
        && entity.normalizedValue === "external_person"
    );

    const hasUnresolvedReference = detectedEntities.some((entity) =>
        entity.entityRole === "reference"
        && entity.normalizedValue === "unknown_person"
    );

    const hasContextualPronoun = detectedEntities.some((entity) =>
        entity.entityRole === "contextual"
    );

    const hasCurrentMarketContext = normalizedQuery.includes("current")
        && normalizedQuery.includes("market");
    const requiresCurrentInformation = matchIfAny(normalizedQuery, freshnessKeywords)
        || hasCurrentMarketContext;

    const hasEvaluationIntent = shapeIntents.some((intent) =>
        intent.intent === "evaluation_query"
    );
    const hasPersonFocusedIntent = hasEvaluationIntent
        || intentResult.predictedIntent === "profile_summary";

    const hasDetectedEntity = detectedEntities.length > 0;
    const hasGeneralKnowledgeMarker = matchIfAny(normalizedQuery, generalKnowledgeMarkers);
    const isGeneralKnowledge = !hasDetectedEntity
        && !hasPersonFocusedIntent
        && (
            intentResult.predictedIntent === "general"
            || requiresCurrentInformation
            || hasGeneralKnowledgeMarker
        );

    const signals = {
        hasProfileOwner,
        hasExternalReference,
        hasUnresolvedReference,
        hasContextualPronoun,
        requiresCurrentInformation,
        isGeneralKnowledge,
    };

    return {
        signals,
        ...selectVectorStrategy({ signals, hasEvaluationIntent }),
    };
};
