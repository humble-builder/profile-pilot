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
    { vectorResults = [], webResults = [] } = {},
) => {
    const {
        shouldRetrieveVector,
        shouldRetrieveWeb,
        shouldRespondDirectly,
        shouldClarify,
    } = executionPlan.signals;

    const hasUsableVectorResults = shouldRetrieveVector
        && hasConfidentResult(vectorResults, executionPlan.confidenceThresholds.vector);
    const hasUsableWebResults = shouldRetrieveWeb
        && hasConfidentResult(webResults, executionPlan.confidenceThresholds.web);

    const requiresRetrieval = shouldRetrieveVector || shouldRetrieveWeb;
    const isVectorPolicySatisfied = !shouldRetrieveVector
        || hasUsableVectorResults;
    const isWebPolicySatisfied = !shouldRetrieveWeb
        || hasUsableWebResults;
    const retrievalRequirementsMet = requiresRetrieval
        && isVectorPolicySatisfied
        && isWebPolicySatisfied;

    let llmContextMode = "none";
    let responseStrategy = executionPlan.fallbackStrategy;

    if (retrievalRequirementsMet && !shouldRespondDirectly && !shouldClarify) {
        if (shouldRetrieveVector && shouldRetrieveWeb) {
            llmContextMode = "hybrid";
        }
        else if (shouldRetrieveVector) {
            llmContextMode = "vector";
        }
        else if (shouldRetrieveWeb) {
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
            isVectorPolicySatisfied,
            isWebPolicySatisfied,
            retrievalRequirementsMet,
        },
        reason: executionPlan.reason,
    };
};
