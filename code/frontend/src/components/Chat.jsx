import { useCallback, useEffect, useRef, useState } from "react";
import useChatConnection from "../hooks/useChatConnection";

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

const TOKEN_KEY = "token"; // use the key name you saw in DevTools → Local Storage

// The JWT payload contains userId, so we can tell which history messages are ours.
function getCurrentUserId() {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload)).userId;
  } catch {
    return null;
  }
}

export default function Chat() {
  const [sendError, setSendError] = useState("");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);

  const messageAreaRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimerRef = useRef(null);
  const isTypingRef = useRef(false);

  const handleMessage = useCallback((data, isOwn = false) => {
    if (
      !data ||
      typeof data.username !== "string" ||
      !data.username.trim() ||
      typeof data.text !== "string" ||
      !data.text.trim()
    ) return;

    const parsedTimestamp = new Date(data.timestamp);
    const timestamp =
      data.timestamp !== null &&
      data.timestamp !== undefined &&
      data.timestamp !== "" &&
      Number.isFinite(parsedTimestamp.getTime())
        ? parsedTimestamp.toISOString()
        : new Date().toISOString();

    setMessages((current) => {
      const id = typeof data.id === "string" ? data.id : crypto.randomUUID();
      if (current.some((message) => message.id === id)) return current;

      return [
        ...current,
        { id, username: data.username, isOwn, text: data.text, timestamp },
      ];
    });
  }, []);

  const handleTypingStatus = useCallback((data) => {
    if (data?.clearAll) {
      setTypingUsers([]);
      return;
    }

    if (
      !data ||
      typeof data.userId !== "string" ||
      !data.userId.trim() ||
      typeof data.username !== "string" ||
      !data.username.trim() ||
      typeof data.isTyping !== "boolean"
    ) return;

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

      return current.filter((user) => user.userId !== data.userId);
    });
  }, []);

  const {
    status: connectionStatus,
    emitTyping,
    emitStopTyping,
    sendMessage,
  } = useChatConnection(handleMessage, handleTypingStatus, setSendError);

  useEffect(() => {
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = null;
    isTypingRef.current = false;
  }, [connectionStatus]);

  function stopTyping() {
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = null;

    if (isTypingRef.current) {
      isTypingRef.current = false;
      emitStopTyping();
    }
  }

  function handleDraftChange(event) {
    const value = event.target.value;
    setDraft(value);

    clearTimeout(typingTimerRef.current);

    if (!value.trim()) {
      stopTyping();
      return;
    }

    if (!isTypingRef.current) {
      isTypingRef.current = emitTyping();
    }

    typingTimerRef.current = setTimeout(stopTyping, 1500);
  }

  function handleSubmit(event) {
    event.preventDefault();

    const text = draft.trim();
    if (!text) return;

    stopTyping();

    setSendError("");
    if (!sendMessage(text)) {
      setSendError("You are offline. Reconnect before sending your message.");
      return;
    }

    setDraft("");
    inputRef.current?.focus();
  }

  useEffect(() => {
    if (messageAreaRef.current) {
      messageAreaRef.current.scrollTop =
        messageAreaRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    return () => {
      clearTimeout(typingTimerRef.current);
    };
  }, []);

    useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;

    const controller = new AbortController();
    const currentUserId = getCurrentUserId();

    fetch("/api/messages/general", {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))
      )
      .then((data) => {
        const history = (data.messages || [])
          .filter(
            (m) =>
              typeof m.username === "string" &&
              typeof m.text === "string" &&
              m.text.trim()
          )
          .map((m) => ({
            id: m.id,
            username: m.username,
            isOwn: m.senderId === currentUserId,
            text: m.text,
            timestamp: m.timestamp,
          }));

        // History first, then any live messages that arrived meanwhile
        setMessages((current) => {
          const known = new Set(history.map((m) => m.id));
          return [...history, ...current.filter((m) => !known.has(m.id))];
        });
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setSendError("Could not load earlier messages.");
        }
      });

    return () => controller.abort();
  }, []);

  return (
    <main className="page chat-page">
      <section className="chat-card" aria-labelledby="chat-title">
        <header className="chat-header">
          <h1 id="chat-title">Chat Room</h1>
          <p className="subtitle">A place to share a message.</p>

          <p
            className="subtitle"
            role="status"
            aria-label="Connection status"
          >
            {connectionStatus}
          </p>

          <p className="chat-preview-note" id="chat-preview-note">
            Messages are sent to everyone in the room.
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
            <p className="empty-message">No messages yet.</p>
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
          aria-label="Typing status"
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

        {sendError && <p role="alert">{sendError}</p>}

        <form className="message-form" onSubmit={handleSubmit}>
          <label className="visually-hidden" htmlFor="chat-message">
            Message
          </label>

          <span id="chat-input-description" className="visually-hidden">
            Press Enter or Send to share your message with the room.
          </span>

          <input
            ref={inputRef}
            id="chat-message"
            type="text"
            value={draft}
            onChange={handleDraftChange}
            placeholder="Type a message..."
            autoComplete="off"
            aria-describedby="chat-input-description"
          />

          <button type="submit" disabled={!draft.trim()}>
            Send
          </button>
        </form>
      </section>
    </main>
  );
}