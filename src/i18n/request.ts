import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { defaultLocale, isLocale, LOCALE_COOKIE } from './locales';

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

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch {
    // Fallback to English if the dictionary for the requested locale doesn't exist yet
    messages = (await import(`../../messages/en.json`)).default;
  }

  return {
    locale,
    messages,
  };
});
