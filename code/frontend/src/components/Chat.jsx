import { useCallback, useEffect, useRef, useState } from "react";
import useChatConnection from "../hooks/useChatConnection";

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

export default function Chat() {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const messageAreaRef = useRef(null);
  const inputRef = useRef(null);

  const handleMessage = useCallback((data) => {
    if (
      !data ||
      typeof data.username !== "string" || !data.username.trim() ||
      typeof data.text !== "string" || !data.text.trim()
    ) return;

    const message = {
      id: crypto.randomUUID(),
      username: data.username,
      isOwn: false,
      text: data.text,
      timestamp: typeof data.timestamp === "string" && !Number.isNaN(Date.parse(data.timestamp))
        ? data.timestamp
        : new Date().toISOString(),
    };
    setMessages((current) => [...current, message]);
  }, []);
  const connectionStatus = useChatConnection(handleMessage);

  useEffect(() => {
    const messageArea = messageAreaRef.current;
    messageArea.scrollTop = messageArea.scrollHeight;
  }, [messages]);

  function handleSubmit(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;

    // Messages stay local until message delivery is integrated separately.
    const message = {
      id: crypto.randomUUID(),
      isOwn: true,
      text,
      timestamp: new Date().toISOString(),
    };
    setMessages((current) => [...current, message]);
    setDraft("");
    inputRef.current.focus();
  }

  return (
    <main className="page chat-page">
      <section className="chat-card" aria-labelledby="chat-title">
        <header className="chat-header">
          <h1 id="chat-title">Chat Room</h1>
          <p className="subtitle">A place to share a message.</p>
          <p className="subtitle" role="status" aria-atomic="true">
            {connectionStatus}
          </p>
          <p className="chat-preview-note" id="chat-preview-note">
            Incoming messages appear automatically. Local preview: clicking Send
            or pressing Enter only adds your message in this tab. Your messages
            are not sent to the server or other users. This list clears when
            you leave or refresh.
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
              <article className={`message${message.isOwn ? " message-own" : ""}`} key={message.id}>
                <div className="message-meta">
                  <span className="message-sender">{message.isOwn ? "You" : message.username}</span>
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

        <form className="message-form" onSubmit={handleSubmit}>
          <label className="visually-hidden" htmlFor="chat-message">
            Message
          </label>
          <input
            ref={inputRef}
            id="chat-message"
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
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
