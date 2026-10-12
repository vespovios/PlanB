import { useEffect, useState } from 'react';
import { api, type User } from './api';
import { useRoute } from './router';
import { LoginPage } from './pages/Login';
import { EpisodesPage } from './pages/Episodes';
import { EpisodePage } from './pages/Episode';
import { ChecklistPage } from './pages/Checklist';
import { PlanDocumentPage } from './pages/PlanDocument';
import { SettingsPage } from './pages/Settings';

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [offline, setOffline] = useState(false);
  const route = useRoute();

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.user))
      .catch((e) => {
        if (e.offline) setOffline(true);
        setUser(null);
      });
    const onSignedOut = () => setUser(null);
    window.addEventListener('planb:signed-out', onSignedOut);
    return () => window.removeEventListener('planb:signed-out', onSignedOut);
  }, []);

  if (user === undefined) return <div className="boot">Loading PlanB…</div>;
  if (user === null) return <LoginPage onLogin={setUser} offline={offline} />;

  const signOut = async () => {
    await api.logout().catch(() => undefined);
    setUser(null);
  };

  switch (route.name) {
    case 'episode':
      return <EpisodePage key={route.id} id={route.id} tab={route.tab} user={user} onSignOut={signOut} />;
    case 'checklist':
      return <ChecklistPage key={route.id} id={route.id} user={user} onSignOut={signOut} />;
    case 'document':
      return <PlanDocumentPage key={route.id} id={route.id} user={user} onSignOut={signOut} />;
    case 'settings':
      return <SettingsPage user={user} onSignOut={signOut} />;
    default:
      return <EpisodesPage user={user} onSignOut={signOut} />;
  }
}
