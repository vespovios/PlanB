import { useEffect, useState } from 'react';
import { api, type User } from './api';
import { useRoute } from './router';
import { LoginPage } from './pages/Login';
import { EpisodesPage } from './pages/Episodes';
import { EpisodePage } from './pages/Episode';
import { ChecklistPage } from './pages/Checklist';
import { PlanDocumentPage } from './pages/PlanDocument';
import { SettingsPage } from './pages/Settings';
import { SignOutDialog, useSignOut } from './components/SignOutDialog';

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [offline, setOffline] = useState(false);
  const route = useRoute();
  // Sign-out saves first and returns to the login page only once the server confirmed it.
  const signOutFlow = useSignOut(() => setUser(null));

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.user))
      .catch((e) => {
        if (e.offline) setOffline(true);
        setUser(null);
      });
    const onSignedOut = () => {
      signOutFlow.reset();
      setUser(null);
    };
    window.addEventListener('planb:signed-out', onSignedOut);
    return () => window.removeEventListener('planb:signed-out', onSignedOut);
  }, []);

  if (user === undefined) return <div className="boot">Loading PlanB…</div>;
  if (user === null)
    return (
      <>
        <LoginPage onLogin={setUser} offline={offline} />
        {/* Signed out, but something to report about the discarded work (e.g. a local copy left behind). */}
        <SignOutDialog flow={signOutFlow} />
      </>
    );

  const signOut = () => void signOutFlow.start();

  let page: React.ReactNode;
  switch (route.name) {
    case 'episode':
      page = <EpisodePage key={route.id} id={route.id} tab={route.tab} user={user} onSignOut={signOut} />;
      break;
    case 'checklist':
      page = <ChecklistPage key={route.id} id={route.id} user={user} onSignOut={signOut} />;
      break;
    case 'document':
      page = <PlanDocumentPage key={route.id} id={route.id} user={user} onSignOut={signOut} />;
      break;
    case 'settings':
      page = <SettingsPage user={user} onSignOut={signOut} />;
      break;
    default:
      page = <EpisodesPage user={user} onSignOut={signOut} />;
  }
  return (
    <>
      {page}
      <SignOutDialog flow={signOutFlow} />
    </>
  );
}
