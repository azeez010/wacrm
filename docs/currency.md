# Currency

Prices are stored in the **base currency (NGN)**. Visitors see them converted into
their own currency, marked "≈". This only changes what is *displayed*; what we charge
is decided with payments.

- **Which currency:** the visitor's choice (cookie `ogadesk_currency`, set by the
  switcher on the landing page) → their country's currency (`cf-ipcountry`) → USD →
  the base. Only currencies we hold a rate for are used.
- **Rates:** one call a day to the free `open.er-api.com` API, cached in
  `exchange_rates`. The Cloudflare cron hits `POST /api/currency/refresh` every
  5 minutes; it is a no-op unless the cache is over 24 h old, and a failed fetch is
  retried no sooner than an hour later. On failure the last cached rates keep being
  served, so pages never break.
- **Feature switch:** `currency_settings.convert_display` (default on). Off = everyone
  sees the base currency. Base currency is `currency_settings.base_currency`; when it is
  changed, also set `last_attempt_at = null` so rates for the new base fetch at once.
  Manual rates: insert/update `exchange_rates` with `is_override = true` (refresh leaves
  those alone). Refreshes, failures and admin changes go to `currency_audit_log`
  (the admin site should write `base_changed`, `switch_changed`, `rate_overridden`).
- **Rounding:** converted prices are rounded to friendly numbers (`friendlyRound`).
- **Partners:** money is recorded in the base currency (payout minimum is naira).
- **Code:** `src/lib/currency/*`, `GET/POST /api/currency`, `useMoney()` for client
  components, `CurrencySwitcher`, landing `src/app/[locale]/page.tsx`.
