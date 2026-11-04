import { useEffect, useState } from 'react';
import { Button, Field, Input, Sheet } from '../../ui';
import type { Customer } from '../../types';
import { uid } from '../../types';
import { DuplicateCustomerError, saveCustomer, type StoredCustomer } from '../../storage/customers';
import { validateCustomer, type CustomerErrors } from './validate';

interface Props {
  open: boolean;
  customer: StoredCustomer | null; // null = nuovo
  onClose: () => void;
  onSaved: (c: StoredCustomer) => void;
  /** Duplicato trovato: la pagina propone l'unione. */
  onDuplicate: (existing: StoredCustomer, draft: Customer) => void;
}

const blank = (): Customer => ({ id: uid(), name: '', country: 'IT' });

/** Scheda cliente: dati fiscali completi con validazione (P.IVA/CF, CAP, provincia, codice destinatario, PEC, email). */
export default function CustomerSheet({ open, customer, onClose, onSaved, onDuplicate }: Props) {
  const [c, setC] = useState<Customer>(blank);
  const [errors, setErrors] = useState<CustomerErrors>({});
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState('');
  useEffect(() => { if (open) { setC(customer ? { ...customer } : blank()); setErrors({}); setFail(''); } }, [open, customer]);

  const set = (ch: Partial<Customer>) => { setC((cur) => ({ ...cur, ...ch })); setErrors((e) => { const n = { ...e }; for (const k of Object.keys(ch)) delete n[k as keyof CustomerErrors]; return n; }); };
  const text = (k: keyof Customer) => ({ value: (c[k] as string | undefined) ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => set({ [k]: e.target.value } as Partial<Customer>) });
  const bad = (k: keyof CustomerErrors) => ({ 'aria-invalid': errors[k] ? true : undefined, 'data-field': k }) as Record<string, unknown>;

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const err = validateCustomer(c);
    setErrors(err);
    if (Object.keys(err).length) { document.querySelector<HTMLElement>(`.sheet [data-field="${Object.keys(err)[0]}"]`)?.focus(); return; }
    setBusy(true); setFail('');
    try { onSaved(await saveCustomer(c)); }
    catch (e) {
      if (e instanceof DuplicateCustomerError) onDuplicate(e.existing, c);
      else setFail(e instanceof Error ? e.message : 'Salvataggio non riuscito.');
    } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} title={customer ? 'Scheda cliente' : 'Nuovo cliente'}>
      <form className="cat-col" onSubmit={submit} noValidate>
        <Field label="Nome o ragione sociale *" error={errors.name}><Input {...text('name')} {...bad('name')} autoComplete="off" data-autofocus /></Field>
        <div className="cat-grid2">
          <Field label="Partita IVA" error={errors.vatNumber}><Input {...text('vatNumber')} {...bad('vatNumber')} inputMode="numeric" autoComplete="off" /></Field>
          <Field label="Codice fiscale" error={errors.fiscalCode}><Input {...text('fiscalCode')} {...bad('fiscalCode')} autoCapitalize="characters" autoComplete="off" /></Field>
        </div>
        <Field label="Indirizzo"><Input {...text('address')} autoComplete="off" /></Field>
        <div className="cat-grid2">
          <Field label="CAP" error={errors.zip}><Input {...text('zip')} {...bad('zip')} inputMode="numeric" maxLength={10} autoComplete="off" /></Field>
          <Field label="Provincia" error={errors.province}><Input {...text('province')} {...bad('province')} maxLength={2} autoCapitalize="characters" autoComplete="off" /></Field>
        </div>
        <div className="cat-grid2">
          <Field label="Comune"><Input {...text('city')} autoComplete="off" /></Field>
          <Field label="Paese (sigla)" error={errors.country}><Input {...text('country')} {...bad('country')} maxLength={2} autoCapitalize="characters" autoComplete="off" /></Field>
        </div>
        <Field label="Codice destinatario (SDI)" error={errors.codiceDestinatario} hint="7 caratteri. Se non lo conosci lascia vuoto o scrivi 0000000.">
          <Input {...text('codiceDestinatario')} {...bad('codiceDestinatario')} maxLength={7} autoCapitalize="characters" autoComplete="off" />
        </Field>
        <Field label="PEC" error={errors.pec}><Input {...text('pec')} {...bad('pec')} type="email" inputMode="email" autoComplete="off" /></Field>
        <div className="cat-grid2">
          <Field label="Email" error={errors.email}><Input {...text('email')} {...bad('email')} type="email" inputMode="email" autoComplete="off" /></Field>
          <Field label="Telefono"><Input {...text('phone')} type="tel" inputMode="tel" autoComplete="off" /></Field>
        </div>
        {fail && <p className="cat-error" role="alert">{fail}</p>}
        <div className="cat-row cat-row--end">
          <Button type="submit" className="cat-submit" disabled={busy}>{busy ? 'Salvo…' : 'Salva cliente'}</Button>
          <Button type="button" variant="secondary" onClick={onClose}>Annulla</Button>
        </div>
      </form>
    </Sheet>
  );
}
