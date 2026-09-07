import assert from "node:assert/strict";
import test from "node:test";

const testMongoUri = process.env.TEST_MONGO_URI;

test("chat history persists, groups, orders, and deletes conversations", {
    skip: !testMongoUri && "TEST_MONGO_URI is required",
}, async () => {
    process.env.MONGO_URI = testMongoUri;

    const database = await import("../src/config/db.js");
    const memory = await import("../src/config/memory.js");
    const metadata = {
        userId: "recruiter@example.com",
        sessionId: "session-1",
        sessionCreatedAt: 100,
        conversationId: "conversation-1",
    };

    try {
        await database.connectDB();
        await database.sessionsCollection.deleteMany({});

        await memory.addMessage(metadata, "user", "A title longer than thirty characters for testing");
        await memory.addMessage(metadata, "assistant", "Stored answer", [{ id: "source-1" }]);

        const conversation = await memory.getConversation(metadata);
        assert.equal(conversation.length, 2);
        assert.equal(conversation[0].role, "user");
        assert.equal(conversation[1].role, "assistant");

        const history = await memory.readConversation(metadata.userId);
        assert.equal(history.length, 1);
        assert.equal(history[0].conversations.length, 1);
        assert.equal(history[0].conversations[0].title, "A title longer than thirty cha...");
        assert.deepEqual(history[0].conversations[0].messages[1].sources, [{ id: "source-1" }]);

        assert.equal(await memory.deleteConversation(
            metadata.userId,
            metadata.sessionId,
            metadata.conversationId
        ), 2);
        await assert.rejects(
            memory.deleteConversation(metadata.userId, metadata.sessionId, metadata.conversationId),
            /No conversation found/
        );
    } finally {
        await database.disconnectDB();
    }
});
