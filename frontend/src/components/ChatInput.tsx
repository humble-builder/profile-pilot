"use client";

import { useState } from "react";
import { Send } from "lucide-react";

interface Props {
  onSend: (message: string) => void;
  loading: boolean;
  disabledReason?: string;
}

export default function ChatInput({
  onSend,
  loading,
  disabledReason,
}: Props) {
  const [input, setInput] = useState("");

  const handleSend = () => {
    if (!input.trim()) return;

    onSend(input);
    setInput("");
  };

  return (
    <div className="flex gap-2 border-t border-gray-200 bg-white p-4">
      <input
        type="text"
        placeholder={disabledReason ?? "Ask something about Vishal..."}
        disabled={loading}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        className="flex-1 rounded-xl border border-gray-200 px-4 py-2 outline-none focus:border-gray-300"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            handleSend();
          }
        }}
      />

      <button
        type="button"
        aria-label={disabledReason ?? "Send message"}
        onClick={handleSend}
        disabled={loading}
        className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-400 text-white hover:bg-blue-500 disabled:opacity-50"
      >
        <Send className="h-4 w-4" />
      </button>
    </div>
  );
}