import { useEffect, useState } from 'react';
import { Button, Card, Field, Input, PageHeader, Select, Textarea, useToast } from '../ui';
import { getProfile, saveProfile } from '../storage';
import type { Profile } from '../types';
import LogoField from './profile/LogoField';
import { formatIban, isEmail, isValidFiscalCode, isValidIban, isValidVat } from './profile/validators';
import { s } from './catalog/styles';

type Errors = Partial<Record<keyof Profile, string>>;

function validate(p: Profile): Errors {
  const e: Errors = {};
  if (!p.businessName.trim()) e.businessName = 'Inserisci la ragione sociale';
  if (!p.vatNumber.trim()) e.vatNumber = 'Inserisci la partita IVA';
  else if (!isValidVat(p.vatNumber)) e.vatNumber = 'Partita IVA non valida: servono 11 cifre corrette';
  if (p.fiscalCode?.trim() && !isValidFiscalCode(p.fiscalCode)) e.fiscalCode = 'Codice fiscale non valido';
  if (p.zip.trim() && !/^\d{5}$/.test(p.zip.trim())) e.zip = 'Il CAP ha 5 cifre';
  if (p.province.trim() && !/^[A-Za-z]{2}$/.test(p.province.trim())) e.province = 'Sigla di 2 lettere (es. MI)';
  if (p.email.trim() && !isEmail(p.email.trim())) e.email = 'Email non valida';
  if (p.pec?.trim() && !isEmail(p.pec.trim())) e.pec = 'PEC non valida';
  if (p.iban?.trim() && !isValidIban(p.iban)) e.iban = 'IBAN non valido: controlla i caratteri';
  if (!(p.defaultVat >= 0 && p.defaultVat <= 100)) e.defaultVat = 'Aliquota non valida';
  if (!Number.isInteger(p.nextQuoteNumber) || p.nextQuoteNumber < 1) e.nextQuoteNumber = 'Numero intero da 1';
  if (!Number.isInteger(p.nextInvoiceNumber) || p.nextInvoiceNumber < 1) e.nextInvoiceNumber = 'Numero intero da 1';
  if (!Number.isInteger(p.quoteValidityDays) || p.quoteValidityDays < 1) e.quoteValidityDays = 'Almeno 1 giorno';
  return e;
}

const num = (v: string) => (v.trim() === '' ? NaN : Number(v.replace(',', '.')));

