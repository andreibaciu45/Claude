import { useEffect, useState } from 'react';
import { Badge, Card } from '../ui';
import './landing/landing.css';

// Prezzi e limiti modificabili qui.
const FREE_DOCS_PER_MONTH = 3;
const PRO_PRICE_MONTH = 15;
const PRO_PRICE_YEAR = 120;
const BASE = import.meta.env.BASE_URL;
const LEGAL = (f: string) => `${BASE}legal/${f}.html`;
const PAGE_TITLE = 'VocePreventivo – Detti il lavoro, il preventivo è pronto';
const PAGE_DESC =
  'App per artigiani: detti il lavoro a voce, VocePreventivo cerca le voci nel tuo listino e crea preventivi, fatture e note di credito e genera l’XML della fattura elettronica per forfettari. Funziona offline; l’account è facoltativo.';

const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

const PHRASE = 'Sostituzione miscelatore bagno, due ore di manodopera e un sifone';
const ROWS = [
  { d: 'Miscelatore lavabo cromato', q: '1 pz × 68,00 €', t: '68,00 €' },
  { d: 'Sifone a bottiglia 1¼"', q: '1 pz × 12,50 €', t: '12,50 €' },
  { d: 'Manodopera idraulico', q: '2 h × 38,00 €', t: '76,00 €' },
];

function Demo() {
  const [n, setN] = useState(0);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const r = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    setReduced(r);
    if (r) { setN(PHRASE.length + 4); return; }
    const id = window.setInterval(() => setN((v) => (v > PHRASE.length + 40 ? 0 : v + 1)), 70);
    return () => window.clearInterval(id);
  }, []);
  const typed = Math.min(n, PHRASE.length);
  const shown = n <= PHRASE.length ? 0 : Math.min(ROWS.length, Math.floor((n - PHRASE.length) / 3));
  return (
    <div className="lp-demo" role="img" aria-label="Esempio: la frase dettata diventa una scheda preventivo con tre righe e totale">
      <div className="lp-bubble" aria-hidden="true">
        <span className="lp-mic">🎤</span>
        <span>“{PHRASE.slice(0, typed)}”{!reduced && typed < PHRASE.length && <span className="lp-caret" />}</span>
      </div>
      <div className="lp-sheet" aria-hidden="true">
        <div className="lp-sheet-head"><span>Preventivo n. 12</span><Badge tone="success">pronto</Badge></div>
        {shown === 0 && <div className="lp-ghostrow">Ascolto…</div>}
        {ROWS.slice(0, shown).map((r) => (
          <div className="lp-row" key={r.d}><span>{r.d}</span><b>{r.t}</b><small>{r.q}</small></div>
        ))}
        <div className="lp-total"><span>Totale</span><span>{shown >= 3 ? '156,50 €' : '…'}</span></div>
      </div>
    </div>
  );
}

