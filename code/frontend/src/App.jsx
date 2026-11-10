import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import Chat from './components/Chat';
import AuthForm from './components/AuthForm';
import { request } from './lib/api';

export default function App() {
  // Session tokens and decrypted keys only live in this tab's memory.
  const [session, setSession] = useState(null);
  const [notice, setNotice] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const expire = useCallback(() => {
    setSession(null);
    setNotice('Your session has ended. Log in to unlock your messages again.');
  }, []);

  useEffect(() => {
    // Discard credentials written by older versions, even if browser storage is restricted.
    try { localStorage.removeItem('token'); } catch { /* No persistent session is needed. */ }
  }, []);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(expire, Math.max(0, Date.parse(session.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [session, expire]);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    let message = '';
    try { await request('/auth/session', { method: 'DELETE', token: session.token }); }
    catch (error) {
      if (error.status !== 401) message = 'Signed out on this device. The server was unreachable; its session will expire within one hour.';
    } finally {
      setSession(null);
      setNotice(message);
      setLoggingOut(false);
    }
  }
  function login(value) { setNotice(''); setSession(value); }

  return <>
    <header className="navbar">
      <Link to={session ? '/chat' : '/login'} className="brand">SimpleChat</Link>
      <nav aria-label="Main navigation">
        {session ? <>
          <Link to="/chat">Chat</Link>
          <span className="signed-in-user">{session.user.username}</span>
          <button type="button" onClick={logout} disabled={loggingOut}>{loggingOut ? 'Signing out…' : 'Logout'}</button>
        </> : <>
          <Link to="/register">Register</Link>
          <Link to="/login">Login</Link>
        </>}
      </nav>
    </header>
    <Routes>
      <Route path="/" element={<Navigate to={session ? '/chat' : '/login'} replace />} />
      <Route path="/register" element={session ? <Navigate to="/chat" replace /> : <AuthForm key="register" mode="register" />} />
      <Route path="/login" element={session ? <Navigate to="/chat" replace /> : <AuthForm key="login" mode="login" onLogin={login} notice={notice} />} />
      <Route path="/chat" element={session ? <Chat session={session} onExpired={expire} /> : <Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to={session ? '/chat' : '/login'} replace />} />
    </Routes>
  </>;
}
