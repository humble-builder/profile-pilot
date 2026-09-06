import crypto from "crypto";

export const requireAdminToken = (req, res, next) => {
    const expectedToken = process.env.ADMIN_API_TOKEN;
    const providedToken = req.get("x-admin-token") ?? "";

    if (!expectedToken) {
        return res.status(503).json({ error: "Admin API is not configured" });
    }

    const expectedBuffer = Buffer.from(expectedToken);
    const providedBuffer = Buffer.from(providedToken);
    const tokenMatches = expectedBuffer.length === providedBuffer.length
        && crypto.timingSafeEqual(expectedBuffer, providedBuffer);

    if (!tokenMatches) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    next();
};
