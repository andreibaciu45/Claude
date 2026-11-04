# Download e condivisione file nell'app nativa (punto di aggancio)

Nell'app Capacitor un `<a download>` su un `blob:` **non funziona in modo affidabile** (iOS WKWebView non scarica; Android spesso non mostra nulla). Il punto unico da cambiare è `downloadBlob` in `src/pages/quote/shared.ts` (usata per PDF e XML). Altri punti con lo stesso schema: `src/voice/executor.ts:310` (invio PDF vocale), `src/pages/catalog/styles.ts:33` (esportazione).
Questi file NON sono del ruolo MOBILE: ecco la modifica minima proposta per chi li possiede.

## Principio
Come per la voce, **nessuna dipendenza nella PWA**: i plugin `@capacitor/filesystem` e `@capacitor/share` (installati in `mobile/`) si raggiungono dal bridge globale `window.Capacitor` solo se `isNativePlatform()`. Nel browser il comportamento resta quello attuale.

## Patch proposta (in `src/pages/quote/shared.ts`)
```ts
type Cap = { isNativePlatform(): boolean; registerPlugin<T>(n: string): T };
const nativeCap = (): Cap | null => {
  const c = (window as unknown as { Capacitor?: Cap }).Capacitor;
  return c?.isNativePlatform?.() ? c : null;
};

/** App nativa: salva in cache e apre il foglio di condivisione (Salva su File, Mail, WhatsApp...). */
async function shareNative(c: Cap, blob: Blob, name: string): Promise<void> {
  const fs = c.registerPlugin<{
    writeFile(o: { path: string; data: string; directory: string }): Promise<{ uri: string }>;
  }>('Filesystem');
  const share = c.registerPlugin<{ share(o: { title?: string; files: string[]; dialogTitle?: string }): Promise<unknown> }>('Share');
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const { uri } = await fs.writeFile({ path: name, data: btoa(bin), directory: 'CACHE' });
  await share.share({ title: name, files: [uri], dialogTitle: 'Condividi o salva' });
}

export const downloadBlob = (blob: Blob, name: string): void => {
  const c = nativeCap();
  if (c) { void shareNative(c, blob, name).catch(() => { /* annullato dall'utente */ }); return; }
  /* ...codice attuale invariato... */
};
```
Note: `directory: 'CACHE'` evita permessi di archiviazione su Android 10+; l'utente sceglie dove salvare dal foglio di condivisione. Gli XML (`.xml`) vanno condivisi allo stesso modo. Verificare su dispositivo reale che Share accetti file `.xml` con WhatsApp/Mail/File.

## Token di accesso (sync)
`tokenStore` in `src/sync/api.ts` usa `localStorage` (sincrono). In app nativa il token è nella WebView (non cifrato). Opzione minima: lasciare così in v1 (rischio simile a un cookie di sessione; l'app ha `allowBackup=false`). Opzione migliore: `@aparajita/capacitor-secure-storage` (Keychain/Keystore, già installato in `mobile/`) ma è **asincrono**: richiede di rendere asincrono `tokenStore.get` o di precaricare il token all'avvio in una variabile in memoria (`await SecureStorage.get('vp:token')` prima del render, `set` in scrittura). Da decidere con SYNC-CLIENT.

## Voce
`src/voice/provider/native.ts` esporta `isNativeSpeechAvailable()` e `NativeSpeechProvider`. Aggancio in `factory.ts` (proposta):
```ts
if (isNativeSpeechAvailable()) return { provider: new NativeSpeechProvider(opts.lang), selection: { kind: 'webspeech', reason: 'webspeech' } };
```
come primo caso di `createSpeechProvider` (+ opzionale: aggiungere `'native'` a `ProviderKind`).

## Altro lato app
- API server: l'app carica da `https://localhost` (Android) / `capacitor://localhost` (iOS): il server deve consentire queste **origini CORS** e gli URL API devono essere assoluti (non relativi) con `VITE_API_URL` in build.
- Service worker: in Capacitor è inutile (file locali); non registrarlo se `isNativePlatform()` (facoltativo).
