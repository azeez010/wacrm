'use client'

// Admin tool (opened from the admin console with a 15-minute ticket): runs Meta's real Embedded Signup popup and
// shows what Meta returns, then checks it via /api/tools/embedded-signup-test/verify. Connects nothing, saves nothing.
// English only on purpose: it is an operator tool, not customer UI.

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'

type Config = { configured: boolean; appId: string | null; configId: string | null; graphApiVersion: string; coexistenceConfigId: string | null; coexistenceFeatureType: string; missing: string[] }
type Step = { name: string; ok: boolean | null; detail: string }
type FbWindow = Window & {
  FB?: { init: (o: { appId: string; xfbml: boolean; version: string }) => void; login: (cb: (r: { authResponse?: { code?: string } }) => void, o: Record<string, unknown>) => void }
  fbAsyncInit?: () => void
}

const mark = (ok: boolean | null) => (ok === true ? '✓' : ok === false ? '✗' : '–')

function loadSdk(appId: string, version: string): Promise<void> {
  const w = window as FbWindow
  return new Promise((resolve) => {
    if (w.FB) return resolve()
    w.fbAsyncInit = () => { w.FB!.init({ appId, xfbml: false, version }); resolve() }
    if (document.getElementById('facebook-jssdk')) return
    const s = document.createElement('script')
    s.id = 'facebook-jssdk'
    s.src = 'https://connect.facebook.net/en_US/sdk.js'
    s.async = true
    document.body.appendChild(s)
  })
}

function Test() {
  const token = useSearchParams().get('token') ?? ''
  const [config, setConfig] = useState<Config | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sdk, setSdk] = useState(false)
  const [log, setLog] = useState<Step[]>([])
  const [busy, setBusy] = useState(false)
  const pending = useRef<{ code?: string; wabaId?: string; phoneNumberId?: string }>({})
  const add = (s: Step) => setLog((l) => [...l, s])

  useEffect(() => {
    fetch(`/api/tools/embedded-signup-test/config?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (r) => (r.ok ? setConfig((await r.json()) as Config) : setError(r.status === 401 ? 'This test link is invalid or has expired (links last 15 minutes). Start it again from the admin console.' : 'Could not load the configuration.')))
      .catch(() => setError('Could not load the configuration.'))
  }, [token])

  useEffect(() => {
    if (!config?.configured || !config.appId) return
    void loadSdk(config.appId, config.graphApiVersion).then(() => setSdk(true))
  }, [config])

  async function verify() {
    const p = pending.current
    if (!p.code) return
    const res = await fetch(`/api/tools/embedded-signup-test/verify?token=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: p.code, wabaId: p.wabaId, phoneNumberId: p.phoneNumberId }),
    }).catch(() => null)
    if (!res?.ok) add({ name: 'Check with Meta', ok: false, detail: res?.status === 401 ? 'The link expired.' : 'The verification request failed.' })
    else ((await res.json()) as { steps: Step[] }).steps.forEach(add)
    setBusy(false)
  }

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!e.origin.endsWith('facebook.com')) return
      let d: { type?: string; event?: string; data?: { waba_id?: string; phone_number_id?: string; error_message?: string; current_step?: string } }
      try { d = JSON.parse(e.data) } catch { return }
      if (d?.type !== 'WA_EMBEDDED_SIGNUP') return
      if (d.event === 'CANCEL') { add({ name: 'Signup popup', ok: false, detail: `Cancelled${d.data?.current_step ? ` at step “${d.data.current_step}”` : ''}.` }); setBusy(false); return }
      if (d.event === 'ERROR') { add({ name: 'Signup popup', ok: false, detail: d.data?.error_message ?? 'Meta reported an error.' }); setBusy(false); return }
      if (d.data?.waba_id && d.data?.phone_number_id) {
        pending.current.wabaId = d.data.waba_id
        pending.current.phoneNumberId = d.data.phone_number_id
        add({ name: 'Meta returned the account', ok: true, detail: `WhatsApp business account ${d.data.waba_id}, phone number id ${d.data.phone_number_id} (${d.event ?? 'finished'}).` })
        if (pending.current.code) void verify()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  function start(coexistence: boolean) {
    const w = window as FbWindow
    if (!w.FB || !config) return
    pending.current = {}
    setLog([])
    setBusy(true)
    const configId = coexistence && config.coexistenceConfigId ? config.coexistenceConfigId : config.configId
    const extras = coexistence ? { setup: {}, featureType: config.coexistenceFeatureType, sessionInfoVersion: '3' } : { setup: {}, sessionInfoVersion: '3' }
    w.FB.login((r) => {
      if (!r.authResponse?.code) { add({ name: 'Signup popup', ok: false, detail: 'No authorisation code came back (the popup was closed or blocked).' }); setBusy(false); return }
      pending.current.code = r.authResponse.code
      add({ name: 'Authorisation code received', ok: true, detail: 'Meta returned a one-time code.' })
      if (pending.current.phoneNumberId) void verify()
      else setTimeout(() => { if (!pending.current.phoneNumberId) { add({ name: 'Meta returned the account', ok: null, detail: 'No WhatsApp account details arrived with the code; checking the code only.' }); void verify() } }, 4000)
    }, { config_id: configId, response_type: 'code', override_default_response_type: true, extras })
  }

  return (
    <main className="mx-auto max-w-xl space-y-5 p-6 text-sm">
      <h1 className="text-xl font-semibold">Embedded Signup test</h1>
      <p className="text-muted-foreground">Runs Meta&apos;s real WhatsApp signup and shows what comes back. Nothing is connected to any business and nothing is saved.</p>
      {error && <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-3">{error}</p>}
      {!error && !config && <p>Loading…</p>}
      {config && !config.configured && <p role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">Missing setting: {config.missing.join(', ')}. Add it in the admin console (Platform settings → WhatsApp (Meta)).</p>}
      {config?.configured && (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!sdk || busy} onClick={() => start(false)} className="rounded-md bg-black px-4 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-black">{sdk ? 'Start signup (new number)' : 'Loading Facebook…'}</button>
          {config.coexistenceConfigId && <button type="button" disabled={!sdk || busy} onClick={() => start(true)} className="rounded-md border px-4 py-2 disabled:opacity-50">Start signup (existing WhatsApp Business app number)</button>}
        </div>
      )}
      {config?.configured && <p className="text-xs text-muted-foreground">App {config.appId}, configuration {config.configId}, Graph {config.graphApiVersion}.</p>}
      {log.length > 0 && (
        <ol className="space-y-2 rounded-lg border p-3" aria-label="Results">
          {log.map((s, i) => <li key={i} className="flex gap-2"><span className={s.ok === true ? 'text-emerald-600' : s.ok === false ? 'text-red-600' : 'text-muted-foreground'}>{mark(s.ok)}</span><span><strong>{s.name}.</strong> {s.detail}</span></li>)}
        </ol>
      )}
    </main>
  )
}

export default function Page() {
  return <Suspense><Test /></Suspense>
}
