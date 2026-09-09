export const routeStrategy = ({
    strategy,
    vectorPolicy,
    webPolicy,
    fallbackStrategy,
    confidenceThresholds,
    reason,
}) => {

    const signals = {
        shouldRetrieveVector: vectorPolicy === "required",
        shouldRetrieveWeb: webPolicy === "required",
        shouldRespondDirectly: fallbackStrategy === "direct_response",
        shouldClarify: fallbackStrategy === "clarification",
    };

    return {
        strategy,
        signals,
        confidenceThresholds,
        fallbackStrategy,
        reason,
    };
};

const hasConfidentResult = (results, threshold) => results.some((result) =>
    Number.isFinite(result.score) && result.score >= threshold
);

export const evaluateRetrievalStrategy = (
    executionPlan,
    { vectorResults = [], webResults = [], webSearchAvailable = true } = {},
) => {
    const {
        shouldRetrieveVector,
        shouldRetrieveWeb,
        shouldRespondDirectly,
        shouldClarify,
    } = executionPlan.signals;

    const requiresVector = shouldRetrieveVector;
    const requiresWeb = shouldRetrieveWeb && webSearchAvailable;
    const hasUsableVectorResults = requiresVector
        && hasConfidentResult(vectorResults, executionPlan.confidenceThresholds.vector);
    const hasUsableWebResults = requiresWeb
        && hasConfidentResult(webResults, executionPlan.confidenceThresholds.web);

    const requiresRetrieval = requiresVector || requiresWeb;
    const isVectorPolicySatisfied = !requiresVector
        || hasUsableVectorResults;
    const isWebPolicySatisfied = !requiresWeb
        || hasUsableWebResults;
    const retrievalRequirementsMet = requiresRetrieval
        && isVectorPolicySatisfied
        && isWebPolicySatisfied;

    let llmContextMode = "none";
    let responseStrategy = executionPlan.fallbackStrategy;

    if (retrievalRequirementsMet && !shouldRespondDirectly && !shouldClarify) {
        if (requiresVector && requiresWeb) {
            llmContextMode = "hybrid";
        }
        else if (requiresVector) {
            llmContextMode = "vector";
        }
        else if (requiresWeb) {
            llmContextMode = "web";
        }

        responseStrategy = "grounded_response";
    }

    return {
        llmContextMode,
        responseStrategy,
        signals: {
            hasUsableVectorResults,
            hasUsableWebResults,
            webSearchAvailable,
            webSearchSkipped: shouldRetrieveWeb && !webSearchAvailable,
            isVectorPolicySatisfied,
            isWebPolicySatisfied,
            retrievalRequirementsMet,
        },
        reason: executionPlan.reason,
    };
};
