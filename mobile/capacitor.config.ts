import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Wrapper nativo della PWA. L'appId è un SEGNAPOSTO: va deciso PRIMA di creare l'app
 * negli store, perché poi non si può più cambiare (vedi docs/MOBILE.md).
 */
const config: CapacitorConfig = {
  appId: 'it.example.vocepreventivo',
  appName: 'VocePreventivo',
  webDir: '../dist',
  server: {
    androidScheme: 'https',
    // L'app carica i file locali (dist). Nessun `url` remoto: funziona offline.
  },
  ios: { contentInset: 'always' },
  plugins: {
    SplashScreen: { launchShowDuration: 0, backgroundColor: '#0f172a' },
    StatusBar: { style: 'DARK', backgroundColor: '#0f172a' },
  },
};

export default config;
