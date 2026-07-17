const STORAGE_KEY = "openlive-native-voice-v1";

const NATURAL_HINTS = ["natural", "premium", "enhanced", "siri", "ava", "samantha", "daniel", "karen", "moira", "serena"];
const LOW_QUALITY_HINTS = ["compact", "novelty", "whisper", "bells", "organ", "zarvox"];

function quality(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase();
  let score = voice.default ? 30 : 0;
  if (/^en([-_]|$)/i.test(voice.lang)) score += 50;
  if (/^en-(us|gb|au|ie|za)$/i.test(voice.lang)) score += 10;
  for (const hint of NATURAL_HINTS) if (name.includes(hint)) score += 20;
  for (const hint of LOW_QUALITY_HINTS) if (name.includes(hint)) score -= 80;
  return score;
}

export function curatedNativeVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const preferred = getNativeVoiceURI();
  return voices
    .filter((voice) => /^en([-_]|$)/i.test(voice.lang) && !LOW_QUALITY_HINTS.some((hint) => voice.name.toLowerCase().includes(hint)))
    .sort((a, b) => (b.voiceURI === preferred ? 1 : 0) - (a.voiceURI === preferred ? 1 : 0) || quality(b) - quality(a) || a.name.localeCompare(b.name))
    .slice(0, 8);
}

export function getNativeVoiceURI(): string {
  try { return localStorage.getItem(STORAGE_KEY) || ""; } catch { return ""; }
}

export function setNativeVoiceURI(uri: string): void {
  try { localStorage.setItem(STORAGE_KEY, uri); } catch { /* private browsing */ }
}

export function selectedNativeVoice(voices = speechSynthesis.getVoices()): SpeechSynthesisVoice | null {
  const selected = getNativeVoiceURI();
  return voices.find((voice) => voice.voiceURI === selected)
    ?? curatedNativeVoices(voices)[0]
    ?? voices.find((voice) => /^en([-_]|$)/i.test(voice.lang))
    ?? null;
}

export function voiceLabel(voice: SpeechSynthesisVoice): string {
  const locale = voice.lang.replace("en-", "");
  return `${voice.name} (${locale})`;
}
