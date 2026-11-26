import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { defaultLocale, isLocale, LOCALE_COOKIE } from './locales';

type Tree = { [key: string]: unknown };
const isTree = (v: unknown): v is Tree => !!v && typeof v === 'object' && !Array.isArray(v);

/** `base` with every key `override` has replaced, recursively (so a partial catalogue never shows a raw key). */
export function withFallback(base: Tree, override: Tree): Tree {
  const out: Tree = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = isTree(v) && isTree(base[k]) ? withFallback(base[k] as Tree, v) : v;
  }
  return out;
}

export default getRequestConfig(async ({ requestLocale }) => {
  // Public pages (the landing page): the language comes from the URL path,
  // which the next-intl middleware resolves (`/fr` -> fr, `/` -> default).
  // Everywhere else (the signed-in app, auth and legal pages) a visitor's
  // choice is stored in a cookie by the language switcher; otherwise fall
  // back to the deployment default, NEXT_PUBLIC_APP_LOCALE or 'en'.
  const fromPath = await requestLocale;
  let locale: string;
  if (isLocale(fromPath)) {
    locale = fromPath;
  } else {
    const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
    locale = isLocale(cookieLocale) ? cookieLocale : defaultLocale();
  }

  const en = (await import(`../../messages/en.json`)).default;
  let messages = en;
  if (locale !== 'en') {
    try {
      // A language may be translated a section at a time: any key it lacks shows in English.
      messages = withFallback(en, (await import(`../../messages/${locale}.json`)).default) as typeof en;
    } catch {
      // Fallback to English if the dictionary for the requested locale doesn't exist yet
    }
  }

  return {
    locale,
    messages,
  };
});
