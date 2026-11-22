import { useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import { IponLogo } from './Logo.jsx';
import Dashboard from './Dashboard.jsx';

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(getToken()));

  // Restore a saved login
  useEffect(() => {
    if (!getToken()) return;
    api('/auth/me')
      .then(({ user }) => setUser(user))
      .catch(() => setToken(null))
      .finally(() => setChecking(false));
  }, []);

  const signOut = () => { setToken(null); setUser(null); };

  if (checking) return <div className="center"><IponLogo height={44} dark /></div>;
  if (!user) return <SignIn onSignedIn={setUser} />;
  return <Dashboard user={user} onSignOut={signOut} />;
}

function SignIn({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token, user } = await api('/auth/login', { method: 'POST', body: { email: email.trim(), password } });
      setToken(token);
      onSignedIn(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="signin">
      <form className="card signin-card" onSubmit={submit}>
        <IponLogo height={44} dark />
        <div>
          <h1>Welcome back</h1>
          <p className="muted">Your wallet at a glance. Use the same account as the Ipon app.</p>
        </div>
        <label>
          Email
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted small">New to Ipon? Create your account in the app first.</p>
      </form>
    </main>
  );
}
