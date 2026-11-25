-- New partners appear on the leaderboard by default (display name + referral count only).
-- Existing rows are left as they are: nobody has explicitly chosen yet, so we don't opt them in.
ALTER TABLE partners ALTER COLUMN show_on_leaderboard SET DEFAULT true;
