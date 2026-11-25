import { describe, expect, it } from "vitest";
import {
  DEFAULT_SOUND_PREF,
  SOUND_THROTTLE_MS,
  parseSoundPref,
  shouldPlaySound,
} from "./sound";

describe("parseSoundPref", () => {
  it("defaults to on, pop, full volume", () => {
    expect(parseSoundPref(null)).toEqual({ enabled: true, sound: "pop", volume: 1 });
    expect(parseSoundPref("")).toEqual(DEFAULT_SOUND_PREF);
  });

  it("reads a valid stored value", () => {
    expect(
      parseSoundPref(JSON.stringify({ enabled: false, sound: "chime", volume: 0.4 })),
    ).toEqual({ enabled: false, sound: "chime", volume: 0.4 });
  });

  it("falls back per field on junk", () => {
    expect(parseSoundPref("{not json")).toEqual(DEFAULT_SOUND_PREF);
    expect(parseSoundPref(JSON.stringify({ sound: "trumpet", volume: 9 }))).toEqual({
      enabled: true,
      sound: "pop",
      volume: 1,
    });
    expect(parseSoundPref(JSON.stringify({ volume: -2 })).volume).toBe(0);
  });
});

describe("shouldPlaySound", () => {
  it("throttles bursts", () => {
    expect(shouldPlaySound(1000, null)).toBe(true);
    expect(shouldPlaySound(1000 + SOUND_THROTTLE_MS - 1, 1000)).toBe(false);
    expect(shouldPlaySound(1000 + SOUND_THROTTLE_MS, 1000)).toBe(true);
  });
});
