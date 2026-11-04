import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createZip, crc32, readZipStore, safeZipName } from './zip';

const bytes = (s: string) => new TextEncoder().encode(s);
const has = (cmd: string, args: string[]): boolean => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch { return false; } };

describe('CRC32', () => {
  it('vettori noti', () => {
    expect(crc32(bytes(''))).toBe(0);
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
    expect(crc32(bytes('a'))).toBe(0xe8b7be43);
    expect(crc32(bytes('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
  it('byte non ASCII e buffer grandi', () => {
    expect(crc32(new Uint8Array([0, 255, 128, 1]))).toBe(crc32(new Uint8Array([0, 255, 128, 1])));
    const big = new Uint8Array(200_000).map((_, i) => i % 251);
    expect(crc32(big)).toBeGreaterThan(0);
  });
});

describe('createZip (store)', () => {
  const when = new Date(2026, 10, 4, 12, 30, 10);

  it('round-trip: nomi, contenuti (anche UTF-8) e CRC corretti', () => {
    const files = [
      { name: 'IT01234567897_00001.xml', data: '<?xml version="1.0"?><a>è €</a>' },
      { name: 'IT01234567897_00002.xml', data: bytes('<b/>') },
      { name: 'vuoto.txt', data: '' },
    ];
    const zip = createZip(files, when);
    const back = readZipStore(zip);
    expect(back.map((f) => f.name)).toEqual(files.map((f) => f.name));
    expect(new TextDecoder().decode(back[0].data)).toBe('<?xml version="1.0"?><a>è €</a>');
    expect(back[2].data.length).toBe(0);
    for (const f of back) expect(f.crc).toBe(crc32(f.data));
  });

  it('intestazioni: firma PK, metodo 0, data DOS, EOCD con il numero di file', () => {
    const zip = createZip([{ name: 'a.xml', data: '<a/>' }], when);
    const v = new DataView(zip.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint16(8, true)).toBe(0);
    expect(v.getUint16(10, true)).toBe((12 << 11) | (30 << 5) | 5); // 12:30:10
    expect(v.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (11 << 5) | 4); // 4 novembre 2026
    expect(v.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(v.getUint16(zip.length - 12, true)).toBe(1);
  });

  it('archivio vuoto valido', () => {
    const zip = createZip([], when);
    expect(zip.length).toBe(22);
    expect(readZipStore(zip)).toEqual([]);
  });

  it('nomi duplicati resi unici; nomi pericolosi ripuliti', () => {
    const zip = createZip([{ name: 'a.xml', data: '1' }, { name: 'a.xml', data: '2' }, { name: 'a.xml', data: '3' }, { name: '../../etc/passwd', data: 'x' }, { name: 'C:\\x\\y.xml', data: 'y' }], when);
    expect(readZipStore(zip).map((f) => f.name)).toEqual(['a.xml', 'a-2.xml', 'a-3.xml', 'etc/passwd', 'C:/x/y.xml']);
    expect(safeZipName('/abs/./x//y')).toBe('abs/x/y');
    expect(safeZipName('')).toBe('file');
  });

  it('i file sono memorizzati senza compressione (dimensione = somma dei contenuti + intestazioni)', () => {
    const data = 'x'.repeat(10_000);
    const zip = createZip([{ name: 'a.txt', data }], when);
    expect(zip.length).toBe(30 + 5 + 10_000 + 46 + 5 + 22);
  });

  (has('unzip', ['-v']) ? it : it.skip)('unzip -t (strumento esterno) accetta l\'archivio e verifica i CRC', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    const file = join(dir, 't.zip');
    writeFileSync(file, createZip([{ name: 'IT01234567897_00001.xml', data: '<a>è</a>' }, { name: 'IT01234567897_00002.xml', data: 'x'.repeat(70_000) }], when));
    expect(execFileSync('unzip', ['-t', file]).toString()).toMatch(/No errors detected/);
  });

  (has('python3', ['--version']) ? it : it.skip)('python zipfile legge l\'archivio e testzip() è pulito', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    const file = join(dir, 't.zip');
    writeFileSync(file, createZip([{ name: 'a.xml', data: '<a/>' }, { name: 'è.xml', data: 'ciao' }], when));
    const out = execFileSync('python3', ['-I', '-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip(),",".join(z.namelist()))', file]).toString().trim();
    expect(out).toBe('None a.xml,è.xml');
  });
});
