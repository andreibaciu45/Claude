import { HashRouter, Link, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Icon, Skeleton, ToastProvider } from './ui';
import type { IconName } from './ui';
import NewQuotePage from './pages/NewQuotePage';
import DocumentsPage from './pages/DocumentsPage';
import DocumentView from './pages/DocumentView';
import CatalogPage from './pages/CatalogPage';
import ProfilePage from './pages/ProfilePage';
import BackupPage from './pages/BackupPage';
import LandingPage from './pages/LandingPage';
import { VoiceCommandWidget } from './voice/ui/VoiceCommandWidget';
import { attachSync, SyncBadge } from './sync';
import './app.css';

// Pagina account (opzionale): caricata solo quando serve; il fallback evita schermate bianche se il chunk non si carica.
const AccountPage = lazy(() => import('./pages/AccountPage'));

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
          <Outlet />
          <footer className="shell-footer">
            <Link to="/backup">Backup</Link><span aria-hidden="true">·</span><Link to="/account">Account</Link><span aria-hidden="true">·</span><SyncBadge /><span aria-hidden="true">·</span><Link to="/info">Informazioni</Link><span aria-hidden="true">·</span><a href={privacyHref}>Privacy</a>
          </footer>
        </main>
      </div>
      <VoiceCommandWidget />
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
          <Route path="/info" element={<LandingPage />} />
        </Routes>
      </HashRouter>
    </ToastProvider>
  );
}
