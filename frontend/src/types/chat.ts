interface DocSource {
  id: string
  type: "vector",
  source: string,
  chunks: Array<{"number": number, "score": number}>,
}

interface WebSource {
  id: string,
  type: "web",
  title: string,
  url: string,
  tags: string[],
}

export type SourceObject = DocSource | WebSource;

export interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  sources?: Array<SourceObject>
}

export interface ConversationHistoryItem {
  conversationId: string;
  title: string;
  messages: Array<Pick<Message, "role" | "content" | "sources">>;
}

export interface SessionHistoryItem {
  sessionId: string;
  sessionCreatedAt: number;
  conversations: ConversationHistoryItem[];
}

export interface SessionObject {
  sessionId: string;
  sessionCreatedAt: number
}
