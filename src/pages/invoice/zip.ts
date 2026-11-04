/**
 * Writer ZIP "store" (nessuna compressione) in TypeScript puro, senza dipendenze: per scaricare tutti gli XML delle fatture in un solo file.
 * Formato: local file header + dati per ogni file, central directory, end of central directory (PKWARE APPNOTE 6.3.x, senza ZIP64).
 * I nomi sono UTF-8 (flag 0x0800). Limiti: massimo 65.535 file e 4 GiB totali (oltre: errore, non file corrotto).
 */

let CRC_TABLE: Uint32Array | null = null;
const crcTable = (): Uint32Array => {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return (CRC_TABLE = t);
};

/** CRC-32 (IEEE 802.3, lo stesso di zip/gzip/PNG). crc32("123456789") = 0xCBF43926. */
export function crc32(data: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Nome nel file, con '/' come separatore. Senza '/' iniziale né '..'. */
  name: string;
  data: Uint8Array | string;
}

const enc = new TextEncoder();

/** Ora/data DOS (anni 1980-2107, risoluzione 2 secondi), nel fuso locale. */
function dosDateTime(d: Date): { time: number; date: number } {
  const y = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Nome sicuro per un file nello zip: niente percorsi assoluti, '..', caratteri di controllo né backslash. */
export function safeZipName(name: string): string {
  const cleaned = name.replace(/\\/g, '/').split('/').map((p) => p.replace(/^[A-Za-z]:/, '')).filter((p) => p && p !== '.' && p !== '..').join('/')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '_');
  return cleaned || 'file';
}

/** Costruisce lo zip (store). `when` = data di modifica scritta nei file (default: adesso). */
export function createZip(entries: ZipEntry[], when: Date = new Date()): Uint8Array {
  if (entries.length > 0xffff) throw new Error('Troppi file per un archivio ZIP (massimo 65.535).');
  const { time, date } = dosDateTime(when);
  const used = new Set<string>();
  const prepared = entries.map((e) => {
    let name = safeZipName(e.name);
    // nomi duplicati: aggiunge -2, -3... prima dell'estensione (mai due file con lo stesso nome)
    if (used.has(name)) {
      const dot = name.lastIndexOf('.');
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      let n = 2;
      while (used.has(`${base}-${n}${ext}`)) n++;
      name = `${base}-${n}${ext}`;
    }
    used.add(name);
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    return { nameBytes: enc.encode(name), data, crc: crc32(data) };
  });

  let total = 22;
  for (const p of prepared) total += 30 + p.nameBytes.length + p.data.length + 46 + p.nameBytes.length;
  if (total > 0xffffffff) throw new Error('Archivio ZIP troppo grande (oltre 4 GB).');

  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  let o = 0;
  const offsets: number[] = [];
  for (const p of prepared) {
    offsets.push(o);
    v.setUint32(o, 0x04034b50, true); // local file header
    v.setUint16(o + 4, 20, true); // versione necessaria
    v.setUint16(o + 6, 0x0800, true); // nomi UTF-8
    v.setUint16(o + 8, 0, true); // metodo 0 = store
    v.setUint16(o + 10, time, true);
    v.setUint16(o + 12, date, true);
    v.setUint32(o + 14, p.crc, true);
    v.setUint32(o + 18, p.data.length, true);
    v.setUint32(o + 22, p.data.length, true);
    v.setUint16(o + 26, p.nameBytes.length, true);
    v.setUint16(o + 28, 0, true); // extra
    out.set(p.nameBytes, o + 30);
    out.set(p.data, o + 30 + p.nameBytes.length);
    o += 30 + p.nameBytes.length + p.data.length;
  }
  const cdStart = o;
  prepared.forEach((p, i) => {
    v.setUint32(o, 0x02014b50, true); // central directory header
    v.setUint16(o + 4, 20, true); // versione creatore
    v.setUint16(o + 6, 20, true); // versione necessaria
    v.setUint16(o + 8, 0x0800, true);
    v.setUint16(o + 10, 0, true);
    v.setUint16(o + 12, time, true);
    v.setUint16(o + 14, date, true);
    v.setUint32(o + 16, p.crc, true);
    v.setUint32(o + 20, p.data.length, true);
    v.setUint32(o + 24, p.data.length, true);
    v.setUint16(o + 28, p.nameBytes.length, true);
    v.setUint16(o + 30, 0, true); // extra
    v.setUint16(o + 32, 0, true); // commento
    v.setUint16(o + 34, 0, true); // disco
    v.setUint16(o + 36, 0, true); // attributi interni
    v.setUint32(o + 38, 0, true); // attributi esterni
    v.setUint32(o + 42, offsets[i], true);
    out.set(p.nameBytes, o + 46);
    o += 46 + p.nameBytes.length;
  });
  v.setUint32(o, 0x06054b50, true); // end of central directory
  v.setUint16(o + 4, 0, true);
  v.setUint16(o + 6, 0, true);
  v.setUint16(o + 8, prepared.length, true);
  v.setUint16(o + 10, prepared.length, true);
  v.setUint32(o + 12, o - cdStart, true);
  v.setUint32(o + 16, cdStart, true);
  v.setUint16(o + 20, 0, true);
  return out;
}

/** Lettore minimale per i test e per verifiche interne: elenca i file di uno zip "store" creato da `createZip`. */
export function readZipStore(zip: Uint8Array): { name: string; data: Uint8Array; crc: number }[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = zip.length - 22;
  while (eocd >= 0 && v.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('ZIP non valido: manca la directory finale.');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files: { name: string; data: Uint8Array; crc: number }[] = [];
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP non valido: directory centrale danneggiata.');
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    if (method !== 0) throw new Error('ZIP non supportato: solo "store".');
    const name = dec.decode(zip.subarray(p + 46, p + 46 + nameLen));
    const dataStart = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    files.push({ name, data: zip.slice(dataStart, dataStart + size), crc });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}
