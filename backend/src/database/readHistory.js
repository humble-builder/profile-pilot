import { sessionsCollection } from "../config/db.js";
import { getLLMResponse } from "../services/llmService.js";

export const getUserHistory = async (userId) => {
    const userHistory = await sessionsCollection
        .find({ userId })
        .sort({
            sessionCreatedAt: -1,
            conversationCreatedAt: -1,
            createdAt: 1
        })
        .toArray();
    
    const conversationHistory = [];
    const sessions = new Map();
    for (const record of userHistory) {
        if (!sessions.has(record.sessionId)) {
            sessions.set(record.sessionId, []);
        }
        sessions.get(record.sessionId).push(record);
    }

    for (const [sessionId, messages] of sessions) {
        const conversations = new Map();

        for (const message of messages) {
            if (!conversations.has(message.conversationId)) {
                conversations.set(message.conversationId, {
                    messages: [],
                    title: "New Chat",
                    conversationId: message.conversationId
                });
            }
            
            const record = conversations.get(message.conversationId);
            record.messages.push({
                role: message.role,
                content: message.content,
                sources: message.sources ?? []
            });
        }

        for (const [conversationId, conversation] of conversations) {
            const oldestUserMessage = conversation.messages
                .find((message) => message.role === "user")
            const title = oldestUserMessage?.content ?? "New Chat";
            conversation.title = title.length > 30 ? `${title.slice(0, 30)}...` : title;
        }

        conversationHistory.push({
            sessionId,
            sessionCreatedAt: messages[0]?.sessionCreatedAt,
            conversations: [...conversations.values()]
        })
    }

    return conversationHistory;
}

export const getConversationHistory = async (userId, sessionId, conversationId) => {
    const conversation = await sessionsCollection
        .find({
            userId,
            sessionId,
            conversationId
        })
        .toArray();
    if (!conversation.length) return [];

    return conversation.sort((a, b) => a.createdAt - b.createdAt);
}
