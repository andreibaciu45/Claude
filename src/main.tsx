import { createRoot } from 'react-dom/client';
import './styles/index.css';
import App from './App';
import { getUpdater } from './pwa/updater';

createRoot(document.getElementById('root')!).render(<App />);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Registrazione + rilevamento nuove versioni + controllo periodico: vedi src/pwa/updater.ts e docs/PWA.md.
    void getUpdater()?.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
