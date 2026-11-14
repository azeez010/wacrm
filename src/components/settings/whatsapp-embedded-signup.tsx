'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, QrCode, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';

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
export function WhatsAppEmbeddedSignup({
  onConnected,
}: {
  onConnected?: () => void;
}) {
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

  if (!clientConfig?.configured) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect WhatsApp</CardTitle>
        <CardDescription>
          Get started without your own Meta Business account — this connects
          through our platform.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row">
        <Button
          onClick={() => launch('standard')}
          disabled={!sdkReady || connecting !== null}
          className="flex-1"
        >
          {connecting === 'standard' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Connect a New Number
        </Button>
        {clientConfig.coexistenceConfigId && (
          <Button
            variant="outline"
            onClick={() => launch('coexistence')}
            disabled={!sdkReady || connecting !== null}
            className="flex-1"
          >
            {connecting === 'coexistence' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <QrCode className="h-4 w-4" />
            )}
            Link Your WhatsApp Business App
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
