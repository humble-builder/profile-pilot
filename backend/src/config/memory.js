import { updateChatHistory, deleteChatHistory } from "../database/updateHistory.js";
import { getUserHistory, getConversationHistory } from "../database/readHistory.js";
import { v4 as uuidv4} from "uuid";

export const getConversation = async (query) => {
    const { userId, sessionId, conversationId } = query;
    const currentConversation = await getConversationHistory(userId, sessionId, conversationId);
    return currentConversation;
}

export const readConversation = async (userId) => {
    return await getUserHistory(userId);
};

export const addMessage = async (metadata, role, content, sources = []) => {
    const currentTimestamp = Date.now();
    const currentMessage = {
        role,
        content,
        messageId: uuidv4(),
        createdAt: currentTimestamp,
        sources: [...(sources.length ? sources : [])]
    };

    const currentConversation = await getConversation(metadata);
    if (!currentConversation.length) {
        metadata.conversationCreatedAt = currentTimestamp
    }
    else {
        const latestMessage = currentConversation[currentConversation.length - 1];
        metadata.conversationCreatedAt = latestMessage.conversationCreatedAt;
    }

    await updateChatHistory({metadata, currentMessage});
}

export const deleteConversation = async (userId, sessionId, conversationId) => {
    const deletedCount = await deleteChatHistory({userId, sessionId, conversationId});
    if (!deletedCount) {
        throw new Error("No conversation found");
    }

    return deletedCount;
}
