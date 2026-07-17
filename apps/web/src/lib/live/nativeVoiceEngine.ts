import type { EnginePhase, VoiceEngineHandlers, VoiceInputMode } from "./voiceEngine";
import { stripMarkdown, SentenceChunker } from "./voiceText";

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

interface SpeechRecognitionErrorEventLike extends Event {
  error?: string;
  message?: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function nativeVoiceAvailable(): boolean {
  return !!recognitionCtor() && typeof window !== "undefined" && "speechSynthesis" in window;
}

export function preferNativeVoice(): boolean {
  if (!nativeVoiceAvailable() || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const phoneOrTablet = /Android|iPhone|iPad|iPod/i.test(ua);
  const iPadDesktopMode = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  return phoneOrTablet || iPadDesktopMode;
}

let primerUtterance: SpeechSynthesisUtterance | null = null;

// iOS may refuse speech queued only after an async model turn. Prime its speech
// queue synchronously inside the user's Start tap, while user activation exists.
export function primeNativeSpeech(): void {
  if (!preferNativeVoice() || typeof speechSynthesis === "undefined") return;
  try {
    speechSynthesis.getVoices();
    speechSynthesis.resume();
    if (primerUtterance) return;
    const primer = new SpeechSynthesisUtterance(".");
    primer.volume = 0;
    primer.rate = 10;
    primer.onend = primer.onerror = () => { primerUtterance = null; };
    primerUtterance = primer;
    speechSynthesis.speak(primer);
  } catch { /* browser speech remains best-effort */ }
}

// Fallback when Hugging Face model artifacts cannot be downloaded. This is not
// the privacy-first OpenLive path: STT/TTS are browser-native services.
export class NativeVoiceEngine {
  private recognition: SpeechRecognitionLike | null = null;
  private phase: EnginePhase = "idle";
  private muted = false;
  private stopped = false;
  private speaking = false;
  private waitingForAgent = false;
  private turnFinished = false;
  private queuedSpeech = 0;
  private utterances = new Set<SpeechSynthesisUtterance>();
  private agentText = "";
  private chunker = new SentenceChunker();
  private inputMode: VoiceInputMode = "conversation";
  private pushActive = false;
  private pushFinal = "";
  private pushInterim = "";
  private pushCommitted = false;
  private pushCommitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private h: VoiceEngineHandlers) {}

  async start(_stream: MediaStream) {
    const Ctor = recognitionCtor();
    if (!Ctor) throw new Error("Browser speech recognition is not available.");
    this.stopped = false;
    const rec = new Ctor();
    rec.continuous = this.inputMode === "conversation";
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (event) => this.onResult(event);
    rec.onerror = (event) => {
      if (this.stopped || event.error === "aborted") return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        this.stopped = true;
        this.h.onError?.("Browser speech recognition was blocked. Allow microphone and speech access, then try again.");
        return;
      }
      if (event.error === "network") {
        this.h.onError?.("Browser speech recognition could not reach its service. Check the connection and try again.");
      }
      if (!this.muted && !this.speaking && !this.waitingForAgent) this.restartSoon();
    };
    rec.onend = () => {
      if (this.inputMode === "push-to-talk" && !this.pushActive) { this.commitPushToTalk(); return; }
      if (!this.stopped && !this.muted && !this.speaking && !this.waitingForAgent) this.restartSoon();
    };
    this.recognition = rec;
    this.setPhase("idle");
    this.startRecognition();
  }

