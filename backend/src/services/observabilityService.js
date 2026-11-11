import { observabilityCollection } from "../config/db.js";

/** Persist only operational metadata; never include prompts, replies, or source text. */
export const recordObservabilityEvent = async (event) => {
    try {
        await observabilityCollection.insertOne({
            requestId: event.requestId,
            conversationId: event.conversationId,
            createdAt: new Date(),
            status: event.status,
            durationMs: event.durationMs,
            intent: event.intent ?? "unknown",
            plannedStrategy: event.plannedStrategy ?? "unknown",
            contextMode: event.contextMode ?? "none",
            retrievalSignals: event.retrievalSignals ?? {},
            resultCounts: event.resultCounts ?? { vector: 0, web: 0 },
            sourceCount: event.sourceCount ?? 0,
            stageDurationsMs: event.stageDurationsMs ?? {},
            ...(event.failureStage ? { failureStage: event.failureStage } : {}),
            ...(event.errorType ? { errorType: event.errorType } : {}),
        });
    } catch (error) {
        console.error("Could not persist observability event:", error);
    }
};

const parseDate = (value, fallback, name) => {
    if (value === undefined) return fallback;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new Error(`${name} must be a valid date`);
    return parsed;
};

/** Read bounded request records and aggregate summary metrics for the admin dashboard. */
export const getObservabilityDashboard = async ({
    from,
    to,
    limit: requestedLimit,
    collection = observabilityCollection,
    now = new Date(),
} = {}) => {
    const end = parseDate(to, now, "to");
    const start = parseDate(from, new Date(end.getTime() - 24 * 60 * 60 * 1000), "from");
    if (start >= end) throw new Error("from must be earlier than to");

    const limit = requestedLimit === undefined ? 100 : Number(requestedLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        throw new Error("limit must be an integer between 1 and 500");
    }

    const match = { createdAt: { $gte: start, $lt: end } };
    const [summaryRows, strategyRows, intentRows, requests] = await Promise.all([
        collection.aggregate([
            { $match: match },
            {
                $group: {
                    _id: null,
                    totalRequests: { $sum: 1 },
                    successfulRequests: {
                        $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] },
                    },
                    failedRequests: {
                        $sum: { $cond: [{ $eq: ["$status", "error"] }, 1, 0] },
                    },
                    averageDurationMs: { $avg: "$durationMs" },
                    durations: { $push: "$durationMs" },
                    requestsWithSources: {
                        $sum: { $cond: [{ $gt: ["$sourceCount", 0] }, 1, 0] },
                    },
                },
            },
            {
                $project: {
                    _id: 0,
                    totalRequests: 1,
                    successfulRequests: 1,
                    failedRequests: 1,
                    averageDurationMs: 1,
                    requestsWithSources: 1,
                    durations: 1,
                },
            },
        ]).toArray(),
        collection.aggregate([
            { $match: match },
            { $group: { _id: "$plannedStrategy", count: { $sum: 1 } } },
        ]).toArray(),
        collection.aggregate([
            { $match: match },
            { $group: { _id: "$intent", count: { $sum: 1 } } },
        ]).toArray(),
        collection.find(match, {
            projection: {
                _id: 0,
                requestId: 1,
                conversationId: 1,
                createdAt: 1,
                status: 1,
                durationMs: 1,
                intent: 1,
                plannedStrategy: 1,
                contextMode: 1,
                retrievalSignals: 1,
                resultCounts: 1,
                sourceCount: 1,
                stageDurationsMs: 1,
                failureStage: 1,
                errorType: 1,
            },
        }).sort({ createdAt: -1 }).limit(limit).toArray(),
    ]);

    const summary = summaryRows[0];
    const durations = summary?.durations?.sort((a, b) => a - b) ?? [];
    const percentileIndex = durations.length
        ? Math.ceil(durations.length * 0.95) - 1
        : -1;
    const strategyCounts = Object.fromEntries(strategyRows.map(({ _id, count }) => [_id, count]));
    const intentCounts = Object.fromEntries(intentRows.map(({ _id, count }) => [_id, count]));

    const totalRequests = summary?.totalRequests ?? 0;
    return {
        range: { from: start, to: end },
        summary: {
            totalRequests,
            successfulRequests: summary?.successfulRequests ?? 0,
            failedRequests: summary?.failedRequests ?? 0,
            successRate: totalRequests
                ? Number((summary.successfulRequests / totalRequests).toFixed(4))
                : 0,
            averageDurationMs: Math.round(summary?.averageDurationMs ?? 0),
            p95DurationMs: percentileIndex >= 0 ? durations[percentileIndex] : 0,
            requestsWithSources: summary?.requestsWithSources ?? 0,
            requestsWithoutSources: totalRequests - (summary?.requestsWithSources ?? 0),
            strategyCounts,
            intentCounts,
        },
        requests,
        requestLimit: limit,
    };
};
