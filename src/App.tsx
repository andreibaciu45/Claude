import { HashRouter, Link, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Icon, Skeleton, ToastProvider } from './ui';
import type { IconName } from './ui';
import NewQuotePage from './pages/NewQuotePage';
import { attachSync, SyncBadge } from './sync';
import './app.css';

// Pagina account (opzionale): caricata solo quando serve; il fallback evita schermate bianche se il chunk non si carica.
const AccountPage = lazy(() => import('./pages/AccountPage'));
// Code splitting per rotta: la home (NewQuotePage) resta nel bundle principale, il resto si carica a richiesta.
const loaders = {
  documents: () => import('./pages/DocumentsPage'),
  document: () => import('./pages/DocumentView'),
  catalog: () => import('./pages/CatalogPage'),
  profile: () => import('./pages/ProfilePage'),
  backup: () => import('./pages/BackupPage'),
  landing: () => import('./pages/LandingPage'),
  account: () => import('./pages/AccountPage'),
  voice: () => import('./voice/ui/VoiceCommandWidget').then((m) => ({ default: m.VoiceCommandWidget })),
};
const DocumentsPage = lazy(loaders.documents);
const DocumentView = lazy(loaders.document);
const CatalogPage = lazy(loaders.catalog);
const ProfilePage = lazy(loaders.profile);
const BackupPage = lazy(loaders.backup);
const LandingPage = lazy(loaders.landing);
const VoiceCommandWidget = lazy(loaders.voice);

/** Dopo il primo rendering, quando il browser è inattivo, scarica i chunk delle altre rotte: niente attese né lampi bianchi alla prima navigazione. */
function usePreloadRoutes(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    const run = () => { setReady(true); Object.values(loaders).forEach((l) => { void l().catch(() => undefined); }); };
    if (w.requestIdleCallback) { const h = w.requestIdleCallback(run, { timeout: 2000 }); return () => w.cancelIdleCallback?.(h); }
    const h = window.setTimeout(run, 800);
    return () => window.clearTimeout(h);
  }, []);
  return ready;
}

const TABS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Nuovo', icon: 'mic', end: true },
  { to: '/documenti', label: 'Documenti', icon: 'file' },
  { to: '/catalogo', label: 'Catalogo', icon: 'box' },
  { to: '/profilo', label: 'Profilo', icon: 'user' },
];

const privacyHref = `${import.meta.env.BASE_URL}legal/privacy.html`;

const APP_NAME = 'VocePreventivo';

/**
 * A ogni cambio di rotta (HashRouter: solo `pathname`, non la query): scroll in cima, titolo del documento,
 * focus sull'<h1> della nuova pagina e annuncio per gli screen reader (regione aria-live).
 * Le pagine caricano i dati in modo asincrono e l'h1 può comparire dopo: si riprova per ~2 s.
 * Non si ruba il focus se l'utente sta già scrivendo in un campo della pagina. La pagina /info gestisce da sé il titolo.
 */
function RouteEffects({ onAnnounce }: { onAnnounce: (msg: string) => void }) {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    window.scrollTo(0, 0);
    const isFirst = first.current;
    first.current = false;
    let tries = 0;
    let timer = 0;
    const run = () => {
      const h1 = document.querySelector<HTMLElement>('h1');
      if (!h1) { if (++tries < 20) timer = window.setTimeout(run, 100); return; }
      const title = (h1.textContent ?? '').trim();
      if (pathname !== '/info' && title) document.title = `${title} – ${APP_NAME}`;
      if (isFirst) return; // primo caricamento: nessun focus forzato né annuncio (lo legge già il browser)
      const ae = document.activeElement as HTMLElement | null;
      const typing = !!ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && !!ae.closest('main');
      if (!typing) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
      onAnnounce(title ? `${title}, pagina caricata` : '');
    };
    timer = window.setTimeout(run, 0);
    return () => window.clearTimeout(timer);
  }, [pathname, onAnnounce]);
  return null;
}

function Shell() {
  const widgetReady = usePreloadRoutes();
  const mainRef = useRef<HTMLElement>(null);
  // NON `href="#main"`: con HashRouter diventerebbe una rotta.
  const skip = () => { mainRef.current?.focus(); mainRef.current?.scrollIntoView?.({ block: 'start' }); };
  return (
    <div className="shell">
      <button type="button" className="skip-link" onClick={skip}>Vai al contenuto</button>
      <nav className="nav" aria-label="Navigazione principale">
        <Link to="/" className="brand" aria-label="VocePreventivo, home">
          <Icon name="mic" size={32} /> VocePreventivo
        </Link>
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className="nav-link">
            <Icon name={t.icon} /> <span>{t.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="shell-body">
        <main className="shell-main" id="main" ref={mainRef} tabIndex={-1}>
          <Suspense fallback={<Skeleton lines={3} blocks={2} />}><Outlet /></Suspense>
          <footer className="shell-footer">
            <Link to="/backup">Backup</Link><span aria-hidden="true">·</span><Link to="/account">Account</Link><span aria-hidden="true">·</span><SyncBadge /><span aria-hidden="true">·</span><Link to="/info">Informazioni</Link><span aria-hidden="true">·</span><a href={privacyHref}>Privacy</a>
          </footer>
        </main>
      </div>
      {widgetReady && <Suspense fallback={null}><VoiceCommandWidget /></Suspense>}
    </div>
  );
}

export default function App() {
  // Sync opzionale: si attiva da solo solo se l'utente ha effettuato l'accesso.
  useEffect(() => attachSync(), []);
  const [announcement, setAnnouncement] = useState('');
  return (
    <ToastProvider>
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
      <HashRouter>
        <RouteEffects onAnnounce={setAnnouncement} />
        <Routes>
          <Route element={<Shell />}>
            <Route path="/" element={<NewQuotePage />} />
            <Route path="/documenti" element={<DocumentsPage />} />
            <Route path="/documenti/:id" element={<DocumentView />} />
            <Route path="/catalogo" element={<CatalogPage />} />
            <Route path="/profilo" element={<ProfilePage />} />
            <Route path="/backup" element={<BackupPage />} />
            <Route
              path="/account"
              element={
                <Suspense fallback={<Skeleton lines={3} blocks={2} />}>
                  <AccountPage />
                </Suspense>
              }
            />
          </Route>
          <Route path="/info" element={<Suspense fallback={<Skeleton lines={3} blocks={2} />}><LandingPage /></Suspense>} />
        </Routes>
      </HashRouter>
    </ToastProvider>
  );
}
