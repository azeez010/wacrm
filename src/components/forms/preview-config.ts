import type { PublicField, PublicFormConfig } from '@/lib/forms/public-config';
import type { FormField, FormKind, FormSettings } from '@/lib/forms/types';
import type { FormEditorData } from './use-form-data';

/** Client-side twin of the server's buildPublicConfig, for the live preview. */
export function buildPreviewConfig(
  publicId: string,
  kind: FormKind,
  name: string,
  fields: FormField[],
  settings: FormSettings,
  data: FormEditorData,
  advanced = false,
): PublicFormConfig {
  const out: PublicField[] = [];
  for (const f of fields) {
    const base: PublicField = {
      id: f.id,
      kind: f.kind,
      label: f.label ?? '',
      help: f.help,
      placeholder: f.placeholder,
      required: f.kind === 'phone' ? true : f.required,
    };
    if (f.kind === 'custom_field') {
      const d = data.customFields.find((c) => c.id === f.customFieldId);
      if (!d) continue;
      base.type = d.field_type;
      base.label = f.label || d.field_name;
      base.options = f.options?.length ? f.options : d.field_options?.options;
      base.display = f.display;
    } else if (f.kind === 'table_column') {
      const d = data.tableColumns.find((c) => c.refFieldId === f.tableRef?.fieldId && c.column.key === f.tableRef?.columnKey)?.column;
      if (!d) continue;
      base.type = d.field_type;
      base.label = f.label || d.field_name;
      base.options = f.options?.length ? f.options : d.field_options?.options;
      base.display = f.display;
    } else if (f.kind === 'tag_picker') {
      base.tags = (f.tagIds ?? []).flatMap((id) => {
        const t = data.tags.find((x) => x.id === id);
        return t ? [t] : [];
      });
    } else if (f.kind === 'hidden') {
      base.param = f.param;
      base.fixedValue = f.fixedValue;
    } else if (f.kind === 'consent') {
      base.consentText = f.consentText;
      base.privacyUrl = f.privacyUrl;
    } else if (f.kind === 'heading') {
      base.text = f.text;
    }
    out.push(base);
  }
  const w = settings.widget;
  return {
    publicId,
    kind,
    name,
    title: settings.title ?? name,
    description: settings.description,
    buttonText: settings.buttonText,
    accent: settings.accent ?? '#10b981',
    logoUrl: settings.logoUrl,
    language: settings.language ?? 'en',
    theme: settings.theme ?? 'auto',
    defaultCountry: (settings.defaultCountry ?? 'auto').toLowerCase() === 'auto' ? 'auto' : (settings.defaultCountry as string).toUpperCase(),
    noindex: settings.noindex !== false,
    og: {},
    success: { action: settings.success.action, message: settings.success.message, redirectUrl: settings.success.redirectUrl, followUpLine: settings.success.followUpLine },
    turnstile: false,
    // Mirrors the server rule; the editor passes the plan in.
    showBranding: !(settings.hideBranding === true && advanced),
    widget: kind === 'support' ? { corner: w?.corner ?? 'bottom-left', offsetX: w?.offsetX ?? 20, offsetY: w?.offsetY ?? 20, icon: w?.icon ?? 'whatsapp', label: w?.label, color: w?.color ?? settings.accent, greeting: w?.greeting, animation: w?.animation ?? 'pulse', sound: w?.sound ?? 'none', preMessage: w?.preMessage, preMessageDelay: w?.preMessageDelay ?? 4, showOn: w?.showOn ?? 'all', devices: w?.devices ?? 'all', hours: w?.hours } : undefined,
    fields: out,
  };
}
