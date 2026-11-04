// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { Customer } from '../../types';
import { validateCustomer } from './validate';
import { customersToCsv, parseCustomersCsv } from './csv';
import { CustomerPicker } from '../quote/CustomerPicker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('validazione scheda cliente', () => {
  it('accetta una scheda completa e valida', () => {
    expect(validateCustomer({ id: '1', name: 'Rossi Srl', vatNumber: '02345678904', fiscalCode: 'BNCMRA80A01H501A', zip: '20100', province: 'mi', codiceDestinatario: 'abcdef1', pec: 'rossi@pec.example.test', email: 'a@example.test' })).toEqual({});
  });
  it('segnala nome mancante, P.IVA, CF, CAP, provincia, codice destinatario, PEC, email', () => {
    const e = validateCustomer({ id: '1', name: ' ', vatNumber: '02345678905', fiscalCode: 'XXXX', zip: '2010', province: 'M1', codiceDestinatario: 'ABC', pec: 'no', email: 'x@' });
    expect(Object.keys(e).sort()).toEqual(['codiceDestinatario', 'email', 'fiscalCode', 'name', 'pec', 'province', 'vatNumber', 'zip']);
  });
  it('per un cliente estero non applica i controlli italiani', () => {
    expect(validateCustomer({ id: '1', name: 'Müller GmbH', country: 'DE', vatNumber: 'DE123456789', zip: '10115', province: 'Berlin' })).toEqual({});
  });
});

describe('CSV clienti', () => {
  it('round-trip con virgolette, punto e virgola e protezione da formule', () => {
    const list: Customer[] = [
      { id: '1', name: 'Rossi; "il Grande" Srl', vatNumber: '02345678904', phone: '+39 333 1234567', city: 'Milano' },
      { id: '2', name: '=cmd|x', email: 'a@example.test' },
    ];
    const csv = customersToCsv(list);
    expect(csv.startsWith('﻿Nome;Partita IVA')).toBe(true);
    expect(csv).toContain("'=cmd|x");
    const r = parseCustomersCsv(csv);
    expect(r.error).toBeUndefined();
    expect(r.customers.map((c) => c.name)).toEqual(['Rossi; "il Grande" Srl', '=cmd|x']);
    expect(r.customers[0]).toMatchObject({ vatNumber: '02345678904', phone: '+39 333 1234567', city: 'Milano' });
  });
  it('riconosce sinonimi delle intestazioni, ignora righe senza nome, errore senza colonna nome', () => {
    const r = parseCustomersCsv('Ragione sociale;P.IVA;CAP\nVerdi Spa;01234567897;00100\n;123;1\n');
    expect(r.customers).toHaveLength(1);
    expect(r.ignored).toBe(1);
    expect(r.customers[0]).toMatchObject({ vatNumber: '01234567897', zip: '00100' });
    expect(parseCustomersCsv('a;b\n1;2').error).toMatch(/Nome/);
  });
});

describe('CustomerPicker (autocompletamento)', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });

  const book: Customer[] = [{ id: 'a', name: 'Rossi Costruzioni Srl', vatNumber: '02345678904', city: 'Milano' }, { id: 'b', name: 'Bianchi Elena' }];

  function Harness({ onPicked }: { onPicked: (c: Customer) => void }) {
    const [v, setV] = useState('');
    return <CustomerPicker value={v} customers={book} onName={setV} onPick={(c) => { setV(c.name); onPicked(c); }} />;
  }
  const type = (el: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => { el.focus(); setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
  };

  it('suggerisce digitando e compila il cliente scelto (mouse e tastiera)', () => {
    host = document.createElement('div'); document.body.appendChild(host);
    root = createRoot(host);
    let picked: Customer | null = null;
    act(() => root!.render(<Harness onPicked={(c) => { picked = c; }} />));
    const input = host.querySelector('input')!;
    expect(input.getAttribute('role')).toBe('combobox');
    type(input, 'r');
    expect(host.querySelector('[role=listbox]')).toBeNull(); // meno di 2 caratteri
    type(input, 'ros');
    const opts = host.querySelectorAll('[role=option]');
    expect(opts).toHaveLength(1);
    expect(opts[0].textContent).toContain('P.IVA 02345678904');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(picked).toMatchObject({ id: 'a', vatNumber: '02345678904' });
    expect(host.querySelector('[role=listbox]')).toBeNull();
  });
  it('nessun suggerimento se il nome non è in rubrica', () => {
    host = document.createElement('div'); document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<Harness onPicked={() => {}} />));
    type(host.querySelector('input')!, 'zzz');
    expect(host.querySelector('[role=option]')).toBeNull();
  });
});