export default function ProfilePage() {
  const toast = useToast();
  const [p, setP] = useState<Profile | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { getProfile().then(setP).catch(() => toast('Impossibile leggere i dati azienda')); }, [toast]);

  if (!p) return <div><PageHeader title="Dati azienda" /><p style={{ ...s.muted, padding: 16 }}>Caricamento…</p></div>;

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => {
    setP((cur) => (cur ? { ...cur, [k]: v } : cur));
    setDirty(true);
    setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const text = (k: keyof Profile) => ({
    value: (p[k] as string | undefined) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, e.target.value as never),
  });
  const blur = (k: keyof Profile) => () => setErrors((e) => ({ ...e, [k]: validate(p)[k] }));

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const clean: Profile = {
      ...p,
      businessName: p.businessName.trim(),
      vatNumber: p.vatNumber.replace(/\s/g, '').replace(/^IT/i, ''),
      province: p.province.trim().toUpperCase(),
      iban: p.iban ? formatIban(p.iban) : '',
      fiscalCode: p.fiscalCode?.replace(/\s/g, '').toUpperCase(),
    };
    const err = validate(clean);
    setErrors(err);
    if (Object.keys(err).length) {
      toast('Controlla i campi evidenziati');
      const first = Object.keys(err)[0];
      document.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
      return;
    }
    setSaving(true);
    try {
      // il contatore può essere avanzato nel frattempo: non lo sovrascrivo se l'utente non l'ha toccato
      await saveProfile(clean);
      setP(clean);
      setDirty(false);
      toast('Dati azienda salvati');
    } catch { toast('Salvataggio non riuscito'); } finally { setSaving(false); }
  };

  const fd = (k: keyof Profile) => ({ 'data-field': k, 'aria-invalid': errors[k] ? true : undefined }) as Record<string, unknown>;

  return (
    <div>
      <PageHeader title="Dati azienda" subtitle="Compaiono nell'intestazione di preventivi e fatture" />
      <form onSubmit={submit} style={s.page} noValidate>
        <Card>
          <div style={{ ...s.col, padding: 12 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Azienda</h2>
            <Field label="Ragione sociale *" error={errors.businessName}>
              <Input {...text('businessName')} {...fd('businessName')} onBlur={blur('businessName')} autoComplete="organization" />
            </Field>
            <Field label="Titolare / referente">
              <Input {...text('ownerName')} autoComplete="name" />
            </Field>
            <div style={s.grid2}>
              <Field label="Partita IVA *" error={errors.vatNumber}>
                <Input {...text('vatNumber')} {...fd('vatNumber')} onBlur={blur('vatNumber')} inputMode="numeric" placeholder="11 cifre" autoComplete="off" />
              </Field>
              <Field label="Codice fiscale" error={errors.fiscalCode}>
                <Input {...text('fiscalCode')} {...fd('fiscalCode')} onBlur={blur('fiscalCode')} autoCapitalize="characters" autoComplete="off" />
              </Field>
            </div>
            <Field label="N. iscrizione Albo Artigiani" hint="Facoltativo, es. MI-1234567">
              <Input {...text('artigianiNumber')} autoComplete="off" />
            </Field>
            <LogoField value={p.logoDataUrl} onChange={(v) => set('logoDataUrl', v)} />
          </div>
        </Card>

        <Card>
          <div style={{ ...s.col, padding: 12 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Sede e contatti</h2>
            <Field label="Indirizzo"><Input {...text('address')} autoComplete="street-address" /></Field>
            <div style={s.grid2}>
              <Field label="CAP" error={errors.zip}><Input {...text('zip')} {...fd('zip')} onBlur={blur('zip')} inputMode="numeric" maxLength={5} autoComplete="postal-code" /></Field>
              <Field label="Provincia" error={errors.province}><Input {...text('province')} {...fd('province')} onBlur={blur('province')} maxLength={2} autoCapitalize="characters" /></Field>
            </div>
            <Field label="Comune"><Input {...text('city')} autoComplete="address-level2" /></Field>
            <Field label="Telefono"><Input {...text('phone')} type="tel" autoComplete="tel" /></Field>
            <Field label="Email" error={errors.email}><Input {...text('email')} {...fd('email')} onBlur={blur('email')} type="email" autoComplete="email" /></Field>
            <Field label="PEC" error={errors.pec}><Input {...text('pec')} {...fd('pec')} onBlur={blur('pec')} type="email" /></Field>
            <Field label="IBAN" error={errors.iban} hint="Per ricevere il bonifico: compare nei documenti">
              <Input {...text('iban')} {...fd('iban')} onBlur={() => { if (p.iban) set('iban', formatIban(p.iban)); setErrors((e) => ({ ...e, iban: validate({ ...p, iban: p.iban })['iban'] })); }} autoCapitalize="characters" autoComplete="off" />
            </Field>
          </div>
        </Card>

        <Card>
          <div style={{ ...s.col, padding: 12 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Fisco</h2>
            <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minHeight: 44 }}>
              <input type="checkbox" checked={p.regimeForfettario} onChange={(e) => set('regimeForfettario', e.target.checked)} style={{ width: 24, height: 24, marginTop: 2, flex: 'none' }} />
              <span>
                <strong>Regime forfettario</strong>
                <span style={{ ...s.muted, display: 'block' }}>Senza IVA in fattura; marca da bollo di 2 € sopra 77,47 €.</span>
              </span>
            </label>
            <Field label="Aliquota IVA di default" error={errors.defaultVat} hint={p.regimeForfettario ? 'Con il forfettario l’IVA non viene applicata ai documenti.' : undefined}>
              <Select value={String(p.defaultVat)} onChange={(e) => set('defaultVat', Number(e.target.value))} {...fd('defaultVat')}>
                {[...new Set([22, 10, 5, 4, 0, p.defaultVat])].sort((a, b) => b - a).map((r) => <option key={r} value={r}>{r}%</option>)}
              </Select>
            </Field>
          </div>
        </Card>

        <Card>
          <div style={{ ...s.col, padding: 12 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Documenti</h2>
            <div style={s.grid2}>
              <Field label="Prefisso preventivi"><Input {...text('quotePrefix')} autoComplete="off" /></Field>
              <Field label="Prossimo n. preventivo" error={errors.nextQuoteNumber}>
                <Input value={String(p.nextQuoteNumber)} onChange={(e) => set('nextQuoteNumber', num(e.target.value))} {...fd('nextQuoteNumber')} inputMode="numeric" />
              </Field>
              <Field label="Prefisso fatture"><Input {...text('invoicePrefix')} autoComplete="off" /></Field>
              <Field label="Prossimo n. fattura" error={errors.nextInvoiceNumber}>
                <Input value={String(p.nextInvoiceNumber)} onChange={(e) => set('nextInvoiceNumber', num(e.target.value))} {...fd('nextInvoiceNumber')} inputMode="numeric" />
              </Field>
            </div>
            <Field label="Validità preventivo (giorni)" error={errors.quoteValidityDays}>
              <Input value={String(p.quoteValidityDays)} onChange={(e) => set('quoteValidityDays', num(e.target.value))} {...fd('quoteValidityDays')} inputMode="numeric" />
            </Field>
            <Field label="Condizioni di pagamento"><Textarea rows={2} {...text('paymentTerms')} /></Field>
            <Field label="Note a piè di pagina" hint="Es. «Prezzi validi salvo imprevisti»"><Textarea rows={3} {...text('footerNotes')} /></Field>
          </div>
        </Card>

        <div style={{ position: 'sticky', bottom: 'calc(var(--tabbar-h, 64px) + 8px)', zIndex: 5 }}>
          <Button type="submit" size="lg" disabled={saving} style={{ width: '100%' }}>
            {saving ? 'Salvataggio…' : dirty ? 'Salva dati azienda' : 'Salvato'}
          </Button>
        </div>
      </form>
    </div>
  );
}
