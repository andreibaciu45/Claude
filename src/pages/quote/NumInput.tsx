import { useEffect, useState } from 'react';
import { Input } from '../../ui';

const fmt = (n: number) => (Number.isFinite(n) ? String(n).replace('.', ',') : '');
export const parseNum = (s: string): number | null => {
  const t = s.trim().replace(/\s/g, '').replace(/\./g, (m, i, all) => (all.includes(',') ? '' : m)).replace(',', '.');
  if (t === '' || t === '-' || t === '.') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

interface Props {
  value: number;
  onChange: (n: number) => void;
  label: string;
  min?: number;
  max?: number;
  id?: string;
  className?: string;
}

/** Input numerico che accetta la virgola e non "salta" mentre si digita. */
export function NumInput({ value, onChange, label, min = 0, max, id, className }: Props) {
  const [text, setText] = useState(fmt(value));
  useEffect(() => {
    setText((cur) => (parseNum(cur) === value ? cur : fmt(value)));
  }, [value]);
  return (
    <div className={className}>
      <Input
        id={id}
        aria-label={label}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseNum(e.target.value);
          if (n !== null) onChange(Math.min(max ?? Infinity, Math.max(min, n)));
        }}
        onBlur={() => setText(fmt(value))}
      />
    </div>
  );
}
