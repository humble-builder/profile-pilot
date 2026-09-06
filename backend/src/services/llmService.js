import OpenAI from "openai";
import { getRuntimeSettings } from "../config/runtimeSettings.js";

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export const getLLMResponse = async (messages) => {
    const stream = await client.chat.completions.create({
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
