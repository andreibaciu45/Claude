import { HashRouter, Link, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Suspense, lazy, useEffect } from 'react';
import { Icon, ToastProvider } from './ui';
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

// Pagina account (opzionale): caricata solo quando serve; il fallback evita schermate bianche se il chunk non si carica.
const AccountPage = lazy(() => import('./pages/AccountPage'));

const TABS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Nuovo', icon: 'mic', end: true },
  { to: '/documenti', label: 'Documenti', icon: 'file' },
  { to: '/catalogo', label: 'Catalogo', icon: 'box' },
  { to: '/profilo', label: 'Profilo', icon: 'user' },
];

const privacyHref = `${import.meta.env.BASE_URL}legal/privacy.html`;

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function Shell() {
  return (
    <div className="shell">
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
        <main className="shell-main" id="main">
          <Outlet />
          <footer className="shell-footer">
            <Link to="/account">Account</Link><span aria-hidden="true">·</span><SyncBadge /><span aria-hidden="true">·</span><Link to="/info">Informazioni</Link><span aria-hidden="true">·</span><a href={privacyHref}>Privacy</a>
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
  return (
    <ToastProvider>
      <HashRouter>
        <ScrollTop />
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
                <Suspense fallback={<div className="qe-loading" role="status" aria-label="Caricamento"><span className="spinner" /></div>}>
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
