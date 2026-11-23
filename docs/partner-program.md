# Partner program

Every user (any role) is a partner. They get a personal referral link
(`https://ogadesk.com/signup?ref=CODE`), a partner page in the app (`/affiliate`:
link, stats, referrals, report, marketing materials, leaderboard, payout details) and
a public pitch page (`/partners`, linked from the landing footer).

## How a referral is recorded
1. A visit with `?ref=CODE` sets the `ogadesk_ref` cookie for 30 days (middleware).
2. After sign-in, the dashboard calls `POST /api/partner/attribute` once: the code
   is matched (case-insensitive) to a partner and a `referrals` row is written, then
   the cookie is cleared. First code wins; self-referrals and suspended/unknown codes
   are ignored (`src/lib/partner/attribute.ts`).
3. Brevo gets `referral_signed_up` for the partner and the contact attributes
   `PARTNER_CODE`, `REFERRALS_COUNT`, `REFERRED_BY`.

## Tables (migration 080)
`partner_settings` (single row: commission %, recurring months, hold days, min payout),
`partners` (code, display name, leaderboard opt-in, payout details, status),
`referrals`, `partner_materials`. All writes go through the server (service role);
payout details are never readable with the client API.

## Not built yet
Money: commissions, payouts and the admin site (admin.ogadesk.com) arrive with
payments. Until then the UI shows earnings as 0 and says payouts open at launch.
Add marketing materials by inserting rows into `partner_materials` (title, kind, url,
optional image_url/description/size_label, sort_order).
