/**
 * Strumenti SOLO per i test: parser XML minimale (well-formedness + albero) e validatore strutturale
 * (ordine degli elementi e presenza degli obbligatori) basato su docs/FISCAL-SPEC.md §2.2 [DA VERIFICARE sull'XSD].
 */
export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const decode = (s: string): string =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });

/** Parser rigoroso: lancia su tag non chiusi/incrociati, '&' non escapato, '<' nel testo. */
export const parseXml = (xml: string): XmlNode => {
  if (xml.charCodeAt(0) === 0xfeff) throw new Error('BOM non ammesso');
  let i = 0;
  if (xml.startsWith('<?xml')) i = xml.indexOf('?>') + 2;
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  const tagRe = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/y;
  while (i < xml.length) {
    if (xml[i] === '<') {
      tagRe.lastIndex = i;
      const m = tagRe.exec(xml);
      if (!m) throw new Error(`Tag malformato alla posizione ${i}: ${xml.slice(i, i + 40)}`);
      const [all, closing, name, attrStr, selfClose] = m;
      if (closing) {
        const top = stack.pop() as XmlNode;
        if (top.name !== name) throw new Error(`Tag chiuso male: atteso </${top.name}>, trovato </${name}>`);
      } else {
        const attrs: Record<string, string> = {};
        for (const a of attrStr.matchAll(/([\w:.-]+)="([^"]*)"/g)) attrs[a[1]] = decode(a[2]);
        const node: XmlNode = { name, attrs, children: [], text: '' };
        stack[stack.length - 1].children.push(node);
        if (!selfClose) stack.push(node);
      }
      i += all.length;
    } else {
      const next = xml.indexOf('<', i);
      const raw = xml.slice(i, next === -1 ? xml.length : next);
      if (/&(?!(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);)/.test(raw)) throw new Error('Carattere & non escapato');
      if (raw.trim()) {
        if (stack.length === 1) throw new Error('Testo fuori dall\'elemento radice');
        stack[stack.length - 1].text += decode(raw);
      }
      i = next === -1 ? xml.length : next;
    }
  }
  if (stack.length !== 1) throw new Error(`Tag non chiuso: ${stack[stack.length - 1].name}`);
  if (root.children.length !== 1) throw new Error('Deve esistere un solo elemento radice');
  return root.children[0];
};

/** Proietta l'albero in una forma confrontabile (senza testo spurio negli elementi con figli). */
export const toPlain = (n: XmlNode): unknown =>
  n.children.length ? { [n.name]: n.children.map(toPlain) } : { [n.name]: n.text };

// ---- validatore strutturale -----------------------------------------------------------------

interface Rule {
  order: string[];
  required: string[];
}

