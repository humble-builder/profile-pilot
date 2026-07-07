export async function sendMessage(
  userId: string,
  message: string,
  session: { sessionId: string; sessionCreatedAt: number },
  conversationId?: string | null
) {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/chat/create`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        userId,
        sessionId: session.sessionId,
        sessionCreatedAt: session.sessionCreatedAt,
        conversationId
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText);
  }

  return response.json();
}

export async function fetchChatHistory(userId: string) {
  const encodedUserId = encodeURIComponent(userId);
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/chat/history?userId=${encodedUserId}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      }
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText);
  }

  return response.json();
}

export async function deleteChatHistory(userId:string, sessionId: string, conversationId: string) {
  const encodedUserId = encodeURIComponent(userId);
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/chat/${sessionId}/${conversationId}?userId=${encodedUserId}`,
    {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      }
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText);
  }

  return response.json();
}
