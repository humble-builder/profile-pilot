import { detectIntent } from "../intent/detectIntent.js";
import { detectEntity } from "../entity/detectEntity.js";
import { routeVectorQuery } from "./routeVectorQuery.js";

export const routeIntent = async (message) => {
    const [intentResult, entityResult] = await Promise.all([
        detectIntent(message),
        detectEntity(message),
    ]);

    const vectorRoute = routeVectorQuery({
        message,
        intentResult,
        entityResult,
    });

    return {
        message,
        intentResult,
        entityResult,
        vectorRoute,
    };
};
