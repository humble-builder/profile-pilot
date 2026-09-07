/**
 * LLM workflow: read the current chat model for every request, consume the streamed completion,
 * and return a single reply to the orchestration service.
 */
import OpenAI from "openai";
import { getRuntimeSettings } from "../config/runtimeSettings.js";

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

/** Generate a complete assistant reply from an OpenAI-compatible message sequence. */
export const getLLMResponse = async (messages, { openAIClient = client } = {}) => {
    const stream = await openAIClient.chat.completions.create({
        model: getRuntimeSettings().chatModel,
        messages,
        stream: true
    });

    let fullReply = "";
    for await (const chunk of stream) {
        const content = chunk?.choices[0]?.delta?.content;
        if (content)    fullReply+= content;
    }

    return fullReply;
};