const FAQ = [
  ['Funziona senza internet?', 'Sì, in gran parte. Dopo la prima apertura l’app si installa sul telefono e listino, documenti e PDF funzionano anche in cantiere senza campo. Il riconoscimento vocale del browser, invece, di solito ha bisogno della connessione: senza rete scrivi la frase a mano e l’app la interpreta allo stesso modo.'],
  ['Che telefono e che browser servono?', 'Meglio Chrome su Android e Safari recente su iPhone. Su Firefox e su alcuni computer la dettatura non c’è: puoi scrivere la frase nel campo di testo.'],
  ['È una fattura elettronica?', 'L’app genera il file XML della fattura elettronica per chi è in regime forfettario, più una copia di cortesia in PDF. L’invio allo SDI lo fai tu: carichi l’XML sul portale gratuito dell’Agenzia delle Entrate oppure lo mandi via PEC. VocePreventivo non trasmette nulla per te e non promette la conformità fiscale: è uno strumento di supporto, verifica sempre con il tuo commercialista.'],
  ['Posso annullare una fattura sbagliata?', 'Una fattura emessa non si modifica né si cancella: si annulla con una nota di credito collegata, che l’app prepara per te. Le bozze e i preventivi invece si possono cancellare.'],
  ['Il microfono: chi sente cosa dico?', 'Di solito il riconoscimento vocale lo fa il tuo browser: a seconda del telefono, l’audio può essere elaborato dai server di Google (Chrome/Android) o di Apple (Safari/iPhone). Su iPhone, con l’app installata, l’audio può passare dai nostri server solo per essere trascritto: non viene conservato. Se preferisci, scrivi la frase a mano.'],
  ['I miei dati dove stanno?', 'Hai due modi di usare l’app. Senza account i dati (clienti, listino, documenti) restano solo sul tuo telefono e noi non li vediamo. Con l’account, facoltativo, vengono sincronizzati sui nostri server nell’Unione Europea per ritrovarli su più dispositivi; per i dati dei tuoi clienti siamo tuoi responsabili del trattamento. Le fatture emesse devono essere conservate secondo legge: l’app non è un sistema di conservazione a norma, verifica con il tuo commercialista. Dettagli nell’informativa privacy.'],
  ['Cosa succede se cambio telefono?', 'Con l’account ritrovi tutto accedendo dal telefono nuovo. Senza account i dati stanno solo sul telefono, quindi fai un backup: dall’app esporti un file e lo rimetti sul telefono nuovo. Ti conviene farlo ogni tanto, anche prima di cancellare i dati del browser.'],
  ['Posso importare il mio listino?', 'Sì: lo carichi da file CSV o lo inserisci voce per voce, con prezzi e unità di misura tuoi.'],
] as const;

