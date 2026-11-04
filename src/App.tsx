import { HashRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from './ui';
import NewQuotePage from './pages/NewQuotePage';
import DocumentsPage from './pages/DocumentsPage';
import DocumentView from './pages/DocumentView';
import CatalogPage from './pages/CatalogPage';
import ProfilePage from './pages/ProfilePage';
import BackupPage from './pages/BackupPage';
import LandingPage from './pages/LandingPage';
export default function App() {
  return (<ToastProvider><HashRouter><Routes>
    <Route path="/" element={<NewQuotePage />} />
    <Route path="/documenti" element={<DocumentsPage />} />
    <Route path="/documenti/:id" element={<DocumentView />} />
    <Route path="/catalogo" element={<CatalogPage />} />
    <Route path="/profilo" element={<ProfilePage />} />
    <Route path="/backup" element={<BackupPage />} />
    <Route path="/info" element={<LandingPage />} />
  </Routes></HashRouter></ToastProvider>);
}
