import { describe, expect, it } from 'vitest';
import { chunkText, escapeXml, fitText, sanitizeText } from './text';
import { parseXml } from './__tests__/xmlTools';

describe('escapeXml', () => {
  it('escapa & < > " \'', () => {
    expect(escapeXml(`a & b < c > d "e" 'f'`)).toBe('a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;');
  });
  it('round-trip tramite parser', () => {
    const raw = `Tubo "A" & <B> 'C' &amp; già`;
    const root = parseXml(`<a>${escapeXml(raw)}</a>`);
    expect(root.text).toBe(raw);
  });
});

describe('sanitizeText', () => {
  it('sostituisce caratteri tipografici e fuori Latin-1, segnalandolo', () => {
    const r = sanitizeText('“Ciao” – 5 € … ł');
    expect(r.text).toBe('"Ciao" - 5 EUR ... l');
    expect(r.replaced).toBe(true);
  });
  it('mantiene le lettere accentate Latin-1', () => {
    const r = sanitizeText('Perché è già così');
    expect(r.text).toBe('Perché è già così');
    expect(r.replaced).toBe(false);
  });
  it('toglie caratteri di controllo e normalizza a-capo/spazi', () => {
    const r = sanitizeText('a\u0000b\n\tc   d');
    expect(r.text).toBe('ab c d');
    expect(r.replaced).toBe(true);
  });
  it('emoji -> ?', () => {
    expect(sanitizeText('ok 😀').text).toBe('ok ?');
  });
});

describe('fitText / chunkText', () => {
  it('tronca e segnala', () => {
    const f = fitText('x'.repeat(30), 20);
    expect(f.value).toHaveLength(20);
    expect(f.truncated).toBe(true);
    expect(fitText('corto', 20).truncated).toBe(false);
  });
  it('spezza in blocchi <= max senza perdere testo', () => {
    const text = Array.from({ length: 80 }, (_, i) => `parola${i}`).join(' ');
    const chunks = chunkText(text, 200);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 200)).toBe(true);
    expect(chunks.join(' ')).toBe(text);
  });
  it('parola più lunga del blocco: taglio netto', () => {
    const chunks = chunkText('a'.repeat(450), 200);
    expect(chunks.map((c) => c.length)).toEqual([200, 200, 50]);
  });
  it('testo vuoto -> nessun blocco', () => {
    expect(chunkText('   ', 200)).toEqual([]);
  });
});
