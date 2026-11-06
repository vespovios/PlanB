import { useEffect, useMemo, useRef, useState } from 'react';
import { api, setSessionUser, type SessionLostDetail, type User } from './api';
import { saves } from './saves';
import { SessionRecovery } from './session';
import { ReauthDialog } from './components/ReauthDialog';
import { installNavigator, useRoute } from './router';
import { HistoryNav, NavigationGuard } from './navigation';
import { LeaveDialog } from './components/LeaveDialog';
import { LoginPage } from './pages/Login';
import { EpisodesPage } from './pages/Episodes';
import { EpisodePage } from './pages/Episode';
import { ChecklistPage } from './pages/Checklist';
import { PlanDocumentPage } from './pages/PlanDocument';
import { SettingsPage } from './pages/Settings';
import { SignOutDialog, useSignOut } from './components/SignOutDialog';

export function App() {
  const [user, setUserState] = useState<User | null | undefined>(undefined);
  const [offline, setOffline] = useState(false);
  const current = useRef(user);
  current.current = user;
  /** The account this page acts for; every request names it (see api.ts). */
  const setUser = (u: User | null) => {
    setSessionUser(u?.id ?? null);
    setUserState(u);
  };
  // Sign-out saves first and returns to the login page only once the server confirmed it.
  const signOutFlow = useSignOut(() => setUser(null));
  // A lost session pauses the page instead of unmounting it; only the same account resumes it.
  const recovery = useMemo(
    () =>
      new SessionRecovery({
        onDiscarded: (notDeleted) => {
          setUser(null);
          signOutFlow.reportNotDeleted(notDeleted);
        },
      }),
    [],
  );
  // Moving to another page never silently drops work; the page shown changes only once a move is
  // approved. No move at all while signing out or signing in again (those own the page).
  const navGuard = useMemo(() => new NavigationGuard(), []);
  const nav = useMemo(
    () => new HistoryNav({ guard: navGuard, locked: () => recovery.getSnapshot().step !== 'active' || signOutFlow.getSnapshot().step !== 'idle' }),
    [],
  );
  const route = useRoute(nav);
  useEffect(() => {
    installNavigator(nav);
    const stop = nav.start();
    // Leaving PlanB or reloading: warn about anything not confirmed as saved. (Browsers decide
    // whether to show it; a closed or evicted phone tab gets no warning, and nothing is saved here.)
    const warn = (e: BeforeUnloadEvent) => {
      if (saves.report().outcome === 'confirmed') return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      stop();
      installNavigator(null);
      window.removeEventListener('beforeunload', warn);
    };
  }, []);

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.user))
      .catch((e) => {
        if (e.offline) setOffline(true);
        setUser(null);
      });
    const onSessionLost = (e: Event) => {
      const signedIn = current.current;
      if (!signedIn) return;
      const detail = (e as CustomEvent<SessionLostDetail>).detail;
      // About a request made for another account than this page's: not this page's session.
      if (detail?.userId && detail.userId !== signedIn.id) return;
      // Pause first, then abandon any sign-out in progress (its thaw cannot resume a paused session).
      recovery.lost(signedIn, detail?.code === 'session_user_changed');
      signOutFlow.reset();
      navGuard.reset();
    };
    window.addEventListener('planb:signed-out', onSessionLost);
    return () => window.removeEventListener('planb:signed-out', onSessionLost);
  }, []);

  if (user === undefined) return <div className="boot">Loading PlanB…</div>;
  if (user === null)
    return (
      <>
        <LoginPage
          onLogin={(u) => {
            // Nothing from a previous sign-in may be sent under, or shown to, this one. (Normally
            // nothing is left: sign-out and leaving a lost session both end with no work held.)
            if (saves.report().outcome !== 'confirmed') console.warn('PlanB: discarding work left from a previous sign-in');
            saves.discardAll();
            setUser(u);
          }}
          offline={offline}
        />
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
      <ReauthDialog recovery={recovery} />
      <LeaveDialog guard={navGuard} />
    </>
  );
}
