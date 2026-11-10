import { useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';
import { conversationKey, decryptMessage, encryptMessage, safetyNumber, MAX_MESSAGE_LENGTH } from '../lib/crypto';

const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
function mergeMessages(current, added) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of added) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
}
async function readable(key, message) {
  try { return { ...message, text: await decryptMessage(key, message) }; }
  catch { return { ...message, text: 'This message could not be verified or decrypted.', invalid: true }; }
}

export default function Conversation({ peer, session, connected, revision, events, onExpired, onBack }) {
  const [security, setSecurity] = useState(null);
  const [trusted, setTrusted] = useState(false);
  const [messages, setMessages] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [historyReady, setHistoryReady] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [pinWarning, setPinWarning] = useState('');
  const pending = useRef(null);
  const busy = useRef(false);
  const messageArea = useRef(null);
  const input = useRef(null);
  const stickToBottom = useRef(true);
  const pinName = `simplechat:peer:${session.user.id}:${peer.id}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [key, number] = await Promise.all([
          conversationKey(session.privateKey, peer.publicKey, session.user.id, peer.id),
          safetyNumber(session.user.publicKey, peer.publicKey),
        ]);
        if (cancelled) return;
        let changed = false;
        try {
          const pinned = localStorage.getItem(pinName);
          changed = Boolean(pinned && pinned !== peer.publicKey);
          if (!pinned) localStorage.setItem(pinName, peer.publicKey);
        } catch {
          setPinWarning('This browser cannot remember safety keys. Compare the safety number each time you sign in.');
        }
        setSecurity({ key, number, changed });
        setTrusted(!changed);
      } catch { if (!cancelled) setError('Unable to prepare this encrypted conversation.'); }
    })();
    return () => { cancelled = true; };
  }, [session, peer, pinName]);

  useEffect(() => {
    if (!security || !trusted) return;
    const controller = new AbortController();
    (async () => {
      try {
        const result = await request(`/messages/${peer.id}`, { token: session.token, signal: controller.signal });
        const decoded = await Promise.all(result.messages.map((message) => readable(security.key, message)));
        if (controller.signal.aborted) return;
        setMessages((current) => mergeMessages(current, decoded));
        setCursor(result.nextCursor);
        setHistoryReady(true);
        setError('');
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (failure.status === 401) onExpired();
        else setError(failure.message);
      }
    })();
    return () => controller.abort();
  }, [security, trusted, peer.id, session.token, revision, retry, onExpired]);

  useEffect(() => {
    if (!security || !trusted) return;
    let active = true;
    async function receive(event) {
      const message = event.detail;
      if (!((message.senderId === peer.id && message.recipientId === session.user.id)
        || (message.senderId === session.user.id && message.recipientId === peer.id))) return;
      const decoded = await readable(security.key, message);
      if (active) setMessages((current) => mergeMessages(current, [decoded]));
    }
    events.addEventListener('message', receive);
    return () => { active = false; events.removeEventListener('message', receive); };
  }, [events, security, trusted, peer.id, session.user.id]);

  useEffect(() => {
    if (stickToBottom.current && messageArea.current) {
      messageArea.current.scrollTop = messageArea.current.scrollHeight;
    }
  }, [messages]);

  async function loadOlder() {
    if (!cursor || loadingOlder) return;
    setLoadingOlder(true);
    stickToBottom.current = false;
    try {
      const result = await request(`/messages/${peer.id}?before=${cursor}`, { token: session.token });
      const decoded = await Promise.all(result.messages.map((message) => readable(security.key, message)));
      setMessages((current) => mergeMessages(current, decoded));
      setCursor(result.nextCursor);
    } catch (failure) {
      if (failure.status === 401) onExpired();
      else setError(failure.message);
    } finally { setLoadingOlder(false); }
  }

  async function send(event) {
    event.preventDefault();
    if (busy.current || !draft.trim() || !security || !trusted || !historyReady || !connected) return;
    busy.current = true;
    setSending(true);
    setError('');
    const text = draft.trim();
    try {
      // Retain the same encrypted envelope after a lost response; retries cannot duplicate it.
      if (!pending.current || pending.current.text !== text) {
        pending.current = { text, envelope: await encryptMessage(security.key, text, session.user.id, peer.id) };
      }
      const { message } = await request('/messages', { method: 'POST', token: session.token, body: pending.current.envelope });
      stickToBottom.current = true;
      setMessages((current) => mergeMessages(current, [{ ...message, text }]));
      pending.current = null;
      setDraft('');
      input.current?.focus();
    } catch (failure) {
      if (failure.status === 401) onExpired();
      else setError(`${failure.message} Your message is kept below; press Send to retry.`);
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  function trustUpdatedKey() {
    try { localStorage.setItem(pinName, peer.publicKey); }
    catch { setPinWarning('This browser cannot remember safety keys. Verify again next time.'); }
    setTrusted(true);
  }

  return <section className="chat-card" aria-labelledby="chat-title">
    <header className="chat-header">
      <button className="secondary-button back-button" type="button" onClick={onBack}>Back to people</button>
      <h2 id="chat-title">{peer.username}</h2>
      <p className="subtitle" role="status">{connected ? 'Connected · End-to-end encrypted' : 'Reconnecting… Sending resumes when connected.'}</p>
      {security && <details className="safety-details">
        <summary>Verify safety number</summary>
        <p>Compare this number with {peer.username} in person or over a trusted call. Both devices should show the same number.</p>
        <code>{security.number}</code>
      </details>}
      {security?.changed && !trusted && <div role="alert" className="notice">
        <p>This person's encryption key changed. Compare the safety number before continuing.</p>
        <button type="button" onClick={trustUpdatedKey}>I verified the new safety number</button>
      </div>}
      {pinWarning && <p className="notice">{pinWarning}</p>}
    </header>
    {error && <p className="notice" role="alert">{error} {!historyReady && <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry loading</button>}</p>}
    {cursor && <button className="secondary-button" type="button" disabled={loadingOlder} onClick={loadOlder}>
      {loadingOlder ? 'Loading…' : 'Load older messages'}
    </button>}
    <div className="messages" ref={messageArea} role="log" aria-label="Chat messages" aria-live="polite"
      aria-relevant="additions" tabIndex={0} onScroll={(event) => {
        const area = event.currentTarget;
        stickToBottom.current = area.scrollHeight - area.scrollTop - area.clientHeight < 64;
      }}>
      {!messages.length && <p className="empty-message">{historyReady
        ? 'No messages yet. Type a message below to get started.' : 'Unlocking conversation…'}</p>}
      {messages.map((message) => <article className={message.senderId === session.user.id ? 'message message-own' : 'message'} key={message.id}>
        <div className="message-meta">
          <span className="message-sender">{message.senderId === session.user.id ? 'You' : peer.username}</span>
          <time className="message-time" dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>
            {timeFormatter.format(new Date(message.createdAt))}
          </time>
        </div>
        <p className={message.invalid ? 'notice' : undefined}>{message.text}</p>
      </article>)}
    </div>
    <form className="message-form" onSubmit={send}>
      <label className="visually-hidden" htmlFor="chat-message">Message</label>
      <input id="chat-message" ref={input} type="text" value={draft} onChange={(event) => setDraft(event.target.value)}
        placeholder="Type a message…" autoComplete="off" maxLength={MAX_MESSAGE_LENGTH} readOnly={sending}
        disabled={!trusted || !historyReady} />
      <button type="submit" disabled={!draft.trim() || sending || !connected || !trusted || !historyReady}>
        {sending ? 'Sending…' : 'Send'}
      </button>
    </form>
  </section>;
}
