'use client';

import { useTranslations } from 'next-intl';

import { Label } from '@/components/ui/label';
import type { FormSettings } from '@/lib/forms/types';

const selectCls = 'h-9 w-full rounded-lg border border-border bg-muted px-2 text-sm text-foreground disabled:opacity-60';

/** System / Light / Dark for the public form. Shared by the lead and support editors. */
export function ThemeSelect({
  value,
  canEdit,
  onChange,
}: {
  value: FormSettings['theme'];
  canEdit: boolean;
  onChange: (theme: 'auto' | 'light' | 'dark') => void;
}) {
  const t = useTranslations('Forms.settings');
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{t('theme')}</Label>
      <select className={selectCls} disabled={!canEdit} value={value ?? 'auto'} onChange={(e) => onChange(e.target.value as 'auto' | 'light' | 'dark')}>
        <option value="auto">{t('themeAuto')}</option>
        <option value="light">{t('themeLight')}</option>
        <option value="dark">{t('themeDark')}</option>
      </select>
    </div>
  );
}
