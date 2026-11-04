import { useRef, useState } from 'react';
import { Button } from '../../ui';
import { resizeImageToDataUrl } from './validators';
import { s } from '../catalog/styles';

export default function LogoField({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState('');
  const pick = async (f?: File) => {
    if (!f) return;
    setErr('');
    if (!f.type.startsWith('image/')) { setErr('Scegli un file immagine (PNG o JPG)'); return; }
    try { onChange(await resizeImageToDataUrl(f, 400)); } catch { setErr('Impossibile leggere questa immagine'); }
  };
  return (
    <div style={s.col}>
      <span style={{ fontWeight: 600 }}>Logo</span>
      <div style={s.row}>
        {value ? (
          <img src={value} alt="Anteprima del logo" style={{ maxWidth: 120, maxHeight: 80, objectFit: 'contain', border: '1px solid var(--border, #d0d5dd)', borderRadius: 8, background: '#fff', padding: 4 }} />
        ) : (
          <span style={s.muted}>Nessun logo caricato</span>
        )}
      </div>
      <div style={s.row}>
        <input ref={ref} type="file" accept="image/*" hidden aria-label="Carica logo" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
        <Button type="button" variant="secondary" onClick={() => ref.current?.click()}>{value ? 'Cambia logo' : 'Carica logo'}</Button>
        {value && <Button type="button" variant="ghost" onClick={() => onChange(undefined)}>Rimuovi</Button>}
      </div>
      <span style={s.muted}>Viene ridimensionato a 400 px e compare nei PDF.</span>
      {err && <span role="alert" style={s.error}>{err}</span>}
    </div>
  );
}
