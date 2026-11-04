import type { Customer } from '../../types';
import { Field, Input } from '../../ui';
import { isValidFiscalCode, isValidVat } from '../profile/validators';

/** Dati del cliente necessari alla fattura elettronica. Gli id `f-<campo>` servono ai link dei controlli pre-emissione. */
export function CustomerFiscalFields({ customer, onChange }: { customer: Customer; onChange: (c: Customer) => void }) {
  const set = (ch: Partial<Customer>) => onChange({ ...customer, ...ch });
  const vat = customer.vatNumber ?? '';
  const cf = customer.fiscalCode ?? '';
  const cd = customer.codiceDestinatario ?? '';
  return (
    <div className="stack-sm">
      <p className="muted qe-note">Per la fattura serve la Partita IVA (azienda) oppure il Codice fiscale (privato).</p>
      <div className="grid-2">
        <Field label="Partita IVA" error={vat && !isValidVat(vat) ? 'Partita IVA non valida (11 cifre).' : undefined}>
          <Input id="f-customer.vatNumber" inputMode="numeric" value={vat} onChange={(e) => set({ vatNumber: e.target.value.replace(/\s/g, '') })} autoComplete="off" />
        </Field>
        <Field label="Codice fiscale" error={cf && !isValidFiscalCode(cf) ? 'Codice fiscale non valido.' : undefined}>
          <Input id="f-customer.fiscalCode" value={cf} onChange={(e) => set({ fiscalCode: e.target.value.replace(/\s/g, '').toUpperCase() })} autoComplete="off" autoCapitalize="characters" />
        </Field>
      </div>
      <Field label="Indirizzo"><Input id="f-customer.address" value={customer.address ?? ''} onChange={(e) => set({ address: e.target.value })} autoComplete="street-address" /></Field>
      <div className="grid-2">
        <Field label="CAP"><Input id="f-customer.zip" inputMode="numeric" value={customer.zip ?? ''} onChange={(e) => set({ zip: e.target.value })} autoComplete="postal-code" /></Field>
        <Field label="Provincia (sigla)"><Input id="f-customer.province" value={customer.province ?? ''} maxLength={2} onChange={(e) => set({ province: e.target.value.toUpperCase() })} autoCapitalize="characters" /></Field>
      </div>
      <Field label="Comune"><Input id="f-customer.city" value={customer.city ?? ''} onChange={(e) => set({ city: e.target.value })} autoComplete="address-level2" /></Field>
      <div className="grid-2">
        <Field label="Email"><Input type="email" inputMode="email" value={customer.email ?? ''} onChange={(e) => set({ email: e.target.value })} /></Field>
        <Field label="Telefono"><Input type="tel" inputMode="tel" value={customer.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} /></Field>
      </div>
      <Field label="Codice destinatario (SDI)" hint="7 caratteri. Se non lo conosci lascia vuoto o scrivi 0000000.">
        <Input id="f-customer.codiceDestinatario" value={cd} maxLength={7} onChange={(e) => set({ codiceDestinatario: e.target.value.toUpperCase() })} autoComplete="off" autoCapitalize="characters" />
      </Field>
      <Field label="PEC del cliente (facoltativa)"><Input id="f-customer.pec" type="email" inputMode="email" value={customer.pec ?? ''} onChange={(e) => set({ pec: e.target.value })} autoComplete="off" /></Field>
    </div>
  );
}
