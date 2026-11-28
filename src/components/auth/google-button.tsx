"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { OAUTH_FLOW_PARAM, OAUTH_FLOW_VALUE } from "@/lib/auth/callback";
import { rememberAuthMethod } from "@/lib/auth/last-method";
import { LastUsedBadge } from "@/components/auth/last-used-badge";

export type LoginOptions = { password: boolean; google: boolean };

const ALL_ON: LoginOptions = { password: true, google: true };

/**
 * Which sign-in methods the admin console allows (migration 109,
 * `public.auth_login_options()`). Starts with everything on and falls
 * back to that on any error, so a settings hiccup never hides the only
 * way in. The access-token hook is the real gate; this only decides
 * what the page shows.
 */
export function useLoginOptions(): LoginOptions {
  const [options, setOptions] = useState<LoginOptions>(ALL_ON);
  useEffect(() => {
    let cancelled = false;
    createClient()
      .rpc("auth_login_options")
      .then(({ data, error }) => {
        if (cancelled || error || !data || typeof data !== "object") return;
        const d = data as Partial<LoginOptions>;
        const next = { password: d.password !== false, google: d.google !== false };
        // Never render a page with no way in.
        setOptions(next.password || next.google ? next : ALL_ON);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return options;
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.29 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.28a12 12 0 0 0 0 10.8l4.01-3.1z" />
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.6 4.59 1.8l3.44-3.44A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.28 6.6l4.01 3.1C6.23 6.86 8.88 4.75 12 4.75z" />
    </svg>
  );
}

/**
 * "Continue with Google". Works for sign-in and sign-up alike: a new
 * Google user is created by Supabase and bootstrapped by the
 * `handle_new_user` trigger, exactly like an email sign-up. The round
 * trip comes back through /auth/callback, which exchanges the code and
 * forwards to `next` (the dashboard, or /join/<token> for an invite).
 */
export function GoogleButton({
  label,
  inviteToken,
  onError,
  lastUsedLabel,
}: {
  label: string;
  inviteToken: string | null;
  onError: (message: string) => void;
  /** Shown as a "Last used" pill when Google was the last method on this browser. */
  lastUsedLabel?: string;
}) {
  const [loading, setLoading] = useState(false);

  const start = async () => {
    setLoading(true);
    rememberAuthMethod("google");
    const next = inviteToken
      ? `/join/${encodeURIComponent(inviteToken)}`
      : "/dashboard";
    const redirectTo =
      `${window.location.origin}/auth/callback` +
      `?next=${encodeURIComponent(next)}&${OAUTH_FLOW_PARAM}=${OAUTH_FLOW_VALUE}`;
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, queryParams: { prompt: "select_account" } },
    });
    // On success the browser is already navigating to Google.
    if (error) {
      onError(error.message);
      setLoading(false);
    }
  };

  return (
    <div className="relative">
      {lastUsedLabel && <LastUsedBadge label={lastUsedLabel} />}
      <Button
        type="button"
        variant="outline"
        disabled={loading}
        onClick={start}
        className="h-10 w-full gap-2 border-border text-foreground hover:bg-muted"
      >
        <GoogleIcon />
        {label}
      </Button>
    </div>
  );
}

/** "or" rule between the Google button and the email form. */
export function OrDivider({ label }: { label: string }) {
  return (
    <div className="my-4 flex items-center gap-3 text-xs uppercase text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      {label}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
