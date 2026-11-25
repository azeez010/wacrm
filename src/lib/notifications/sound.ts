/**
 * New-message sound for the dashboard (WhatsApp-Web style). Tones are
 * synthesised with the Web Audio API, so there are no audio files to
 * ship or license. The preference is device-scoped (localStorage), like
 * the browser-notifications opt-in in ./browser-notify.ts.
 *
 * Pure parts (pref parsing, throttle) are unit-tested; the playback and
 * storage helpers guard for SSR.
 */

export const SOUND_IDS = ["pop", "chime", "ding", "bubble", "soft"] as const;
export type SoundId = (typeof SOUND_IDS)[number];

export interface SoundPref {
  enabled: boolean;
  sound: SoundId;
  /** 0..1 */
  volume: number;
}

export const DEFAULT_SOUND_PREF: SoundPref = {
  enabled: true,
  sound: "pop",
  volume: 1,
};

export const SOUND_STORAGE_KEY = "wacrm:message-sound";
export const SOUND_CHANGE_EVENT = "wacrm:message-sound-change";

/** At most one sound per this window, so a burst makes one sound. */
export const SOUND_THROTTLE_MS = 1500;

export function isSoundId(v: unknown): v is SoundId {
  return typeof v === "string" && (SOUND_IDS as readonly string[]).includes(v);
}

/** Parse a stored value; anything invalid falls back to the defaults. */
export function parseSoundPref(raw: string | null | undefined): SoundPref {
  if (!raw) return DEFAULT_SOUND_PREF;
  try {
    const v = JSON.parse(raw) as Partial<SoundPref> | null;
    if (!v || typeof v !== "object") return DEFAULT_SOUND_PREF;
    const volume =
      typeof v.volume === "number" && Number.isFinite(v.volume)
        ? Math.min(1, Math.max(0, v.volume))
        : DEFAULT_SOUND_PREF.volume;
    return {
      enabled: typeof v.enabled === "boolean" ? v.enabled : DEFAULT_SOUND_PREF.enabled,
      sound: isSoundId(v.sound) ? v.sound : DEFAULT_SOUND_PREF.sound,
      volume,
    };
  } catch {
    return DEFAULT_SOUND_PREF;
  }
}

export function shouldPlaySound(now: number, lastAt: number | null): boolean {
  return lastAt === null || now - lastAt >= SOUND_THROTTLE_MS;
}

// ---------------------------------------------------------------------
// Browser-only helpers (SSR-guarded).
// ---------------------------------------------------------------------

// useSyncExternalStore needs a stable snapshot: cache by raw string.
let cachedRaw: string | null | undefined;
let cachedPref: SoundPref = DEFAULT_SOUND_PREF;

export function readSoundPref(): SoundPref {
  if (typeof window === "undefined") return DEFAULT_SOUND_PREF;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SOUND_STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedPref = parseSoundPref(raw);
  }
  return cachedPref;
}

export function writeSoundPref(next: Partial<SoundPref>): void {
  if (typeof window === "undefined") return;
  const merged = { ...readSoundPref(), ...next };
  try {
    window.localStorage.setItem(SOUND_STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // Best-effort (private browsing).
  }
  window.dispatchEvent(new Event(SOUND_CHANGE_EVENT));
}

export function subscribeSoundPref(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === SOUND_STORAGE_KEY) onChange();
  };
  window.addEventListener(SOUND_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SOUND_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

type Ctor = typeof AudioContext;
let ctx: AudioContext | null = null;
let unlockBound = false;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const AC: Ctor | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  return ctx;
}

/**
 * Browsers only let audio start after a user gesture. Resume the shared
 * context on the first click/key so later (realtime-triggered) sounds
 * are allowed. Call once from the listener.
 */
export function unlockAudioOnGesture(): void {
  if (typeof window === "undefined" || unlockBound) return;
  unlockBound = true;
  const unlock = () => {
    const c = getContext();
    if (c && c.state === "suspended") void c.resume().catch(() => {});
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

interface Note {
  /** Hz */
  freq: number;
  /** seconds from start */
  at: number;
  /** seconds */
  dur: number;
  type?: OscillatorType;
  /** relative gain 0..1 */
  gain?: number;
  /** glide to this frequency over the note */
  to?: number;
}

const PATTERNS: Record<SoundId, Note[]> = {
  // Short two-step blip.
  pop: [
    { freq: 880, at: 0, dur: 0.08, type: "sine" },
    { freq: 1320, at: 0.07, dur: 0.11, type: "sine" },
  ],
  chime: [
    { freq: 1046.5, at: 0, dur: 0.35, type: "triangle", gain: 0.8 },
    { freq: 1568, at: 0.12, dur: 0.45, type: "triangle", gain: 0.7 },
  ],
  ding: [{ freq: 1760, at: 0, dur: 0.5, type: "sine" }],
  bubble: [{ freq: 400, to: 1200, at: 0, dur: 0.14, type: "sine" }],
  soft: [
    { freq: 660, at: 0, dur: 0.18, type: "sine", gain: 0.6 },
    { freq: 880, at: 0.14, dur: 0.22, type: "sine", gain: 0.6 },
  ],
};

/** Play a tone. Never throws; silent when audio is unavailable/blocked. */
export function playSound(id: SoundId, volume = 1): void {
  const c = getContext();
  if (!c) return;
  try {
    if (c.state === "suspended") void c.resume().catch(() => {});
    const master = c.createGain();
    master.gain.value = Math.min(1, Math.max(0, volume)) * 0.5;
    master.connect(c.destination);
    const t0 = c.currentTime + 0.01;
    for (const n of PATTERNS[id] ?? PATTERNS.pop) {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = n.type ?? "sine";
      const start = t0 + n.at;
      const end = start + n.dur;
      osc.frequency.setValueAtTime(n.freq, start);
      if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, end);
      const peak = n.gain ?? 1;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(peak, start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(g);
      g.connect(master);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  } catch {
    // Audio is best-effort.
  }
}
