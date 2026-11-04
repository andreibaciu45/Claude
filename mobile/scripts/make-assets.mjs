// Deriva icone e splash da ../public/icon.svg  ->  mobile/assets/*.png (poi `capacitor-assets generate`).
import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';
const svg = readFileSync('../public/icon.svg');
const BG = '#0b5c6b';
mkdirSync('assets', { recursive: true });
const icon = (size) => sharp(svg, { density: 384 }).resize(size, size);
// icona piena (iOS) 1024: l'SVG ha già gli angoli arrotondati -> per iOS usiamo sfondo pieno, senza trasparenza
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: BG } })
  .composite([{ input: await icon(1024).png().toBuffer() }]).flatten({ background: BG }).png().toFile('assets/icon-only.png');
// Android adattiva: sfondo a tinta unita + primo piano nella zona sicura (66%)
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: BG } }).png().toFile('assets/icon-background.png');
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: await icon(676).png().toBuffer(), gravity: 'center' }]).png().toFile('assets/icon-foreground.png');
// splash 2732x2732: logo centrale su tinta unita
for (const [name, bg] of [['splash', '#0f172a'], ['splash-dark', '#0f172a']]) {
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: bg } })
    .composite([{ input: await icon(720).png().toBuffer(), gravity: 'center' }]).png().toFile(`assets/${name}.png`);
}
console.log('assets/ generati');