  private onResult(event: SpeechRecognitionEventLike) {
    if (this.muted || this.speaking) return;
    let interim = "";
    let final = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (!r) continue;
      const text = r?.[0]?.transcript?.trim() ?? "";
      if (!text) continue;
      if (r.isFinal) final += `${final ? " " : ""}${text}`;
      else interim += `${interim ? " " : ""}${text}`;
    }
    if (this.inputMode === "push-to-talk") {
      if (this.pushCommitted) return;
      if (final) this.pushFinal += `${this.pushFinal ? " " : ""}${final}`;
      this.pushInterim = interim || this.pushInterim;
      const preview = [this.pushFinal, interim].filter(Boolean).join(" ");
      if (preview) this.h.onPartial(preview);
      if (!this.pushActive && final) this.commitPushToTalk();
      return;
    }
    if (interim) {
      this.setPhase("listening");
      this.h.onPartial(interim);
    }
    if (final) {
      this.h.onPartial("");
      this.setPhase("thinking");
      this.waitingForAgent = true;
      try { this.recognition?.stop(); } catch { /* */ }
      this.h.onUserText(final);
    }
  }

  private startRecognition() {
    if (!this.recognition || this.stopped || this.muted || this.speaking || this.waitingForAgent) return;
    if (this.inputMode === "push-to-talk" && !this.pushActive) return;
    try { this.recognition.start(); } catch { /* already started */ }
  }

  private restartSoon() {
    window.setTimeout(() => this.startRecognition(), 250);
  }

  feedAgentDelta(text: string) {
    this.agentText += text;
    for (const s of this.chunker.push(text)) this.enqueueSpeech(s);
  }

  endAgentTurn() {
    const tail = this.chunker.flush();
    if (tail) this.enqueueSpeech(tail);
    this.agentText = "";
    this.turnFinished = true;
    if (this.queuedSpeech === 0) this.afterSpeech();
  }

  private enqueueSpeech(sentence: string) {
    const spoken = stripMarkdown(sentence).trim();
    if (!spoken || typeof speechSynthesis === "undefined") return;
    try { this.recognition?.stop(); } catch { /* */ }
    this.speaking = true;
    this.setPhase("speaking");
    this.queuedSpeech++;
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = "en-US";
    this.utterances.add(utterance); // iOS WebKit may collect unretained utterances.
    utterance.onstart = () => this.h.onAgentText(spoken, Math.max(800, spoken.length * 45));
    utterance.onend = utterance.onerror = () => {
      this.utterances.delete(utterance);
      this.speechChunkDone();
    };
    speechSynthesis.resume();
    speechSynthesis.speak(utterance);
  }

  private speechChunkDone() {
    this.queuedSpeech = Math.max(0, this.queuedSpeech - 1);
    if (this.turnFinished && this.queuedSpeech === 0) this.afterSpeech();
  }

  private afterSpeech() {
    this.turnFinished = false;
    this.waitingForAgent = false;
    this.utterances.clear();
    this.speaking = false;
    this.setPhase("idle");
    this.startRecognition();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) {
      try { this.recognition?.stop(); } catch { /* */ }
      this.setPhase("idle");
    } else {
      this.startRecognition();
    }
  }

  setInputMode(mode: VoiceInputMode) {
    if (mode === this.inputMode) return;
    this.inputMode = mode;
    this.pushActive = false;
    this.pushFinal = "";
    this.pushInterim = "";
    this.pushCommitted = false;
    if (this.pushCommitTimer) { clearTimeout(this.pushCommitTimer); this.pushCommitTimer = null; }
    if (this.recognition) this.recognition.continuous = mode === "conversation";
    try { this.recognition?.abort(); } catch { /* */ }
    this.h.onPartial("");
    this.setPhase("idle");
    if (mode === "conversation" && !this.muted) this.restartSoon();
  }

  beginPushToTalk() {
    if (this.inputMode !== "push-to-talk" || this.pushActive || this.waitingForAgent) return;
    if (this.speaking) {
      try { speechSynthesis.cancel(); } catch { /* */ }
      this.h.onBargeIn("");
      this.speaking = false;
      this.queuedSpeech = 0;
      this.utterances.clear();
    }
    this.pushFinal = "";
    this.pushInterim = "";
    this.pushCommitted = false;
    this.pushActive = true;
    this.setPhase("listening");
    this.startRecognition();
    this.restartSoon();
  }

  endPushToTalk() {
    if (this.inputMode !== "push-to-talk" || !this.pushActive) return;
    this.pushActive = false;
    try { this.recognition?.stop(); } catch { /* */ }
    if (this.pushCommitTimer) clearTimeout(this.pushCommitTimer);
    this.pushCommitTimer = setTimeout(() => this.commitPushToTalk(), 350);
  }

  private commitPushToTalk() {
    if (this.pushCommitted) return;
    if (this.pushCommitTimer) { clearTimeout(this.pushCommitTimer); this.pushCommitTimer = null; }
    const text = (this.pushFinal || this.pushInterim).trim();
    this.pushFinal = "";
    this.pushInterim = "";
    this.h.onPartial("");
    if (!text) { if (!this.waitingForAgent) this.setPhase("idle"); return; }
    this.pushCommitted = true;
    this.waitingForAgent = true;
    this.setPhase("thinking");
    this.h.onUserText(text);
  }

  async setStream(stream: MediaStream) {
    try { this.recognition?.abort(); } catch { /* */ }
    this.recognition = null;
    await this.start(stream);
  }

  micLevel() { return this.phase === "listening" ? 0.35 : 0; }
  agentLevel() { return this.phase === "speaking" ? 0.35 : 0; }
  micBands(n = 5): number[] { return new Array(n).fill(this.micLevel()); }
  agentBands(n = 5): number[] { return new Array(n).fill(this.agentLevel()); }

  stop() {
    this.stopped = true;
    this.muted = true;
    this.agentText = "";
    this.queuedSpeech = 0;
    this.turnFinished = false;
    this.waitingForAgent = false;
    this.pushActive = false;
    if (this.pushCommitTimer) { clearTimeout(this.pushCommitTimer); this.pushCommitTimer = null; }
    this.utterances.clear();
    try { this.recognition?.abort(); } catch { /* */ }
    try { speechSynthesis.cancel(); } catch { /* */ }
    this.recognition = null;
  }

  private setPhase(p: EnginePhase) {
    if (p !== this.phase) {
      this.phase = p;
      this.h.onPhase(p);
    }
  }
}
