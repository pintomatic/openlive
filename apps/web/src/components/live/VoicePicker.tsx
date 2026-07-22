"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Volume2 } from "lucide-react";
import { AudioPlayer } from "@/lib/live/audioPlayback";
import { SULAFAT_VOICE_ID, streamSulafat } from "@/lib/live/geminiTts";
import {
  curatedNativeVoices,
  getNativeVoiceURI,
  getVoiceOutputMode,
  selectedNativeVoice,
  setNativeVoiceURI,
  setVoiceOutputMode,
  voiceLabel,
} from "@/lib/live/voicePreferences";

export function VoicePicker() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selected, setSelected] = useState("");
  const [sulafatAvailable, setSulafatAvailable] = useState(false);
  const previewPlayer = useRef<AudioPlayer | null>(null);
  const previewAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    const refresh = () => {
      const next = curatedNativeVoices(speechSynthesis.getVoices());
      setVoices(next);
      setSelected(getVoiceOutputMode() === "sulafat" ? SULAFAT_VOICE_ID : (getNativeVoiceURI() || next[0]?.voiceURI || ""));
    };
    refresh();
    void fetch("/api/tts", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => setSulafatAvailable(body?.available === true))
      .catch(() => setSulafatAvailable(false));
    speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => {
      speechSynthesis.removeEventListener("voiceschanged", refresh);
      previewAbort.current?.abort();
      previewPlayer.current?.close();
    };
  }, []);

  const choose = (value: string) => {
    setSelected(value);
    if (value === SULAFAT_VOICE_ID) setVoiceOutputMode("sulafat");
    else { setVoiceOutputMode("device"); setNativeVoiceURI(value); }
  };
  const previewDevice = () => {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance("Ready when you are. What should we work on next?");
    const voice = selectedNativeVoice(speechSynthesis.getVoices().filter((item) => !selected || item.voiceURI === selected));
    if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
    speechSynthesis.speak(utterance);
  };
  const preview = () => {
    previewAbort.current?.abort();
    previewPlayer.current?.close();
    if (selected !== SULAFAT_VOICE_ID) { previewDevice(); return; }
    const player = new AudioPlayer();
    const abort = new AbortController();
    previewPlayer.current = player;
    previewAbort.current = abort;
    player.resume();
    void streamSulafat("Ready when you are. What should we work on next?", player, {
      epoch: Date.now(),
      signal: abort.signal,
    }).catch(() => previewDevice());
  };

  if (!voices.length && !sulafatAvailable) return null;
  return (
    <div className="flex w-full items-center gap-2">
      <Volume2 className="size-4 shrink-0 text-muted-foreground" />
      <label className="sr-only" htmlFor="openlive-voice">Assistant voice</label>
      <select id="openlive-voice" value={selected} onChange={(event) => choose(event.target.value)}
        className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface px-2.5 py-2 text-[12px] text-foreground">
        {(sulafatAvailable || selected === SULAFAT_VOICE_ID) && <option value={SULAFAT_VOICE_ID}>Sulafat Natural (Gemini)</option>}
        {voices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voiceLabel(voice)}</option>)}
      </select>
      <button type="button" onClick={preview} title="Preview voice" aria-label="Preview voice"
        className="grid size-9 shrink-0 place-items-center rounded-md border border-border text-muted-foreground transition hover:bg-foreground/[0.06] hover:text-foreground">
        <Play className="size-4" />
      </button>
    </div>
  );
}
