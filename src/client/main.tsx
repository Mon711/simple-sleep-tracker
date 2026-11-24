import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Entry, Kind, Today as Context } from '../shared/schemas.ts';
import { clockAt, clockLabel } from '../shared/time.ts';
import { ApiError, readableError, request } from './api.ts';
import { EntryEditor } from './EntryEditor.tsx';
import { Goals } from './Goals.tsx';
import { History } from './History.tsx';
import { Today } from './Today.tsx';
import type { EditSelection } from './Today.tsx';
import './styles.css';

const screens = ['Today', 'History', 'Goals'] as const;
type Screen = typeof screens[number];

function selectedScreen(): Screen {
  return screens.find(name => '#' + name.toLowerCase() === location.hash) ?? 'Today';
}

function Brand() {
  return <div className="brand"><span className="brand-mark" aria-hidden="true" />Simple Sleep Tracker</div>;
}

function App() {
  const [screen, setScreen] = useState<Screen>(selectedScreen);
  const [context, setContext] = useState<Context | null>(null);
  const [accessError, setAccessError] = useState<{ message: string; mode?: Context['mode'] } | null>(null);
  const [edit, setEdit] = useState<EditSelection | null>(null);
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(0);
  const newest = useRef(0);
  const content = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const lookup = ++newest.current;
    try {
      const data = await request<Context>('/api/today');
      if (lookup === newest.current) {
        setContext(data);
        setAccessError(null);
      }
    } catch (error) {
      if (lookup !== newest.current) return;
      if (error instanceof ApiError && error.status === 401) {
        setContext(null);
        setEdit(null);
        setNotice(null);
        setAccessError({ message: error.message, mode: error.mode });
      } else {
        setAccessError({ message: readableError(error) });
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const onHash = () => {
      setScreen(selectedScreen());
      setNotice(null);
      window.scrollTo(0, 0);
      window.requestAnimationFrame(() => content.current?.focus({ preventScroll: true }));
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('hashchange', onHash);
    const interval = window.setInterval(onVisible, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('hashchange', onHash);
      window.clearInterval(interval);
    };
  }, [refresh]);

  function announceSaved(message: string) {
    setNotice({ message });
    setChanged(value => value + 1);
    return refresh();
  }

  async function logNow(kind: Kind, night: string) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await request<{ entry: Entry; created: boolean }>('/api/check-ins/now', { body: { kind, night } });
      const saved = clockLabel(clockAt(Date.parse(result.entry.at)));
      const event = kind === 'bed' ? 'Bedtime' : 'Wake time';
      // Keep the quick-save action pending until the card order has been recalculated.
      await announceSaved(event + (result.created ? ' saved at ' : ' already saved at ') + saved + '.');
    } catch (error) {
      setNotice({ message: readableError(error), error: true });
      void refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!context) {
    return (
      <main className="app shell">
        <Brand />
        <header className="screen-heading"><h1>Sleep Tracker</h1></header>
        <section className="panel">
          {accessError ? (
            <>
              <p className="muted">{accessError.mode === 'synthetic'
                ? 'Open the local tracker with synthetic data.' : accessError.message}</p>
              {accessError.mode === 'synthetic' ? (
                <form action="/demo/sign-in" method="post">
                  <button className="button primary section-actions">Open synthetic tracker</button>
                </form>
              ) : accessError.mode === 'sites' ? (
                <a className="button primary section-actions" href="/signin-with-chatgpt?return_to=%2F" target="_top">Sign in with ChatGPT</a>
              ) : <button className="button secondary section-actions" onClick={() => void refresh()}>Try again</button>}
            </>
          ) : <p className="muted" role="status">Opening your tracker…</p>}
        </section>
      </main>
    );
  }

  return (
    <>
      <main className="app">
        <div className="brand-row"><Brand />
          {context.mode === 'synthetic' && <span className="profile">Synthetic</span>}
        </div>
        <div ref={content} tabIndex={-1} className="screen">
          <div className="feedback" aria-live="polite" aria-atomic="true">
            {notice && <p className={notice.error ? 'message error' : 'message success'}>{notice.message}</p>}
          </div>
          {accessError && <p className="message error">Connection problem. Showing the last loaded view.</p>}
          {screen === 'Today' && <Today context={context} busy={busy} onNow={logNow} onEdit={setEdit} />}
          {screen === 'History' && <History context={context} changed={changed} onEdit={setEdit} />}
          {screen === 'Goals' && <Goals changed={changed} date={context.date} onChanged={announceSaved} />}
        </div>
        {context.mode !== 'private' && (
          <footer className="footer">
            {context.mode === 'sites' ? <a className="text-button" href="/signout-with-chatgpt?return_to=%2F" target="_top">Sign out</a> :
              <form action="/demo/sign-out" method="post"><button className="text-button">Sign out of synthetic tracker</button></form>}
          </footer>
        )}
        {edit && <EntryEditor key={edit.kind + edit.night} selection={edit} context={context}
          onClose={() => setEdit(null)} onSaved={() => {
            setEdit(null);
            announceSaved('Check-in saved.');
          }} />}
      </main>
      <nav className="navigation" aria-label="Tracker">
        <div>
          {screens.map(name => (
            <a key={name} href={'#' + name.toLowerCase()} aria-current={name === screen ? 'page' : undefined}>
              <span className={'nav-icon ' + name.toLowerCase()} aria-hidden="true" />{name}
            </a>
          ))}
        </div>
      </nav>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);

if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, { once: true });
}
