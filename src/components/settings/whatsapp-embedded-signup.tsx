'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Loader2,
  PlusCircle,
  Smartphone,
  Wrench,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { WhatsAppConfig } from './whatsapp-config';

declare global {
  interface Window {
    FB?: {
      init: (opts: { appId: string; xfbml: boolean; version: string }) => void;
      login: (
        callback: (response: { authResponse?: { code?: string } }) => void,
        options: Record<string, unknown>
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

interface ClientConfig {
  configured: boolean;
  appId?: string;
  graphApiVersion?: string;
  configId?: string;
  coexistenceConfigId?: string | null;
  coexistenceFeatureType?: string;
}

function loadFacebookSdk(
  appId: string,
  graphApiVersion: string
): Promise<void> {
  return new Promise((resolve) => {
    if (window.FB) {
      resolve();
      return;
    }
    window.fbAsyncInit = function () {
      window.FB!.init({ appId, xfbml: false, version: graphApiVersion });
      resolve();
    };
    if (document.getElementById('facebook-jssdk')) return;
    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
  });
}

type Variant = 'standard' | 'coexistence';

/**
 * Primary "shared" WhatsApp connection flow — Embedded Signup under
 * the platform operator's own Tech Provider Meta App. No Meta
 * Developer App or access token of the tenant's own required.
 *
 * Two sub-flows: a brand-new Cloud API number, or an existing number
 * already active on the WhatsApp Business mobile app (which enables
 * coexistence — the app keeps working — and imports its prior chat
 * history).
 */
function useEmbeddedSignup(onConnected?: () => void) {
  const [clientConfig, setClientConfig] = useState<ClientConfig | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [connecting, setConnecting] = useState<Variant | null>(null);
  const pendingSignup = useRef<{
    code?: string;
    wabaId?: string;
    phoneNumberId?: string;
    isCoexistence?: boolean;
  }>({});

  useEffect(() => {
    fetch('/api/whatsapp/connections/embedded-signup/config')
      .then((res) => res.json())
      .then(setClientConfig)
      .catch(() => setClientConfig({ configured: false }));
  }, []);

  useEffect(() => {
    if (!clientConfig?.configured || !clientConfig.appId) return;
    loadFacebookSdk(
      clientConfig.appId,
      clientConfig.graphApiVersion || 'v21.0'
    ).then(() => setSdkReady(true));
  }, [clientConfig]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!event.origin.endsWith('facebook.com')) return;
      let data: {
        type?: string;
        event?: string;
        data?: {
          waba_id?: string;
          phone_number_id?: string;
          error_message?: string;
        };
      };
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;

      if (data.event === 'CANCEL') {
        setConnecting(null);
        return;
      }
      if (data.event === 'ERROR') {
        toast.error(data.data?.error_message || 'WhatsApp connection failed');
        setConnecting(null);
        return;
      }
      if (data.data?.waba_id && data.data?.phone_number_id) {
        pendingSignup.current.wabaId = data.data.waba_id;
        pendingSignup.current.phoneNumberId = data.data.phone_number_id;
        pendingSignup.current.isCoexistence =
          data.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING';
        void maybeComplete();
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function maybeComplete() {
    const { code, wabaId, phoneNumberId, isCoexistence } =
      pendingSignup.current;
    if (!code || !wabaId || !phoneNumberId) return;

    try {
      const res = await fetch('/api/whatsapp/connections/embedded-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          wabaId,
          phoneNumberId,
          isCoexistence: !!isCoexistence,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        toast.error(body.error || 'Failed to complete WhatsApp connection');
        return;
      }
      toast.success('WhatsApp connected');
      onConnected?.();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Failed to complete WhatsApp connection'
      );
    } finally {
      pendingSignup.current = {};
      setConnecting(null);
    }
  }

  function launch(variant: Variant) {
    if (!sdkReady || !window.FB || !clientConfig) return;
    const configId =
      variant === 'coexistence'
        ? clientConfig.coexistenceConfigId
        : clientConfig.configId;
    if (!configId) {
      toast.error(
        variant === 'coexistence'
          ? 'Coexistence is not configured on this deployment.'
          : 'Embedded Signup is not configured on this deployment.'
      );
      return;
    }
    setConnecting(variant);
    pendingSignup.current = {};

    const extras =
      variant === 'coexistence'
        ? {
            setup: {},
            featureType: clientConfig.coexistenceFeatureType,
            sessionInfoVersion: '3',
          }
        : { setup: {}, sessionInfoVersion: '3' };

    window.FB.login(
      (response) => {
        if (response.authResponse?.code) {
          pendingSignup.current.code = response.authResponse.code;
          void maybeComplete();
        } else {
          setConnecting(null);
        }
      },
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras,
      }
    );
  }

  return {
    clientConfig,
    sdkReady,
    connecting,
    launch,
  };
}

interface Connection {
  id: string;
  mode: 'shared' | 'custom';
  signup_type: 'new_number' | 'existing_number' | null;
  label: string | null;
  display_phone_number: string | null;
  verified_name: string | null;
  phone_number_id: string;
  status: string;
}

function OptionCard({
  icon,
  title,
  description,
  onClick,
  disabled,
  busy,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="hover:border-primary hover:bg-muted/40 flex flex-1 flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="bg-primary-soft text-primary flex size-9 items-center justify-center rounded-lg">
        {busy ? <Loader2 className="size-4 animate-spin" /> : icon}
      </span>
      <span className="text-foreground text-sm font-semibold">{title}</span>
      <span className="text-muted-foreground text-xs">{description}</span>
    </button>
  );
}

type Step = 'choose' | 'number' | 'manual';

/**
 * WhatsApp connection entry point.
 *
 *   choose ─┬─ "Connect a number" ─┬─ existing number (coexistence)
 *           │                      └─ new number
 *           └─ "Manual setup"  ──── bring-your-own Meta app form
 */
export function WhatsAppEmbeddedSignup({
  onConnected,
}: {
  onConnected?: () => void;
}) {
  const { clientConfig, sdkReady, connecting, launch } =
    useEmbeddedSignup(onConnected);
  const [step, setStep] = useState<Step>('choose');
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetch('/api/whatsapp/connections')
      .then((r) => r.json())
      .then((b) => setConnections(b.connections ?? []))
      .catch(() => setConnections([]));
  }, []);

  const hasConnections = (connections?.length ?? 0) > 0;
  const showChooser = connections !== null && (!hasConnections || adding);
  const platformReady = !!clientConfig?.configured;

  const back = (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-2 w-fit"
      onClick={() => setStep('choose')}
    >
      <ArrowLeft className="size-4" />
      Back
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      {hasConnections && (
        <Card>
          <CardHeader>
            <CardTitle>Your WhatsApp numbers</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ul className="divide-border divide-y rounded-lg border">
              {connections!.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-foreground truncate text-sm font-medium">
                      {c.label || c.verified_name || c.display_phone_number || c.phone_number_id}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {c.display_phone_number ?? c.phone_number_id}
                      {' · '}
                      {c.mode === 'shared'
                        ? c.signup_type === 'existing_number'
                          ? 'Existing number'
                          : 'New number'
                        : 'Manual setup'}
                    </p>
                  </div>
                  <span
                    className={
                      c.status === 'connected'
                        ? 'bg-primary-soft text-primary rounded-full px-2.5 py-0.5 text-xs font-medium'
                        : 'bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-xs font-medium'
                    }
                  >
                    {c.status === 'connected' ? 'Connected' : 'Not connected'}
                  </span>
                </li>
              ))}
            </ul>
            {!adding && (
              <Button
                variant="outline"
                className="w-fit"
                onClick={() => {
                  setAdding(true);
                  setStep('choose');
                }}
              >
                <PlusCircle className="size-4" />
                Add another number
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {showChooser && step === 'choose' && (
        <Card>
          <CardHeader>
            <CardTitle>Connect WhatsApp</CardTitle>
            <CardDescription>
              How would you like to connect?
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row">
            <OptionCard
              icon={<Zap className="size-4" />}
              title="Connect a number"
              description={
                platformReady
                  ? 'Quick and guided — no Meta developer account needed. We connect it through our platform.'
                  : 'Not available on this deployment yet.'
              }
              disabled={!platformReady}
              onClick={() => setStep('number')}
            />
            <OptionCard
              icon={<Wrench className="size-4" />}
              title="Manual setup"
              description="Use your own Meta app and API credentials."
              onClick={() => setStep('manual')}
            />
          </CardContent>
        </Card>
      )}

      {showChooser && step === 'number' && (
        <Card>
          <CardHeader>
            {back}
            <CardTitle>Connect a number</CardTitle>
            <CardDescription>
              Choose the kind of number you want to connect.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row">
            <OptionCard
              icon={<Smartphone className="size-4" />}
              title="Connect an existing number"
              description={
                clientConfig?.coexistenceConfigId
                  ? 'Already use the WhatsApp Business app? Link that number — the app keeps working and your chat history is imported.'
                  : 'Not available on this deployment yet.'
              }
              disabled={
                !sdkReady ||
                connecting !== null ||
                !clientConfig?.coexistenceConfigId
              }
              busy={connecting === 'coexistence'}
              onClick={() => launch('coexistence')}
            />
            <OptionCard
              icon={<PlusCircle className="size-4" />}
              title="Connect a new number"
              description="Set up a brand-new WhatsApp Business number on the Cloud API."
              disabled={!sdkReady || connecting !== null}
              busy={connecting === 'standard'}
              onClick={() => launch('standard')}
            />
          </CardContent>
        </Card>
      )}

      {showChooser && step === 'manual' && (
        <div className="flex flex-col gap-3">
          {back}
          <WhatsAppConfig />
        </div>
      )}

      {/* No connections yet and still loading — render nothing flashy. */}
    </div>
  );
}
