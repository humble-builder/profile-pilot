import { Message } from "@/types/chat";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  message: Message;
  onViewSources: (message: Message) => void
}

export default function MessageBubble({
  message,
  onViewSources
}: Props) {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex ${
        isUser ? "justify-end" : "justify-start"
      }`}
    >
      <div
        className={`max-w-[70%] rounded-2xl px-4 py-3 shadow-md ${
          isUser
            ? "bg-blue-500 text-white"
            : "bg-white text-gray-800"
        }`}
      >
        <div className="space-y-2 text-sm leading-relaxed 
[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 
[&_a]:text-blue-600 [&_a]:underline [&_strong]:font-semibold
[&_h1]:text-xl [&_h1]:font-bold
[&_h2]:text-lg [&_h2]:font-semibold
[&_h3]:text-base [&_h3]:font-semibold
[&_h4]:text-medium [&_h4]:font-semibold
[&_blockquote]:border-l-4 [&_blockquote]:border-gray-300
[&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-gray-600">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        </div>
        {!isUser && message.sources?.length ? (
          <button
            type="button"
            onClick={() => onViewSources(message)}
            className="mt-2 block cursor-pointer rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            View sources
          </button>
        ) : null}
      </div>
    </div>
  );
}