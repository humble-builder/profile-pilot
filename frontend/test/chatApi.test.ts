import { beforeEach, describe, expect, it, vi } from "vitest";

import { deleteChatHistory, fetchChatHistory, sendMessage } from "@/services/chatApi";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("chat API client", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    process.env.NEXT_PUBLIC_API_URL = "http://backend.test";
  });

  it("sends complete chat metadata and returns the response", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ reply: "answer" })));
    const result = await sendMessage(
      "user@example.com",
      "hello",
      { sessionId: "session-1", sessionCreatedAt: 123 },
      "conversation-1",
    );

    expect(result).toEqual({ reply: "answer" });
    expect(fetchMock).toHaveBeenCalledWith("http://backend.test/chat/create", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        message: "hello",
        userId: "user@example.com",
        sessionId: "session-1",
        sessionCreatedAt: 123,
        conversationId: "conversation-1",
      }),
    }));
  });

  it("encodes user identity for history reads and deletes", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ success: true })));
    await fetchChatHistory("user+tag@example.com");
    await deleteChatHistory("user+tag@example.com", "session-1", "conversation-1");

    expect(fetchMock.mock.calls[0][0]).toContain("userId=user%2Btag%40example.com");
    expect(fetchMock.mock.calls[1][0]).toBe(
      "http://backend.test/chat/session-1/conversation-1?userId=user%2Btag%40example.com",
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "DELETE" });
  });

  it("throws the backend response text on failure", async () => {
    fetchMock.mockResolvedValue(new Response("chat unavailable", { status: 503 }));
    await expect(fetchChatHistory("user@example.com")).rejects.toThrow("chat unavailable");
  });
});
