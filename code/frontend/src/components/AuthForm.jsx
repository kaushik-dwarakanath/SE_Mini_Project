import { useState } from 'react';
import { Link } from 'react-router-dom';
import { loginAccount, registerAccount } from '../lib/auth';

export default function AuthForm({ mode, onLogin, notice }) {
  const registering = mode === 'register';
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (loading) return;
    setError('');
    setSuccess('');
    if (registering && (password.length < 12 || password.length > 128)) {
      setError('Use a password or passphrase with 12–128 characters.');
      return;
    }
    if (registering && password !== confirmation) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      if (registering) {
        await registerAccount({ username: username.trim(), email: email.trim().toLowerCase(), password });
        setPassword('');
        setConfirmation('');
        setSuccess('Account created successfully. You can now log in.');
      } else {
        const session = await loginAccount(username.trim(), password);
        setPassword('');
        onLogin(session);
      }
    } catch (failure) {
      setError(failure.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <section className="form-card">
        <h1>{registering ? 'Create an account' : 'Welcome back'}</h1>
        <p className="subtitle">{registering ? 'Register to get started.' : 'Log in to unlock your private conversations.'}</p>
        {notice && <p className="notice" role="status">{notice}</p>}
        <form onSubmit={handleSubmit}>
          <label htmlFor="username">{registering ? 'Username' : 'Username or email'}</label>
          <input id="username" type="text" value={username} onChange={(event) => setUsername(event.target.value)}
            autoComplete="username" required maxLength={registering ? 32 : 254}
            minLength={registering ? 3 : 1} pattern={registering ? '[A-Za-z0-9_]{3,32}' : undefined}
            title={registering ? '3–32 letters, numbers or underscores. Usernames are case-sensitive.' : undefined}
            disabled={loading} />
          {registering && <>
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)}
              autoComplete="email" required maxLength={254} disabled={loading} />
          </>}
          <label htmlFor="password">Password</label>
          <input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)}
            autoComplete={registering ? 'new-password' : 'current-password'} required
            minLength={registering ? 12 : 1} maxLength={registering ? 128 : 1024} disabled={loading} />
          {registering && <>
            <label htmlFor="confirmation">Confirm password</label>
            <input id="confirmation" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="new-password" required maxLength={128} disabled={loading} />
            <p className="notice">Keep your password safe. It unlocks your messages on every device; forgotten passwords cannot recover encrypted history.</p>
          </>}
          {error && <p className="notice" role="alert">{error}</p>}
          {success && <p className="notice" role="status">{success} <Link to="/login">Log in</Link></p>}
          <button type="submit" disabled={loading}>{loading ? 'Please wait…' : registering ? 'Register' : 'Login'}</button>
        </form>
        <p className="form-footer">
          {registering ? <>Already have an account? <Link to="/login">Login</Link></> : <>Don't have an account? <Link to="/register">Register</Link></>}
        </p>
      </section>
    </main>
  );
}
