import { useEffect, useRef, useState } from "react";
import useChatConnection from "../hooks/useChatConnection";

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

export default function Chat() {
  const connectionStatus = useChatConnection();
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const messageAreaRef = useRef(null);
  const inputRef = useRef(null);

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
            Local preview: messages appear only in this tab and clear when you
            leave or refresh. They are not sent to other users yet.
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
              No messages yet. Type a message below to get started.
            </p>
          ) : (
            messages.map((message) => (
              <article className="message message-own" key={message.id}>
                <div className="message-meta">
                  <span className="message-sender">You</span>
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
