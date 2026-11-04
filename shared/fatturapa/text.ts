/**
 * Utilità testo per FatturaPA: pulizia caratteri, lunghezze, escape XML, spezzatura in blocchi.
 *
 * [DA VERIFICARE] Lo schema FatturaPA limita le stringhe ai caratteri "Basic Latin" + "Latin-1 Supplement"
 * (Allegato A / XSD, non scaricato in sessione). Tutto ciò che è fuori viene sostituito (vedi REPLACEMENTS)
 * e la sostituzione è segnalata da validateInvoiceForIssue (mai in silenzio).
 */

const REPLACEMENTS: Record<string, string> = {
  '‘': "'", '’': "'", '‚': ',', '‛': "'",
  '“': '"', '”': '"', '„': '"',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '−': '-',
  '…': '...', '€': 'EUR', '•': '-', '™': 'TM',
  'Œ': 'OE', 'œ': 'oe', 'Ł': 'L', 'ł': 'l', 'Đ': 'D', 'đ': 'd',
};

export interface Sanitized {
  text: string;
  /** true se almeno un carattere non ammesso è stato sostituito/rimosso (esclusa la normalizzazione degli spazi). */
  replaced: boolean;
}

const inAllowedRange = (cp: number): boolean => (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff);

const sanitizeChar = (ch: string): { out: string; replaced: boolean } => {
  const cp = ch.codePointAt(0) as number;
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return { out: ' ', replaced: false };
  if (inAllowedRange(cp)) return { out: ch, replaced: false };
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return { out: '', replaced: true }; // controllo: rimosso
  const mapped = REPLACEMENTS[ch];
  if (mapped !== undefined) return { out: mapped, replaced: true };
  const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (base !== ch && [...base].every((c) => inAllowedRange(c.codePointAt(0) as number))) {
    return { out: base, replaced: true };
  }
  return { out: '?', replaced: true };
};

/** Rende il testo compatibile con lo schema: caratteri ammessi, spazi collassati, niente a-capo. */
export const sanitizeText = (input: string): Sanitized => {
  let out = '';
  let replaced = false;
  for (const ch of String(input ?? '')) {
    const r = sanitizeChar(ch);
    out += r.out;
    replaced ||= r.replaced;
  }
  return { text: out.replace(/ {2,}/g, ' ').trim(), replaced };
};

export interface Fitted {
  value: string;
  truncated: boolean;
  replaced: boolean;
}

/** Pulisce e tronca a `max` caratteri. Chi chiama segnala `truncated`/`replaced` (validazione). */
export const fitText = (input: string, max: number): Fitted => {
  const { text, replaced } = sanitizeText(input);
  if (text.length <= max) return { value: text, truncated: false, replaced };
  return { value: text.slice(0, max).trimEnd(), truncated: true, replaced };
};

/** Escape XML dei 5 caratteri speciali (valido sia nei testi sia negli attributi). */
export const escapeXml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** Spezza un testo in blocchi di al massimo `max` caratteri, preferendo il confine di parola. */
export const chunkText = (input: string, max: number): string[] => {
  const text = sanitizeText(input).text;
  if (!text) return [];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(' ', max);
    if (cut <= 0) cut = max; // parola più lunga del blocco: taglio netto
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
};
