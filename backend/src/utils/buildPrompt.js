import {
    CLARIFICATION_PROMPT,
    GENERAL_PROMPT,
    SAFE_RESPONSE_PROMPT,
} from "../../constants/prompts.js";
import { buildContext } from "./buildContext.js";

export const buildPrompt = ({
    requestContext,
    history = [],
    retrievalContext,
}) => {
    const { message, assistantPrompt } = requestContext;
    const { mode, responseStrategy } = retrievalContext;
    const pastContext = history.length
        ? history.map((item) => ({ role: item.role, content: item.content }))
        : [];
    const prompt = [];

    if (mode === "none") {
        const systemPrompt = responseStrategy === "clarification"
            ? CLARIFICATION_PROMPT
            : responseStrategy === "safe_response"
                ? SAFE_RESPONSE_PROMPT
                : GENERAL_PROMPT;

        prompt.push({
            role: "system",
            content: systemPrompt
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

    const context = buildContext(retrievalContext);

    prompt.push({
        role: "system",
        content: `
            ${assistantPrompt}

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
};
