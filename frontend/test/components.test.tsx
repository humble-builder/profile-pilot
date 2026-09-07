import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AuthButton from "@/components/AuthButton";
import ChatInput from "@/components/ChatInput";
import ChatWindow from "@/components/ChatWindow";
import MessageBubble from "@/components/MessageBubble";
import SourcePanel from "@/components/SourcePanel";
import { deleteChatHistory, fetchChatHistory, sendMessage } from "@/services/chatApi";
import { signIn, signOut, useSession } from "next-auth/react";

vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  useSession: vi.fn(),
}));

vi.mock("@/services/chatApi", () => ({
  deleteChatHistory: vi.fn(),
  fetchChatHistory: vi.fn(),
  sendMessage: vi.fn(),
}));

describe("chat components", () => {
  beforeEach(() => {
    vi.mocked(useSession).mockReturnValue({
      data: {
        expires: "2099-01-01T00:00:00.000Z",
        user: { name: "Recruiter User", email: "recruiter@example.com" },
      },
      status: "authenticated",
      update: vi.fn(),
    });
    vi.mocked(fetchChatHistory).mockResolvedValue([]);
    vi.mocked(deleteChatHistory).mockResolvedValue({ success: true });
    vi.mocked(sendMessage).mockResolvedValue({
      conversationId: "conversation-1",
      reply: "Mock assistant reply",
      sources: [],
    });
  });

  it("submits non-empty chat input and clears the field", () => {
    const onSend = vi.fn();
    render(<ChatInput loading={false} onSend={onSend} />);
    const input = screen.getByPlaceholderText("Ask something about Vishal...");

    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("hello");
    expect(input).toHaveValue("");

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("limits the source panel and exposes external source links", () => {
    const onClose = vi.fn();
    render(<SourcePanel onClose={onClose} sources={[
      { id: "1", type: "vector", source: "one.txt", chunks: [] },
      { id: "2", type: "web", title: "Two", url: "https://example.com/2", tags: [] },
      { id: "3", type: "vector", source: "three.txt", chunks: [] },
      { id: "4", type: "vector", source: "hidden.txt", chunks: [] },
    ]} />);

    expect(screen.getByText("one.txt")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Two" })).toHaveAttribute("href", "https://example.com/2");
    expect(screen.queryByText("hidden.txt")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Hide sources"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders assistant downloads and invokes source inspection", () => {
    process.env.NEXT_PUBLIC_API_URL = "/backend";
    const onViewSources = vi.fn();
    const message = {
      id: "message-1",
      role: "assistant" as const,
      content: "Download resume.pdf",
      timestamp: new Date(),
      sources: [{ id: "1", type: "vector" as const, source: "resume.txt", chunks: [] }],
    };
    render(<MessageBubble message={message} onViewSources={onViewSources} />);

    expect(screen.getByRole("link", { name: "Download resume" })).toHaveAttribute(
      "href",
      "/backend/service/files/resume.pdf",
    );
    fireEvent.click(screen.getByRole("button", { name: "View sources" }));
    expect(onViewSources).toHaveBeenCalledWith(message);
  });

  it("switches authentication actions according to session state", () => {
    vi.mocked(useSession).mockReturnValueOnce({ data: null, status: "unauthenticated", update: vi.fn() });
    const { unmount } = render(<AuthButton />);
    fireEvent.click(screen.getByTitle("Sign In"));
    expect(signIn).toHaveBeenCalledWith("google");
    unmount();

    render(<AuthButton />);
    expect(screen.getByTitle("recruiter@example.com")).toHaveTextContent("RU");
    fireEvent.click(screen.getByTitle("Sign out"));
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("sends a chat message and renders the mocked assistant response", async () => {
    render(<ChatWindow />);
    const input = screen.getByPlaceholderText("Ask something about Vishal...");
    fireEvent.change(input, { target: { value: "Tell me about skills" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(
      "recruiter@example.com",
      "Tell me about skills",
      expect.objectContaining({ sessionId: expect.any(String) }),
      null,
    ));
    expect(await screen.findByText("Mock assistant reply")).toBeInTheDocument();
  });
});
