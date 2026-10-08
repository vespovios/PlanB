import { useState } from 'react';
import { api, type User } from '../api';
import { Logo } from '../components/ui';

export function LoginPage({ onLogin, offline }: { onLogin: (u: User) => void; offline: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(offline ? 'Cannot reach the PlanB server.' : null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <form
        className="login-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            onLogin((await api.login(email, password)).user);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Logo size="lg" />
        <p className="muted">Plan episodes as timed scenes and shot checklists.</p>
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted small">Accounts are created by the server administrator.</p>
      </form>
    </main>
  );
}
