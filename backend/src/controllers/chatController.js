import { getAnswer } from "../services/vectorSearchService.js";
import { addMessage } from "../config/memory.js";
import {
    readConversation,
    deleteConversation
} from "../config/memory.js";
import { v4 as uuidv4 } from "uuid";

/**
 * Controls the chat between user and LLM
 * @param {*} req Request object received from source
 * @param {*} res Response object to be returned to source
 * @returns {JSON} Reply generated using conversation history and retrieved context
 */
export const createChat = async (req, res) => {
    try {
        const { userId, sessionId, sessionCreatedAt, message } = req.body;
        /**
         * Null check for user ID and the user message
         */
        if (!userId) {
            return res.status(400).json({ error: "User ID required" });
        }

        if (!sessionId) {
            return res.status(400).json({ error: "Session ID required" });
        }

        if (!message?.trim()) {
            return res.status(400).json({ error: "Valid message required" });
        }
        console.log(`Starting chat for user: ${userId}, session: ${sessionId}`);

        /**
         * Call AI services (RAG/LLM) to get answer for user's query,
         * Update the conversation history, and respond back to the user
         */
        let conversationId = req.body.conversationId || uuidv4();

        const query = { userId, sessionId, sessionCreatedAt, conversationId, message };
        const response = await getAnswer(query);

        await addMessage(query, "user", req.body.message);
        await addMessage(query, "assistant", response.reply, response.sources);

        return res.json({
            conversationId,
            ...response
        });
    }
    catch (err) {
        console.error("Error while creating chat:", err);
        res.status(err.status ?? 500).json({
            error: err.message,
            reply: "Something went wrong. Please try again later."
        });
    }
};

export const getChatHistory = async (req, res) => {
    try {
        const {userId} = req.query;

        if (!userId) {
            return res.status(400).json({ error: "User ID required" });
        }
        
        console.log(`Fetching chat history for user: ${userId}...`);
        const conversations = await readConversation(userId);
        // add a formatting layer here to restructure chat shape later
        return res.json(conversations);

    } catch (err) {
        console.error("Error fetching chat history:", err);
        res.status(err.status ?? 500).json({
            error: err.message,
            reply: "Could not fetch history. Please try again later."
        });
    }
}

export const deleteChat = async (req, res) => {
    try {
        const {userId} = req.query;
        const {sessionId, conversationId} = req.params;

        if (!userId) {
            return res.status(400).json({ error: "User ID required" });
        }

        if (!sessionId) {
            return res.status(400).json({ error: "Session ID required" });
        }

        if (!conversationId) {
            return res.status(400).json({ error: "Coversation ID required" });
        }

        const deletedCount = await deleteConversation(userId, sessionId, conversationId);
        console.log(`${deletedCount} entries deleted for conversation id ${conversationId} !!`)

        return res.json({ success: true, reply: "Chat deleted successfully." });

    } catch (err) {
        console.error("Error deleting chat:", err);
        res.status(err.status ?? 500).json({
            success: false,
            reply: "Could not delete chat. Please try again later."
        });
    }
}
