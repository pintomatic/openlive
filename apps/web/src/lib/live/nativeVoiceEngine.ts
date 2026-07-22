import type { EnginePhase, VoiceEngineHandlers, VoiceInputMode } from "./voiceEngine";
import { AudioPlayer } from "./audioPlayback";
import { GeminiTtsError, streamSulafat } from "./geminiTts";
import { perf } from "./perf";
import { stripMarkdown, SentenceChunker } from "./voiceText";
import { getVoiceOutputMode, selectedNativeVoice, type VoiceOutputMode } from "./voicePreferences";

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

// Mobile voice engine. Speech recognition remains browser-native; output is the
// selected device voice or the optional server-proxied Sulafat stream.
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
  private outputMode: VoiceOutputMode;
  private speechEpoch = 0;
  private remoteFailed = false;
  private remoteChain = Promise.resolve();
  private remoteControllers = new Set<AbortController>();

  constructor(private h: VoiceEngineHandlers, private remotePlayer?: AudioPlayer) {
    this.outputMode = getVoiceOutputMode();
  }

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
      perf.turnCommitted(0);
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
    perf.firstToken();
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
    this.queuedSpeech++;
    if (this.outputMode === "sulafat" && this.remotePlayer && !this.remoteFailed) {
      this.enqueueSulafat(spoken, this.speechEpoch);
      return;
    }
    this.speakWithDevice(spoken);
  }

  private speakWithDevice(spoken: string) {
    this.setPhase("speaking");
    const utterance = new SpeechSynthesisUtterance(spoken);
    const voice = selectedNativeVoice();
    if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
    else utterance.lang = "en-US";
    this.utterances.add(utterance); // iOS WebKit may collect unretained utterances.
    utterance.onstart = () => {
      perf.firstAudio();
      this.h.onAgentText(spoken, Math.max(800, spoken.length * 45));
    };
    utterance.onend = utterance.onerror = () => {
      this.utterances.delete(utterance);
      this.speechChunkDone();
    };
    speechSynthesis.resume();
    speechSynthesis.speak(utterance);
  }

  private enqueueSulafat(spoken: string, epoch: number) {
    this.remoteChain = this.remoteChain.then(async () => {
      if (this.stopped || epoch !== this.speechEpoch) { this.speechChunkDone(); return; }
      if (this.remoteFailed || !this.remotePlayer) { this.speakWithDevice(spoken); return; }
      const controller = new AbortController();
      this.remoteControllers.add(controller);
      try {
        const result = await streamSulafat(spoken, this.remotePlayer, {
          epoch,
          signal: controller.signal,
          onFirstAudio: () => {
            if (this.stopped || epoch !== this.speechEpoch) return;
            this.setPhase("speaking");
            perf.firstAudio();
            this.h.onAgentText(spoken, Math.max(800, spoken.length * 45));
          },
        });
        void result.playbackDone.then(() => {
          if (epoch === this.speechEpoch) this.speechChunkDone();
        });
      } catch (error) {
        if (controller.signal.aborted || this.stopped || epoch !== this.speechEpoch) {
          this.speechChunkDone();
          return;
        }
        this.remoteFailed = true;
        if (error instanceof GeminiTtsError && error.audioStarted) {
          this.h.onError?.("Natural voice was interrupted. Continuing with the device voice.");
          await error.playbackDone;
          this.speechChunkDone();
        } else {
          this.h.onError?.("Natural voice is unavailable. Continuing with the device voice.");
          this.speakWithDevice(spoken);
        }
      } finally {
        this.remoteControllers.delete(controller);
      }
    });
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
      this.cancelRemoteSpeech();
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
    perf.turnCommitted(0);
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
    this.cancelRemoteSpeech();
    if (this.pushCommitTimer) { clearTimeout(this.pushCommitTimer); this.pushCommitTimer = null; }
    this.utterances.clear();
    try { this.recognition?.abort(); } catch { /* */ }
    try { speechSynthesis.cancel(); } catch { /* */ }
    this.recognition = null;
  }

  private cancelRemoteSpeech() {
    this.speechEpoch++;
    for (const controller of this.remoteControllers) controller.abort();
    this.remoteControllers.clear();
    this.remotePlayer?.flush(this.speechEpoch);
  }

  private setPhase(p: EnginePhase) {
    if (p !== this.phase) {
      this.phase = p;
      this.h.onPhase(p);
    }
  }
}