export default function LandingPage() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = PAGE_TITLE;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const created = !meta;
    const prevDesc = meta?.content ?? '';
    if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.appendChild(meta); }
    meta.content = PAGE_DESC;
    return () => {
      document.title = prevTitle;
      if (created) meta?.remove(); else if (meta) meta.content = prevDesc;
    };
  }, []);

  return (
    <div className="lp">
      <header className="lp-wrap lp-top">
        <a className="lp-brand" href="#/info">Voce<span>Preventivo</span></a>
        <a className="lp-btn lp-btn--sm" href="#/">Prova gratis</a>
      </header>

      <main>
        <section className="lp-wrap lp-hero">
          <div className="lp-hero-grid">
            <div>
              <Badge tone="info">Per idraulici, elettricisti, imbianchini, serramentisti e piccole imprese edili</Badge>
              <h1 style={{ marginTop: 14 }}>Detti il lavoro. Il preventivo è pronto.</h1>
              <p className="lp-lead">Racconti a voce cosa hai fatto o cosa devi fare. VocePreventivo trova le voci nel tuo listino, calcola i totali e ti dà il PDF da mandare al cliente. Mentre sei ancora sul posto.</p>
              <div className="lp-cta-row">
                <a className="lp-btn" href="#/">Prova gratis</a>
                <a className="lp-btn lp-btn--ghost" href="#installa">Installa sul telefono</a>
              </div>
              <p className="lp-note">Gratis fino a {FREE_DOCS_PER_MONTH} documenti al mese. Senza registrazione, senza carta.</p>
            </div>
            <Demo />
          </div>
        </section>

        <section className="lp-section lp-section--alt">
          <div className="lp-wrap">
            <h2>Meno tempo sul preventivo, più tempo sul lavoro</h2>
            <div className="lp-grid lp-grid--3">
              <Card className="lp-card"><div className="lp-ico" aria-hidden="true">⚡</div><h3>Veloce in cantiere</h3><p>Niente tastiera con le mani sporche. Parli, controlli la scheda, correggi una riga se serve. Un preventivo in un minuto, non la sera a casa.</p></Card>
              <Card className="lp-card"><div className="lp-ico" aria-hidden="true">📒</div><h3>Il tuo listino sempre con te</h3><p>I prezzi sono i tuoi, non quelli di un catalogo generico. Materiali, manodopera, uscite: l’app cerca nel tuo magazzino e non inventa nulla. Le voci che non trova te le segna da controllare.</p></Card>
              <Card className="lp-card"><div className="lp-ico" aria-hidden="true">📄</div><h3>PDF professionale in un tocco</h3><p>Con il tuo nome, la tua partita IVA e i tuoi dati. Lo condividi su WhatsApp o per email direttamente dal telefono.</p></Card>
              <Card className="lp-card"><div className="lp-ico" aria-hidden="true">🧾</div><h3>Fatture e note di credito</h3><p>Dal preventivo alla fattura in un passaggio. Se hai sbagliato, la nota di credito collegata annulla la fattura senza modificarla.</p></Card>
              <Card className="lp-card"><div className="lp-ico" aria-hidden="true">🗂️</div><h3>XML per lo SDI</h3><p>Per i forfettari genera il file XML della fattura elettronica. Lo carichi tu sul portale gratuito dell’Agenzia delle Entrate o lo invii via PEC.</p></Card>
              <Card className="lp-card"><div className="lp-ico" aria-hidden="true">🗣️</div><h3>Comandi vocali</h3><p>Oltre a dettare le righe, usi la voce per i passaggi comuni. Per le azioni che non si annullano, come emettere una fattura, serve sempre una conferma esplicita.</p></Card>
              <Card className="lp-card"><div className="lp-ico" aria-hidden="true">📶</div><h3>Funziona offline</h3><p>Listino, documenti e PDF anche in cantiere senza campo. Si sincronizza quando torna la rete, se hai un account.</p></Card>
              <Card className="lp-card"><div className="lp-ico" aria-hidden="true">🔓</div><h3>Account facoltativo</h3><p>Puoi usarla senza registrarti, con i dati solo sul telefono. Se vuoi più dispositivi e un archivio al sicuro, crei un account.</p></Card>
            </div>
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-wrap">
            <h2>Come funziona</h2>
            <ol className="lp-steps">
              <li><div><h3>Detta</h3><p>Premi il microfono e di’ il lavoro, anche in modo spiccio: “tre punti luce, venti metri di cavo, due ore di manodopera”.</p></div></li>
              <li><div><h3>Controlla</h3><p>Compare la scheda con voci, quantità e totale. Cambi quello che non ti torna con un tocco.</p></div></li>
              <li><div><h3>Manda il PDF</h3><p>Scegli preventivo, fattura o nota di credito. Genera il PDF per il cliente e, per le fatture, scarichi l’XML da caricare sul portale dell’Agenzia delle Entrate.</p></div></li>
            </ol>
          </div>
        </section>

        <section className="lp-section lp-section--alt">
          <div className="lp-wrap lp-privacy">
            <h2>Scegli dove stanno i tuoi dati</h2>
            <p><strong>Senza account:</strong> clienti, prezzi e documenti sono salvati solo sul tuo dispositivo. Noi non li vediamo e non possiamo ripristinarli: il backup è tuo.</p>
            <p><strong>Con l’account (facoltativo):</strong> i dati sono sincronizzati sui nostri server nell’Unione Europea, così li ritrovi su ogni dispositivo. Per i dati dei tuoi clienti noi siamo responsabili del trattamento e tu il titolare.</p>
            <ul>
              <li>Niente pubblicità, niente tracciamenti di terze parti.</li>
              <li>Esporti i tuoi dati quando vuoi.</li>
              <li>Eccezione: la dettatura può passare dal tuo browser (Google/Apple) o, su iPhone, dai nostri server solo per la trascrizione, senza conservare l’audio.</li>
            </ul>
            <p style={{ marginTop: 12 }}><a href={LEGAL('privacy')}>Informativa privacy</a> · <a href={LEGAL('termini')}>Termini di servizio</a> · <a href={LEGAL('dpa')}>Accordo sul trattamento dati (DPA)</a> · <a href={LEGAL('subprocessors')}>Sub-responsabili</a> · <a href={LEGAL('cookie')}>Cookie</a></p>
          </div>
        </section>

        <section className="lp-section" id="prezzi">
          <div className="lp-wrap">
            <h2>Prezzi chiari</h2>
            <div className="lp-grid lp-grid--2">
              <Card className="lp-card lp-plan">
                <h3>Gratis</h3>
                <div className="lp-price">0 €</div>
                <ul>
                  <li>{FREE_DOCS_PER_MONTH} documenti al mese</li>
                  <li>Listino e magazzino tuoi</li>
                  <li>Preventivi, fatture e note di credito</li>
                  <li>PDF e XML della fattura elettronica</li>
                  <li>Comandi vocali e uso offline</li>
                  <li>Account facoltativo, backup dei dati</li>
                </ul>
                <a className="lp-btn lp-btn--ghost" href="#/">Prova gratis</a>
              </Card>
              <Card className="lp-card lp-plan lp-plan--pro">
                <Badge tone="success">Il più scelto</Badge>
                <h3 style={{ marginTop: 8 }}>Pro</h3>
                <div className="lp-price">{eur(PRO_PRICE_MONTH)} <small>al mese</small></div>
                <p className="lp-muted">oppure {eur(PRO_PRICE_YEAR)} all’anno (due mesi in meno rispetto al mensile).</p>
                <ul>
                  <li>Documenti illimitati</li>
                  <li>Tutto quello che c’è nel Gratis</li>
                  <li>Sincronizzazione su più dispositivi con l’account</li>
                  <li>Disdici quando vuoi</li>
                </ul>
                <a className="lp-btn" href="#/">Inizia con il Gratis</a>
              </Card>
            </div>
            <p className="lp-note">Prezzi indicativi, IVA da definire prima del lancio. Il piano Pro si paga con carta tramite Stripe. L’app è uno strumento di supporto: la responsabilità fiscale resta tua, verifica con il tuo commercialista.</p>
          </div>
        </section>

        <section className="lp-section lp-section--alt" id="installa">
          <div className="lp-wrap lp-install">
            <h2>Installa sull’app</h2>
            <p>Non serve lo store: si aggiunge alla schermata Home e si apre come una normale app.</p>
            <div className="lp-grid lp-grid--2">
              <Card className="lp-card"><h3>Android (Chrome)</h3><ol><li>Apri VocePreventivo con Chrome.</li><li>Tocca i tre puntini in alto a destra.</li><li>Scegli “Installa app” o “Aggiungi a schermata Home”.</li></ol></Card>
              <Card className="lp-card"><h3>iPhone (Safari)</h3><ol><li>Apri VocePreventivo con Safari.</li><li>Tocca il tasto Condividi (il quadrato con la freccia).</li><li>Scegli “Aggiungi a Home”.</li></ol></Card>
            </div>
          </div>
        </section>

        <section className="lp-section lp-faq" id="faq">
          <div className="lp-wrap">
            <h2>Domande frequenti</h2>
            {FAQ.map(([q, a]) => (<details key={q}><summary>{q}</summary><p>{a}</p></details>))}
          </div>
        </section>

        <section className="lp-section lp-section--alt lp-final">
          <div className="lp-wrap">
            <h2>Il prossimo preventivo, fallo parlando</h2>
            <p className="lp-muted">Provalo sul prossimo lavoro. Se non ti fa risparmiare tempo, non hai perso niente.</p>
            <div className="lp-cta-row" style={{ justifyContent: 'center' }}>
              <a className="lp-btn" href="#/">Prova gratis</a>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-wrap lp-foot">
        <nav aria-label="Link legali">
          <a href={LEGAL('privacy')}>Privacy</a>
          <a href={LEGAL('termini')}>Termini</a>
          <a href={LEGAL('dpa')}>DPA</a>
          <a href={LEGAL('subprocessors')}>Sub-responsabili</a>
          <a href={LEGAL('cookie')}>Cookie</a>
          <a href="#/">Apri l’app</a>
        </nav>
        <p>VocePreventivo. Strumento di supporto: genera l’XML della fattura elettronica ma non lo trasmette allo SDI; la responsabilità fiscale resta dell’utente.</p>
      </footer>
    </div>
  );
}
