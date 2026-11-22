'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { parseMultiValue } from '@/lib/custom-fields/format';
import type { FieldDef } from '@/lib/custom-fields/types';
import { ReferencePicker } from './reference-picker';
import { MediaInput } from './media-input';
import { useAuth } from '@/hooks/use-auth';
import { fromLocalInput, toLocalInput } from '@/lib/custom-fields/datetime-tz';

const NONE = '__none__';

interface CustomFieldInputProps {
  field: Pick<FieldDef, 'field_name' | 'field_type' | 'field_options'>;
  /** Canonical string value ('' = unset). */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * One input per custom-field type: text, number, switch (yes/no), date,
 * select (choice), chips (multiple choice) and a type-ahead (reference).
 * Values are exchanged as canonical strings so every caller can hand them
 * straight to `coerceValue` / the API.
 */
export function CustomFieldInput({
  field,
  value,
  onChange,
  disabled,
  placeholder,
  className,
}: CustomFieldInputProps) {
  const t = useTranslations('CustomFields.input');
  const { accountTimezone } = useAuth();
  const opts = field.field_options ?? {};
  const base = 'bg-muted border-border text-foreground h-8 text-sm placeholder:text-muted-foreground';

  switch (field.field_type) {
    case 'number':
      return (
        <Input
          type="number"
          inputMode="decimal"
          step="any"
          min={opts.min}
          max={opts.max}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={cn(base, className)}
        />
      );
    case 'bool':
      return (
        <div className={cn('flex h-8 items-center gap-2', className)}>
          <Switch
            checked={value === 'true'}
            disabled={disabled}
            onCheckedChange={(c) => onChange(c ? 'true' : 'false')}
            aria-label={field.field_name}
          />
          <span className="text-xs text-muted-foreground">
            {value === 'true' ? t('yes') : value === 'false' ? t('no') : t('notSet')}
          </span>
        </div>
      );
    case 'date': {
      const withTime = Boolean(opts.include_time);
      // A calendar day is shown as stored; a moment is shown in the account time zone.
      const shown = value
        ? withTime
          ? toLocalInput(value, accountTimezone)
          : value.slice(0, 10)
        : '';
      return (
        <Input
          type={withTime ? 'datetime-local' : 'date'}
          value={shown}
          disabled={disabled}
          onChange={(e) => onChange(withTime ? fromLocalInput(e.target.value, accountTimezone) : e.target.value)}
          className={cn(base, className)}
        />
      );
    }
    case 'datetime':
      return (
        <Input
          type="datetime-local"
          value={toLocalInput(value, accountTimezone)}
          disabled={disabled}
          onChange={(e) => onChange(fromLocalInput(e.target.value, accountTimezone))}
          className={cn(base, className)}
        />
      );
    case 'url':
    case 'email':
    case 'phone':
      return (
        <Input
          type={field.field_type === 'phone' ? 'tel' : field.field_type}
          inputMode={field.field_type === 'phone' ? 'tel' : field.field_type === 'email' ? 'email' : 'url'}
          value={value}
          disabled={disabled}
          placeholder={
            placeholder ??
            (field.field_type === 'url' ? 'https://' : field.field_type === 'phone' ? '+234...' : 'name@example.com')
          }
          onChange={(e) => onChange(e.target.value)}
          className={cn(base, className)}
        />
      );
    case 'enum':
      return (
        <Select
          value={value || NONE}
          onValueChange={(v) => onChange(!v || v === NONE ? '' : v)}
          disabled={disabled}
        >
          <SelectTrigger className={cn('h-8 w-full bg-muted text-sm', className)}>
            <SelectValue>{value || t('choose')}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('none')}</SelectItem>
            {(opts.options ?? []).map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case 'multi_enum': {
      const picked = new Set(parseMultiValue(value));
      return (
        <div className={cn('flex flex-wrap gap-1.5', className)}>
          {(opts.options ?? []).map((o) => {
            const on = picked.has(o);
            return (
              <button
                key={o}
                type="button"
                disabled={disabled}
                aria-pressed={on}
                onClick={() => {
                  const next = new Set(picked);
                  if (on) next.delete(o);
                  else next.add(o);
                  const list = (opts.options ?? []).filter((x) => next.has(x));
                  onChange(list.length ? JSON.stringify(list) : '');
                }}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-xs transition-colors disabled:opacity-50',
                  on
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-muted text-muted-foreground hover:text-foreground'
                )}
              >
                {o}
              </button>
            );
          })}
        </div>
      );
    }
    case 'media':
      return (
        <MediaInput
          value={value}
          onChange={onChange}
          accept={opts.accept}
          disabled={disabled}
          className={className}
        />
      );
    case 'reference':
      return opts.table_key ? (
        <ReferencePicker
          tableKey={opts.table_key}
          value={value}
          onChange={onChange}
          disabled={disabled}
          className={className}
        />
      ) : null;
    default:
      return (
        <Input
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={cn(base, className)}
        />
      );
  }
}
