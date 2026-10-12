import { useEffect, useState } from 'react';
import { api, type AgentToken, type User } from '../api';
import { Shell } from '../components/Shell';

export function SettingsPage({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [tokens, setTokens] = useState<AgentToken[]>([]);
  const [urls, setUrls] = useState({ mcpUrl: '', apiUrl: '' });
  const [label, setLabel] = useState('Claude');
  const [created, setCreated] = useState<{ label: string; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwMsg, setPwMsg] = useState<string | null>(null);

  const load = () =>
    api
      .tokens()
      .then((r) => {
        setTokens(r.tokens);
        setUrls({ mcpUrl: r.mcpUrl, apiUrl: r.apiUrl });
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  const mcpUrl = urls.mcpUrl || `${location.origin}/mcp`;

  return (
    <Shell user={user} onSignOut={onSignOut}>
    <div className="page">
      <main className="settings">
        <h1 className="page-title">Settings</h1>
        <section className="panel">
          <h2>Agent connections</h2>
          <p className="muted">
            An agent token lets your own external agent (for example Claude Code or Claude Desktop) read and revise your episodes through the PlanB API and
            MCP server. It never needs your password, and you can revoke it at any time. Changes by an agent appear in your browser and in each episode’s history.
          </p>
          <form
            className="inline-form"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                setCreated(await api.createToken(label));
                void load();
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <div className="field grow">
              <label htmlFor="token-label">Name</label>
              <input id="token-label" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <button className="btn primary">Create token</button>
          </form>
          {created && (
            <div className="token-created">
              <p>
                <strong>Copy this token now.</strong> It is shown only once.
              </p>
              <code className="secret">{created.token}</code>
              <p className="muted small">Connect Claude Code (MCP over HTTP):</p>
              <pre className="code">{`claude mcp add --transport http planb ${mcpUrl} \\\n  --header "Authorization: Bearer ${created.token}"`}</pre>
              <p className="muted small">Other MCP clients: Streamable HTTP endpoint {mcpUrl} with header Authorization: Bearer &lt;token&gt;.</p>
            </div>
          )}
          {error && <p className="error">{error}</p>}
          <ul className="token-list">
            {tokens.map((t) => (
              <li key={t.id} className={t.revokedAt ? 'revoked' : ''}>
                <div>
                  <strong>{t.label}</strong> <code>{t.prefix}…</code>
                  <div className="muted small">
                    Created {new Date(t.createdAt).toLocaleDateString()}
                    {t.lastUsedAt ? ` · last used ${new Date(t.lastUsedAt).toLocaleString()}` : ' · never used'}
                    {t.revokedAt ? ` · revoked ${new Date(t.revokedAt).toLocaleDateString()}` : ''}
                  </div>
                </div>
                {!t.revokedAt && (
                  <button
                    className="btn small danger"
                    onClick={async () => {
                      await api.revokeToken(t.id);
                      void load();
                    }}
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="muted small">
            Give your agent the workflow guide in <code>docs/AGENT-WORKFLOW.md</code>; connected MCP clients can also call <code>get_workflow_guide</code>.
          </p>
        </section>

        <section className="panel">
          <h2>Password</h2>
          <p className="muted small">Signed in as {user.name || user.email}. Changing your password signs out your other devices.</p>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api.changePassword(pw.current, pw.next);
                setPwMsg('Password changed.');
                setPw({ current: '', next: '' });
              } catch (err) {
                setPwMsg((err as Error).message);
              }
            }}
          >
            <div className="field">
              <label htmlFor="pw-current">Current password</label>
              <input id="pw-current" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="pw-new">New password (at least 10 characters)</label>
              <input id="pw-new" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </div>
            {pwMsg && <p className="muted">{pwMsg}</p>}
            <button className="btn">Change password</button>
          </form>
        </section>
      </main>
    </div>
    </Shell>
  );
}
