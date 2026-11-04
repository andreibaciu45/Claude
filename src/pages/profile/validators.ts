/** Partita IVA italiana: 11 cifre + checksum di Luhn modificato. */
export function isValidVat(v: string): boolean {
  const s = v.replace(/\s/g, '').replace(/^IT/i, '');
  if (!/^\d{11}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let d = Number(s[i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === Number(s[10]);
}

const ODD = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23];
/** Codice fiscale persona fisica (16 car.) con carattere di controllo, oppure numerico di 11 cifre (P.IVA valida). */
export function isValidFiscalCode(v: string): boolean {
  const s = v.replace(/\s/g, '').toUpperCase();
  if (/^\d{11}$/.test(s)) return isValidVat(s);
  if (!/^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const c = s[i];
    const val = /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 65;
    sum += i % 2 === 0 ? ODD[val] : val;
  }
  return String.fromCharCode(65 + (sum % 26)) === s[15];
}

/** IBAN: lunghezza per paese (IT = 27) e checksum mod 97. */
export function isValidIban(v: string): boolean {
  const s = v.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  if (s.startsWith('IT') && s.length !== 27) return false;
  const r = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of r) {
    const n = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of n) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

export const formatIban = (v: string) => v.replace(/\s/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

/** Ridimensiona un'immagine a max `max` px sul lato lungo e restituisce un dataURL (PNG se trasparente, altrimenti JPEG). */
export async function resizeImageToDataUrl(file: File, max = 400): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Immagine non leggibile'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas non disponibile');
    ctx.drawImage(img, 0, 0, w, h);
    const png = file.type === 'image/png' || file.type === 'image/svg+xml' || file.type === 'image/webp' || file.type === 'image/gif';
    return png ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}
