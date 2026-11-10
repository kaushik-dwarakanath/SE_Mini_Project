import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { request } from '../lib/api';
import Conversation from './Conversation';

export default function Chat({ session, onExpired }) {
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState('');
  const [peer, setPeer] = useState(null);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [connected, setConnected] = useState(false);
  const [revision, setRevision] = useState(0);
  const [events] = useState(() => new EventTarget());
  const [unread, setUnread] = useState({});
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const result = await request(`/users?q=${encodeURIComponent(query)}`, { token: session.token, signal: controller.signal });
        if (controller.signal.aborted) return;
        setUsers(result.users);
        setHasMore(result.hasMore);
        setError('');
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (failure.status === 401) onExpired();
        else setError(failure.message);
      }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [session.token, query, refresh, revision, onExpired]);

  useEffect(() => {
    const socket = io({ auth: { token: session.token }, reconnection: true });
    socket.on('connect', () => { setConnected(true); setRevision((value) => value + 1); });
    socket.on('disconnect', (reason) => {
      setConnected(false);
      if (reason === 'io server disconnect') onExpired();
    });
    socket.on('session_expired', onExpired);
    socket.on('connect_error', (failure) => {
      setConnected(false);
      if (failure.data?.code === 'UNAUTHORIZED') onExpired();
    });
    socket.on('new_message', (message) => {
      events.dispatchEvent(new CustomEvent('message', { detail: message }));
      if (message.senderId !== session.user.id) {
        setUnread((current) => ({ ...current, [message.senderId]: true }));
        // A newly registered sender may not yet appear in this device's directory.
        setRefresh((value) => value + 1);
      }
    });
    return () => { socket.removeAllListeners(); socket.disconnect(); };
  }, [session, onExpired, events]);

  function choose(user) {
    setPeer(user);
    setUnread((current) => ({ ...current, [user.id]: false }));
  }

  return <main className="page chat-page">
    <section className="chat-shell" aria-label="Private chat">
      <aside className="contacts" aria-label="People">
        <h1>People</h1>
        <p className="subtitle">Choose someone to start a private conversation.</p>
        <label htmlFor="contact-search">Search usernames</label>
        <input id="contact-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={32} />
        <button className="secondary-button" onClick={() => setRefresh((value) => value + 1)}>Refresh people</button>
        {error && <p className="notice" role="alert">{error}</p>}
        <ul className="contact-list">
          {users.map((user) => <li key={user.id}>
            <button type="button" className={peer?.id === user.id ? 'contact selected' : 'contact'}
              aria-pressed={peer?.id === user.id} onClick={() => choose(user)}>
              {user.username}{unread[user.id] && peer?.id !== user.id && <span className="unread"> · New message</span>}
            </button>
          </li>)}
        </ul>
        {!users.length && <p className="subtitle">No people found. Ask your friend to register, then refresh this list.</p>}
        {hasMore && <p className="subtitle">Showing 50 people. Search to narrow the list.</p>}
      </aside>
      {peer ? <Conversation key={`${peer.id}:${peer.publicKey}`} peer={peer} session={session} connected={connected}
        revision={revision} events={events} onExpired={onExpired} onBack={() => setPeer(null)} /> :
        <section className="chat-card chat-welcome">
          <h2>Your conversations</h2>
          <p>Choose a person from the list to send an end-to-end encrypted message.</p>
          <p className="connection-status" role="status">{connected ? 'Connected' : 'Connecting…'}</p>
        </section>}
    </section>
  </main>;
}
