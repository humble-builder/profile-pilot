"use client";

import { useState, useEffect } from "react";
import ChatInput from "./ChatInput";
import MessageBubble from "./MessageBubble";
import {
  Message,
  SourceObject,
  SessionObject,
  SessionHistoryItem,
  ConversationHistoryItem,
} from "@/types/chat";
import {
  sendMessage,
  fetchChatHistory,
  deleteChatHistory,
} from "@/services/chatApi";
import SourcePanel from "./SourcePanel";
import AuthButton from "./AuthButton";
import { useSession } from "next-auth/react";
import { v4 as uuidv4 } from "uuid";
import { GREETING_MESSAGE } from "../../constants/messages.js";
import {
  SquarePen,
  PanelRightOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Trash2,
} from "lucide-react";

const createGreetingMessage = (): Message => ({
  id: crypto.randomUUID(),
  role: "assistant",
  content: GREETING_MESSAGE,
  timestamp: new Date(),
});

export default function ChatWindow() {
  const { data: authSession, status } = useSession();
  const userId = authSession?.user?.email ?? null;

  const [session, setSession] = useState(() => ({
    sessionId: uuidv4(),
    sessionCreatedAt: Date.now(),
  }));
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [selectedSources, setSelectedSources] = useState<SourceObject[]>([]);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(
    null,
  );
  const [messages, setMessages] = useState<Message[]>(() => [
    createGreetingMessage(),
  ]);
  const [history, setHistory] = useState<SessionHistoryItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);


  const historyItems = history.flatMap((session) =>
    session.conversations.map((conversation) => ({
      conversation,
      sessionId: session.sessionId,
      sessionCreatedAt: session.sessionCreatedAt,
    })),
  );

  const refreshHistory = async(userId: string | null) => {
    if (!userId) return;
    try {
      const data = await fetchChatHistory(userId);
      setHistoryError(null);
      setHistory(data);
    } catch (error) {
      console.error("Failed to fetch chat history:", error);
      setHistoryError("Failed to fetch chat history.");
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (status !== "authenticated" || !userId) return;

    let ignore = false;

    fetchChatHistory(userId)
      .then((data) => {
        if (ignore) return;
        setHistoryError(null);
        setHistory(data);
      })
      .catch((error) => {
        if (ignore) return;
        console.error("Failed to fetch chat history:", error);
        setHistoryError("Failed to fetch chat history.");
      })
      .finally(() => {
        if (ignore) return;
        setHistoryLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [userId, status]);

  const handleSend = async (text: string) => {
    if (!userId) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);

    try {
      const response = await sendMessage(userId, text, session, conversationId);
      const botMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response.reply,
        sources: response.sources,
        timestamp: new Date(),
      };

      setConversationId(response.conversationId);
      setSelectedMessageId(botMessage.id);
      setSelectedSources(response.sources ?? []);
      setMessages((prev) => [...prev, botMessage]);
      refreshHistory(userId);
    } catch (error) {
      console.error("Send message failed:", error);
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "I couldn't send that message. Please try again.",
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleViewSources = (message: Message) => {
    const isSameMessageSelected = message.id === selectedMessageId;

    if (isSameMessageSelected && sourcesOpen) {
      setSelectedMessageId(null);
      setSelectedSources([]);
      setSourcesOpen(false);
      return;
    }

    setSelectedMessageId(message.id);
    setSelectedSources(message.sources ?? []);
    setSourcesOpen(true);
  };

  const handleHistory = async (
    history: ConversationHistoryItem,
    session: SessionObject,
  ) => {
    setSession(session);
    setConversationId(history.conversationId);

    const selectedMessages = history.messages.map((message) => ({
      id: crypto.randomUUID(),
      role: message.role,
      content: message.content,
      timestamp: new Date(),
      sources: message.sources ?? [],
    }));

    setMessages(selectedMessages);
    setSelectedSources([]);
    setSelectedMessageId(null);
  };

  const handleNewChat = async () => {
    setSession({ sessionId: uuidv4(), sessionCreatedAt: Date.now() });
    setConversationId(null);
    setMessages([createGreetingMessage()]);
    setSelectedSources([]);
    setSelectedMessageId(null);
  };

  const handleDeleteConversation = async(item: {
    sessionId: string;
    sessionCreatedAt: number;
    conversation: ConversationHistoryItem;
  }) => {
    if (!userId) return;
    try {
      await deleteChatHistory(userId, item.sessionId, item.conversation.conversationId);
      await refreshHistory(userId);

      if (conversationId === item.conversation.conversationId) {
        handleNewChat();
      }
      alert("Conversation deleted successfully.");
    } catch (error) {
      console.error("Delete conversation failed:", error);
      alert("Failed to delete conversation.");
    }

  };

  return (
    <div className="flex h-full flex-col bg-gray-100">

      <div className="flex h-16 w-full items-center justify-between border-b border-gray-200 bg-white px-4">
        <div className="flex flex-col">
          <span className="text-base font-bold text-black">
            ProfilePilot
          </span>
          <span className="text-xs font-medium text-gray-500">
            Conversational AI for Professional Profile Discovery
          </span>
        </div>
        <AuthButton />
      </div>

      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <aside className={`flex ${historyOpen ? "w-72" : "w-12"} shrink-0 flex-col gap-4 transition-all duration-600`}>

          <div className="flex flex-col gap-2">
            <button
              className="flex h-10 w-10 items-center justify-center rounded border border-gray-300 text-gray-700 transition hover:bg-gray-100"
              onClick={() => setHistoryOpen((open) => !open)}
              type="button"
              title={historyOpen ? "Hide history" : "Show history"}
            >
              {historyOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
            </button>

            <button
              className="flex h-10 w-10 items-center justify-center rounded border border-gray-300 text-gray-700 transition hover:border-gray-400 hover:bg-gray-100 hover:text-gray-900 active:scale-90"
              onClick={handleNewChat}
              type="button"
              title="New Chat"
            >
              <SquarePen size={18} />
            </button>
          </div>

          {historyOpen && (
            <div className="border-t border-gray-300 pt-4">
              <h2 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Chat History
              </h2>
              {historyError && (
                <p className="mb-2 px-2 text-xs text-gray-500">
                  {historyError}
                </p>
              )}
              {status === "loading" ? (
                <p className="px-2 text-sm text-gray-400">Loading conversations...</p>
              ) : status === "unauthenticated" ? (
                <p className="px-2 text-sm text-gray-400">Sign in to view history</p>
              ) : historyLoading && historyItems.length === 0 ? (
                <p className="px-2 text-sm text-gray-400">Loading conversations...</p>
              ) : !historyLoading && historyItems.length === 0 ? (
                <p className="px-2 text-sm text-gray-400">No conversations yet</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {historyItems.map((item) => (
                    <div
                      className="flex items-center gap-1"
                      key={item.conversation.conversationId}
                    >
                      <button
                        className="w-full truncate rounded px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-200"
                        key={item.conversation.conversationId}
                        onClick={() =>
                          handleHistory(item.conversation, {
                            sessionId: item.sessionId,
                            sessionCreatedAt: item.sessionCreatedAt,
                          })
                        }
                        type="button"
                        title={item.conversation.title}
                      >
                        {item.conversation.title}
                      </button>
                      <button
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-gray-400 transition hover:bg-red-50 hover:text-red-600"
                        onClick={() => handleDeleteConversation(item)}
                        type="button"
                        title="Delete conversation"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-sm">
          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onViewSources={handleViewSources}
              />
            ))}

            {loading && (
              <div className="text-sm text-gray-500">
                Looking through the sources...
              </div>
            )}
          </div>

          <ChatInput
            onSend={handleSend}
            loading={loading || !userId}
            disabledReason={!userId ? "Sign in to start a conversation" : undefined}
          />
        </div>

        <div
          className={`shrink-0 transition-all duration-600 ${
            sourcesOpen ? "w-80" : "w-12"
          }`}
        >
          {sourcesOpen ? (
            <SourcePanel
              sources={selectedSources}
              onClose={() => setSourcesOpen(false)}
            />
          ) : (
            <div className="flex h-full w-12 shrink-0 justify-center pt-1">
              <button
                className="flex h-10 w-10 items-center justify-center rounded border border-gray-300 text-gray-700 transition hover:bg-gray-100"
                onClick={() => setSourcesOpen(true)}
                type="button"
                title="Show sources"
              >
                <PanelRightOpen size={18} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
