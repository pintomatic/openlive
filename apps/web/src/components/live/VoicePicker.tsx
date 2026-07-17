"use client";

import { useEffect, useState } from "react";
import { Play, Volume2 } from "lucide-react";
import { curatedNativeVoices, getNativeVoiceURI, selectedNativeVoice, setNativeVoiceURI, voiceLabel } from "@/lib/live/voicePreferences";

export function VoicePicker() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selected, setSelected] = useState("");

  useEffect(() => {
    const refresh = () => {
      const next = curatedNativeVoices(speechSynthesis.getVoices());
      setVoices(next);
      setSelected(getNativeVoiceURI() || next[0]?.voiceURI || "");
    };
    refresh();
    speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => speechSynthesis.removeEventListener("voiceschanged", refresh);
  }, []);

  const choose = (uri: string) => { setSelected(uri); setNativeVoiceURI(uri); };
  const preview = () => {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance("Ready when you are. What should we work on next?");
    const voice = selectedNativeVoice(speechSynthesis.getVoices().filter((item) => !selected || item.voiceURI === selected));
    if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
    speechSynthesis.speak(utterance);
  };

  if (!voices.length) return null;
  return (
    <div className="flex w-full items-center gap-2">
      <Volume2 className="size-4 shrink-0 text-muted-foreground" />
      <label className="sr-only" htmlFor="openlive-voice">Assistant voice</label>
      <select id="openlive-voice" value={selected} onChange={(event) => choose(event.target.value)}
        className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface px-2.5 py-2 text-[12px] text-foreground">
        {voices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voiceLabel(voice)}</option>)}
      </select>
      <button type="button" onClick={preview} title="Preview voice" aria-label="Preview voice"
        className="grid size-9 shrink-0 place-items-center rounded-md border border-border text-muted-foreground transition hover:bg-foreground/[0.06] hover:text-foreground">
        <Play className="size-4" />
      </button>
    </div>
  );
}
