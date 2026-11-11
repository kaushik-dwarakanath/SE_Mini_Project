
import { useCallback, useEffect, useRef, useState } from "react";
import useChatConnection from "../hooks/useChatConnection";

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

export default function Chat() {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);

  const messageAreaRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimerRef = useRef(null);

  const handleMessage = useCallback((data) => {
    if (
      !data ||
      typeof data.username !== "string" ||
      !data.username.trim() ||
      typeof data.text !== "string" ||
      !data.text.trim()
    ) {
      return;
    }

    const message = {
      id: crypto.randomUUID(),
      username: data.username,
      isOwn: false,
      text: data.text,
      timestamp:
        typeof data.timestamp === "string" &&
        !Number.isNaN(Date.parse(data.timestamp))
          ? data.timestamp
          : new Date().toISOString(),
    };

    setMessages((current) => [...current, message]);
  }, []);

  const handleTypingStatus = useCallback((data) => {
    if (
      !data ||
      typeof data.userId !== "string" ||
      typeof data.username !== "string"
    ) {
      return;
    }

    setTypingUsers((current) => {
      if (data.isTyping) {
        if (current.some((user) => user.userId === data.userId)) {
          return current;
        }

        return [
          ...current,
          {
            userId: data.userId,
            username: data.username,
          },
        ];
      }

      return current.filter(
        (user) => user.userId !== data.userId
      );
    });
  }, []);

  // IMPORTANT: Destructure the returned object.
  // Never render the entire hook result as JSX.
  const {
    status: connectionStatus,
    emitTyping,
    emitStopTyping,
  } = useChatConnection(handleMessage, handleTypingStatus);

  useEffect(() => {
    const messageArea = messageAreaRef.current;

    if (messageArea) {
      messageArea.scrollTop = messageArea.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    return () => {
      clearTimeout(typingTimerRef.current);
    };
  }, []);

  function handleDraftChange(event) {
    const value = event.target.value;

    setDraft(value);
    clearTimeout(typingTimerRef.current);

    if (value.trim()) {
      emitTyping();

      typingTimerRef.current = setTimeout(() => {
        emitStopTyping();
      }, 1500);
    } else {
      emitStopTyping();
    }
  }

  function handleSubmit(event) {
    event.preventDefault();

    const text = draft.trim();

    if (!text) return;

    clearTimeout(typingTimerRef.current);
    emitStopTyping();

    const message = {
      id: crypto.randomUUID(),
      isOwn: true,
      text,
      timestamp: new Date().toISOString(),
    };

    setMessages((current) => [...current, message]);
    setDraft("");
    inputRef.current?.focus();
  }

  return (
    <main className="page chat-page">
      <section className="chat-card" aria-labelledby="chat-title">
        <header className="chat-header">
          <h1 id="chat-title">Chat Room</h1>

          <p className="subtitle">
            A place to share a message.
          </p>

          <p className="subtitle" role="status" aria-atomic="true">
            {connectionStatus}
          </p>

          <p className="chat-preview-note" id="chat-preview-note">
            Incoming messages appear automatically. Local preview: clicking
            Send or pressing Enter only adds your message in this tab.
            Your messages are not sent to the server or other users.
            This list clears when you leave or refresh.
          </p>
        </header>

        <div
          className="messages"
          ref={messageAreaRef}
          role="log"
          aria-label="Chat messages"
          aria-live="polite"
          aria-relevant="additions"
          tabIndex={0}
        >
          {messages.length === 0 ? (
            <p className="empty-message">
              No messages yet. Type a message below to preview it locally.
            </p>
          ) : (
            messages.map((message) => (
              <article
                className={`message${message.isOwn ? " message-own" : ""}`}
                key={message.id}
              >
                <div className="message-meta">
                  <span className="message-sender">
                    {message.isOwn ? "You" : message.username}
                  </span>

                  <time
                    className="message-time"
                    dateTime={message.timestamp}
                    title={new Date(message.timestamp).toLocaleString()}
                  >
                    {timeFormatter.format(new Date(message.timestamp))}
                  </time>
                </div>

                <p>{message.text}</p>
              </article>
            ))
          )}
        </div>

        <div
          className="typing-indicator"
          role="status"
          aria-live="polite"
        >
          {typingUsers.length > 0 && (
            <p>
              {typingUsers.length === 1
                ? `${typingUsers[0].username} is typing...`
                : `${typingUsers.map((user) => user.username).join(", ")} are typing...`}
            </p>
          )}
        </div>

        <form className="message-form" onSubmit={handleSubmit}>
          <label
            className="visually-hidden"
            htmlFor="chat-message"
          >
            Message
          </label>

          <input
            ref={inputRef}
            id="chat-message"
            type="text"
            value={draft}
            onChange={handleDraftChange}
            placeholder="Type a message..."
            autoComplete="off"
            aria-describedby="chat-preview-note"
          />

          <button type="submit" disabled={!draft.trim()}>
            Send
          </button>
        </form>
      </section>
    </main>
  );
}