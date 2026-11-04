import { useId, useMemo, useState } from 'react';
import { Field, Input } from '../../ui';
import type { Customer } from '../../types';
import { searchCustomers } from '../../storage/customerModel';
import './customerPicker.css';

interface Props {
  value: string;
  customers: Customer[];
  /** id del cliente di rubrica già agganciato (niente suggerimenti finché il nome è quello scelto) */
  linkedId?: string;
  error?: string;
  onName: (name: string) => void;
  onPick: (c: Customer) => void;
}

/** Campo Cliente con autocompletamento dalla rubrica (pattern ARIA combobox/listbox). */
export function CustomerPicker({ value, customers, linkedId, error, onName, onPick }: Props) {
  const lid = useId();
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const linked = linkedId ? customers.find((c) => c.id === linkedId) : undefined;
  const options = useMemo(() => {
    if (!focused || dismissed || value.trim().length < 2) return [];
    if (linked && linked.name === value) return [];
    return searchCustomers(value, customers, 5);
  }, [focused, dismissed, value, customers, linked]);
  const open = options.length > 0;
  const pick = (c: Customer) => { onPick(c); setDismissed(true); setActive(-1); };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % options.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a <= 0 ? options.length - 1 : a - 1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(options[active]); }
    else if (e.key === 'Escape') { e.stopPropagation(); setDismissed(true); }
  };

  return (
    <Field label="Cliente" error={error}>
      <div className="cp">
        <Input
          id="qe-customer"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${lid}-list`}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${lid}-o${active}` : undefined}
          aria-invalid={error ? true : undefined}
          value={value}
          onChange={(e) => { setDismissed(false); setActive(-1); onName(e.target.value); }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKey}
          placeholder="Nome e cognome o ragione sociale"
          autoComplete="off"
        />
        {open && (
          <ul className="cp-list" role="listbox" id={`${lid}-list`} aria-label="Clienti in rubrica">
            {options.map((c, i) => (
              <li key={c.id} id={`${lid}-o${i}`} role="option" aria-selected={i === active} data-active={i === active || undefined}
                onMouseDown={(e) => { e.preventDefault(); pick(c); }}>
                <span className="cp-name">{c.name}</span>
                <span className="cp-meta">{[c.vatNumber && `P.IVA ${c.vatNumber}`, c.city].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Field>
  );
}