const RULES: Record<string, Rule> = {
  FatturaElettronica: { order: ['FatturaElettronicaHeader', 'FatturaElettronicaBody'], required: ['FatturaElettronicaHeader', 'FatturaElettronicaBody'] },
  FatturaElettronicaHeader: {
    order: ['DatiTrasmissione', 'CedentePrestatore', 'RappresentanteFiscale', 'CessionarioCommittente'],
    required: ['DatiTrasmissione', 'CedentePrestatore', 'CessionarioCommittente'],
  },
  DatiTrasmissione: {
    order: ['IdTrasmittente', 'ProgressivoInvio', 'FormatoTrasmissione', 'CodiceDestinatario', 'ContattiTrasmittente', 'PECDestinatario'],
    required: ['IdTrasmittente', 'ProgressivoInvio', 'FormatoTrasmissione', 'CodiceDestinatario'],
  },
  IdTrasmittente: { order: ['IdPaese', 'IdCodice'], required: ['IdPaese', 'IdCodice'] },
  IdFiscaleIVA: { order: ['IdPaese', 'IdCodice'], required: ['IdPaese', 'IdCodice'] },
  CedentePrestatore: { order: ['DatiAnagrafici', 'Sede', 'StabileOrganizzazione', 'IscrizioneREA', 'Contatti', 'RiferimentoAmministrazione'], required: ['DatiAnagrafici', 'Sede'] },
  'CedentePrestatore/DatiAnagrafici': {
    order: ['IdFiscaleIVA', 'CodiceFiscale', 'Anagrafica', 'AlboProfessionale', 'ProvinciaAlbo', 'NumeroIscrizioneAlbo', 'DataIscrizioneAlbo', 'RegimeFiscale'],
    required: ['IdFiscaleIVA', 'Anagrafica', 'RegimeFiscale'],
  },
  'CessionarioCommittente/DatiAnagrafici': { order: ['IdFiscaleIVA', 'CodiceFiscale', 'Anagrafica'], required: ['Anagrafica'] },
  CessionarioCommittente: { order: ['DatiAnagrafici', 'Sede', 'StabileOrganizzazione', 'RappresentanteFiscale'], required: ['DatiAnagrafici', 'Sede'] },
  Anagrafica: { order: ['Denominazione', 'Nome', 'Cognome', 'Titolo', 'CodEORI'], required: [] },
  Sede: { order: ['Indirizzo', 'NumeroCivico', 'CAP', 'Comune', 'Provincia', 'Nazione'], required: ['Indirizzo', 'CAP', 'Comune', 'Nazione'] },
  IscrizioneREA: { order: ['Ufficio', 'NumeroREA', 'CapitaleSociale', 'SocioUnico', 'StatoLiquidazione'], required: ['NumeroREA', 'StatoLiquidazione'] },
  Contatti: { order: ['Telefono', 'Fax', 'Email'], required: [] },
  FatturaElettronicaBody: { order: ['DatiGenerali', 'DatiBeniServizi', 'DatiVeicoli', 'DatiPagamento', 'Allegati'], required: ['DatiGenerali', 'DatiBeniServizi'] },
  DatiGenerali: {
    order: ['DatiGeneraliDocumento', 'DatiOrdineAcquisto', 'DatiContratto', 'DatiConvenzione', 'DatiRicezione', 'DatiFattureCollegate', 'DatiSAL', 'DatiDDT', 'DatiTrasporto', 'FatturaPrincipale'],
    required: ['DatiGeneraliDocumento'],
  },
  DatiGeneraliDocumento: {
    order: ['TipoDocumento', 'Divisa', 'Data', 'Numero', 'DatiRitenuta', 'DatiBollo', 'DatiCassaPrevidenziale', 'ScontoMaggiorazione', 'ImportoTotaleDocumento', 'Arrotondamento', 'Causale', 'Art73'],
    required: ['TipoDocumento', 'Divisa', 'Data', 'Numero'],
  },
  DatiBollo: { order: ['BolloVirtuale', 'ImportoBollo'], required: ['BolloVirtuale'] },
  DatiFattureCollegate: { order: ['RiferimentoNumeroLinea', 'IdDocumento', 'Data', 'NumItem', 'CodiceCommessaConvenzione', 'CodiceCUP', 'CodiceCIG'], required: ['IdDocumento'] },
  DatiBeniServizi: { order: ['DettaglioLinee', 'DatiRiepilogo'], required: ['DettaglioLinee', 'DatiRiepilogo'] },
  DettaglioLinee: {
    order: ['NumeroLinea', 'TipoCessionePrestazione', 'CodiceArticolo', 'Descrizione', 'Quantita', 'UnitaMisura', 'DataInizioPeriodo', 'DataFinePeriodo', 'PrezzoUnitario', 'ScontoMaggiorazione', 'PrezzoTotale', 'AliquotaIVA', 'Ritenuta', 'Natura', 'RiferimentoAmministrazione', 'AltriDatiGestionali'],
    required: ['NumeroLinea', 'Descrizione', 'PrezzoUnitario', 'PrezzoTotale', 'AliquotaIVA'],
  },
  ScontoMaggiorazione: { order: ['Tipo', 'Percentuale', 'Importo'], required: ['Tipo'] },
  DatiRiepilogo: {
    order: ['AliquotaIVA', 'Natura', 'SpeseAccessorie', 'Arrotondamento', 'ImponibileImporto', 'Imposta', 'EsigibilitaIVA', 'RiferimentoNormativo'],
    required: ['AliquotaIVA', 'ImponibileImporto', 'Imposta'],
  },
  DatiPagamento: { order: ['CondizioniPagamento', 'DettaglioPagamento'], required: ['CondizioniPagamento', 'DettaglioPagamento'] },
  DettaglioPagamento: {
    order: ['Beneficiario', 'ModalitaPagamento', 'DataRiferimentoTerminiPagamento', 'GiorniTerminiPagamento', 'DataScadenzaPagamento', 'ImportoPagamento', 'CodUfficioPostale', 'CognomeQuietanzante', 'NomeQuietanzante', 'CFQuietanzante', 'TitoloQuietanzante', 'IstitutoFinanziario', 'IBAN', 'ABI', 'CAB', 'BIC'],
    required: ['ModalitaPagamento', 'ImportoPagamento'],
  },
};

const ruleFor = (path: string[]): Rule | undefined => {
  const name = path[path.length - 1];
  const parent = path[path.length - 2];
  return RULES[`${parent}/${name}`] ?? RULES[name];
};

/** Restituisce l'elenco dei problemi strutturali (vuoto = ok). */
export const validateStructure = (root: XmlNode): string[] => {
  const problems: string[] = [];
  const visit = (n: XmlNode, path: string[]): void => {
    const here = [...path, n.name];
    const rule = n.children.length ? ruleFor(here) : undefined;
    if (rule) {
      let last = -1;
      for (const c of n.children) {
        const idx = rule.order.indexOf(c.name);
        if (idx === -1) problems.push(`${here.join('/')}: elemento non previsto <${c.name}>`);
        else if (idx < last) problems.push(`${here.join('/')}: <${c.name}> fuori ordine`);
        else last = idx;
      }
      for (const r of rule.required) {
        if (!n.children.some((c) => c.name === r)) problems.push(`${here.join('/')}: manca <${r}> obbligatorio`);
      }
    }
    n.children.forEach((c) => visit(c, here));
  };
  const rootName = root.name.replace(/^.*:/, '');
  if (rootName !== 'FatturaElettronica') problems.push(`radice inattesa: ${root.name}`);
  if (root.attrs.versione !== 'FPR12') problems.push('attributo versione diverso da FPR12');
  visit({ ...root, name: rootName }, []);
  return problems;
};

export const find = (n: XmlNode, name: string): XmlNode[] => {
  const out: XmlNode[] = [];
  const walk = (x: XmlNode): void => {
    if (x.name === name) out.push(x);
    x.children.forEach(walk);
  };
  walk(n);
  return out;
};

export const textOf = (n: XmlNode, name: string): string | undefined => find(n, name)[0]?.text;
