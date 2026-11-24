'use client';

import { COUNTRIES } from '@/lib/forms/countries';

// Country picker + number box shared by the lead form and the live chat. The
// select is a fixed width and the input flexes; no `w-full` on either, so the
// row never overflows (a w-full select used to push the number off-screen).
const base =
  'rounded-lg border border-[color:var(--og-border)] bg-[var(--og-input)] px-3 py-2.5 text-sm text-[color:var(--og-fg)] placeholder:text-[color:var(--og-muted)] focus:border-[color:var(--og-muted)] focus:outline-none focus:ring-2 focus:ring-[color:var(--og-ring)]';

export function PhoneInput({
  id,
  value,
  onChange,
  country,
  onCountry,
  placeholder,
  invalid,
  describedBy,
  onBlur,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  country: string;
  onCountry: (iso: string) => void;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  onBlur?: () => void;
}) {
  return (
    <div className="flex w-full gap-2">
      <select aria-label="Country" value={country} onChange={(e) => onCountry(e.target.value)} className={`${base} w-28 shrink-0 px-2`}>
        {COUNTRIES.map((c) => (
          <option key={`${c.iso}-${c.cc}`} value={c.iso}>
            {c.iso} +{c.cc}
          </option>
        ))}
      </select>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        maxLength={32}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={`${base} min-w-0 flex-1`}
      />
    </div>
  );
}
