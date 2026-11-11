import { getObservabilityDashboard } from "../services/observabilityService.js";

/** Return bounded observability metrics and recent request metadata to an admin. */
export const readObservabilityDashboard = async (req, res) => {
    try {
        const dashboard = await getObservabilityDashboard({
            from: req.query.from,
            to: req.query.to,
            limit: req.query.limit,
        });
        return res.json(dashboard);
    } catch (error) {
        const invalidQuery = error.message?.includes("must be");
        return res.status(invalidQuery ? 400 : 500).json({
            error: invalidQuery ? error.message : "Could not load observability data",
        });
    }
};
