import assert from "node:assert/strict";
import test from "node:test";
import {
  curatedNativeVoices,
  getNativeVoiceURI,
  getVoiceOutputMode,
  selectedNativeVoice,
  setNativeVoiceURI,
  setVoiceOutputMode,
} from "./src/lib/live/voicePreferences.ts";

const voice = (name, lang, voiceURI, isDefault = false) => ({ name, lang, voiceURI, default: isDefault, localService: true });

function withStorage(run) {
  const values = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
  try { run(); } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
}

test("curates natural English voices and removes novelty voices", () => withStorage(() => {
  const choices = curatedNativeVoices([
    voice("Basic English", "en-US", "basic", true),
    voice("Ava Enhanced", "en-US", "ava"),
    voice("Daniel Premium", "en-GB", "daniel"),
    voice("Zarvox", "en-US", "novelty"),
    voice("Thomas", "fr-FR", "french"),
  ]);
  assert.deepEqual(choices.map((item) => item.voiceURI), ["ava", "daniel", "basic"]);
}));

test("persists the selected voice and prefers it when the catalogue reloads", () => withStorage(() => {
  const voices = [voice("Ava Enhanced", "en-US", "ava"), voice("Daniel Premium", "en-GB", "daniel")];
  setNativeVoiceURI("daniel");
  assert.equal(getNativeVoiceURI(), "daniel");
  assert.equal(curatedNativeVoices(voices)[0]?.voiceURI, "daniel");
  assert.equal(selectedNativeVoice(voices)?.voiceURI, "daniel");
}));

test("falls back to the strongest available natural voice", () => withStorage(() => {
  setNativeVoiceURI("missing");
  const voices = [voice("Basic English", "en-US", "basic", true), voice("Samantha Enhanced", "en-US", "samantha")];
  assert.equal(selectedNativeVoice(voices)?.voiceURI, "samantha");
}));

test("keeps the optional Sulafat output separate from the chosen device voice", () => withStorage(() => {
  setNativeVoiceURI("samantha");
  setVoiceOutputMode("sulafat");
  assert.equal(getVoiceOutputMode(), "sulafat");
  assert.equal(getNativeVoiceURI(), "samantha");
  setVoiceOutputMode("device");
  assert.equal(getVoiceOutputMode(), "device");
}));
