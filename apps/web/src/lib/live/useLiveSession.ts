"use client";

import { useCallback, useRef } from "react";
import { chatStore } from "@/lib/chatStore";
import { LiveClient } from "./liveClient";
import { CameraCapture } from "./cameraCapture";
import { AudioPlayer } from "./audioPlayback";
import { VoiceEngine, type EnginePhase, type VoiceEngineHandlers, type VoiceInputMode } from "./voiceEngine";
import { NativeVoiceEngine, nativeVoiceAvailable, preferNativeVoice, primeNativeSpeech } from "./nativeVoiceEngine";
import { loadModels, modelsReady, modelsCached } from "./models";
import { useLiveStore } from "./liveStore";

const NO_BANDS = [0, 0, 0, 0, 0];

function abToBase64(ab: ArrayBuffer): string {
  const bytes = new Uint8Array(ab);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

// Orchestrates one live call. THICK CLIENT: the VoiceEngine runs VAD+STT+TTS
// on-device; this hook wires it to the /live socket (final text + camera frames
// + cancel), the camera, and the chat store, and owns a single leak-proof
// teardown that every close path routes through.
export function useLiveSession(chatId: string) {
  const set = useLiveStore((s) => s.set);
  const client = useRef<LiveClient | null>(null);
  const engine = useRef<VoiceEngine | NativeVoiceEngine | null>(null);
  const nativeFallback = useRef(false);
  const player = useRef<AudioPlayer | null>(null);
  const camRef = useRef<CameraCapture | null>(null);
  const screenRef = useRef<CameraCapture | null>(null);
  const micStream = useRef<MediaStream | null>(null);
  const assistantId = useRef<string | null>(null);
  const tornDown = useRef(false);
  const onVisibility = useRef<() => void>(() => {});
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  // Word-by-word transcript reveal, synced to the VOICE (not the generated stream):
  // `segText` = chunks of the CURRENT segment already voiced, `curChunk` = the one
  // revealing now, `revealRaf` = its frame. Tool activity is shown LIVE on tool_start
  // (see the onSse handler), not buffered.
  const segText = useRef("");
  const curChunk = useRef<string | null>(null);
  const revealRaf = useRef<number | null>(null);
  const stopReveal = () => { if (revealRaf.current != null) { cancelAnimationFrame(revealRaf.current); revealRaf.current = null; } };
  const resetTranscript = () => { stopReveal(); segText.current = ""; curChunk.current = null; };

  const releaseWakeLock = useCallback(() => {
    const current = wakeLock.current;
    wakeLock.current = null;
    if (current) void current.release().catch(() => {});
  }, []);
  const acquireWakeLock = useCallback(async () => {
    if (document.visibilityState !== "visible" || wakeLock.current) return;
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } };
    try { wakeLock.current = await nav.wakeLock?.request("screen") ?? null; } catch { wakeLock.current = null; }
  }, []);

  // ── single teardown authority — releases EVERYTHING, always ───────────────
  const teardown = useCallback(() => {
    if (tornDown.current) return;
    tornDown.current = true;
    stopReveal();
    document.removeEventListener("visibilitychange", onVisibility.current);
    releaseWakeLock();
    try { client.current?.close(); } catch { /* */ }
    try { engine.current?.stop(); } catch { /* */ }              // destroys VAD + closes audio
    try { player.current?.close(); } catch { /* */ }             // free the audio ctx (also if start() failed before the engine)
    player.current = null;
    try { camRef.current?.stop(); } catch { /* */ }              // camera light off
    try { screenRef.current?.stop(); } catch { /* */ }             // stop screen share
    if (micStream.current) { micStream.current.getTracks().forEach((t) => t.stop()); micStream.current = null; }
    if (assistantId.current) { chatStore.liveFinish(chatId, assistantId.current); assistantId.current = null; }
    // The on-device voice worker is left running on purpose — kept warm for the
    // tab's lifetime so reopening Live is instant (no re-download / shader recompile).
    client.current = null; engine.current = null; camRef.current = null; screenRef.current = null;
    // Keep `error` so the user sees why it ended; start() clears it next time.
    set({ active: false, phase: "off", downloading: false, downloadPct: 0, cameraOn: false, screenOn: false, muted: false, pushActive: false, cameraStream: null, screenStream: null, userCaption: "", userPartial: false, agentCaption: "", toolStatus: "", warming: false });
  }, [chatId, releaseWakeLock, set]);

  const start = useCallback(async () => {
    tornDown.current = false;
    // Must happen before the first await: iOS grants speech playback from this tap.
    primeNativeSpeech();
    set({ error: undefined, phase: "connecting", active: true, downloadPct: 0, userCaption: "", userPartial: false, agentCaption: "", toolStatus: "" });
    // Unlock audio NOW, synchronously inside the click gesture. iOS Safari blocks
    // AudioContext playback that starts after an await, so priming here (before the
    // model download) is what lets the agent's voice actually play on iPhone.
    if (!player.current) player.current = new AudioPlayer();
    player.current.resume();
    try {
      // 1. Models (download-on-demand, cached). Shows a progress bar the first time.
      // If Hugging Face's model bridge refuses the artifacts, keep the call usable
      // with native browser STT/TTS so provider testing is not blocked.
      let nativeVoice = nativeFallback.current || preferNativeVoice();
      if (nativeVoice) nativeFallback.current = true;
      if (!nativeVoice && !modelsReady()) {
        set({ phase: "loading" });
        try {
          await loadModels((p) => set({ downloadPct: p.pct, downloadLoaded: p.loaded, downloadTotal: p.total, downloadModels: p.models }));
        } catch (err: any) {
          if (!nativeVoiceAvailable()) throw err;
          nativeVoice = true;
          nativeFallback.current = true;
          try { sessionStorage.setItem("openlive-native-voice-fallback", "1"); } catch { /* */ }
          set({ error: "On-device voice models could not download, using browser voice for this test." });
        }
      }
      if (tornDown.current) return;

      // 2. Mic stream — chosen device + browser AEC (so the agent's own voice is
      //    cancelled from the mic and can't self-trigger barge-in).
      const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
      const micId = useLiveStore.getState().micId;
      if (micId) audio.deviceId = { exact: micId };
      const stream = await navigator.mediaDevices.getUserMedia({ audio });
      micStream.current = stream;
      if (tornDown.current) { stream.getTracks().forEach((t) => t.stop()); return; }

      // 3. Voice engine.
      const voiceHandlers: VoiceEngineHandlers = {
        // Entering "listening" clears the previous answer's caption so the user
        // sees themselves (or "Listening…") the moment they start talking.
        onPhase: (p: EnginePhase) => set(p === "listening" ? { phase: p, agentCaption: "", toolStatus: "" } : { phase: p }),
        onPartial: (text) => set({ userCaption: text, userPartial: true, warming: false }),
        onUserText: (text) => void handleUserText(text),
        // A chunk just STARTED voicing. Drive TWO things from it: the composer
        // subtitle (rolling 3-4 word window — VoiceBar reads agentCaption) AND the
        // chat transcript, which types this chunk word-by-word in lockstep with the
        // audio so the panel shows exactly what's been said (honest on barge-in).
        onAgentText: (sentence, durationMs) => {
          set({ agentCaption: sentence, agentCaptionMs: durationMs });
          const id = assistantId.current;
          // The previous chunk's audio has finished (this one is now playing) — commit
          // it into the current segment.
          if (curChunk.current) segText.current = segText.current ? `${segText.current} ${curChunk.current}` : curChunk.current;
          curChunk.current = sentence;
          stopReveal();
          if (!id) return;
          const words = sentence.split(/\s+/).filter(Boolean);
          const base = segText.current;
          const dur = durationMs > 0 ? durationMs : words.length * 320;
          const startedAt = performance.now();
          const step = () => {
            if (id !== assistantId.current) return; // turn moved on
            const frac = Math.min(1, (performance.now() - startedAt) / dur);
            const idx = Math.max(1, Math.min(words.length, Math.ceil(frac * words.length)));
            const revealed = words.slice(0, idx).join(" ");
            chatStore.liveText(chatId, id, base ? `${base} ${revealed}` : revealed);
            if (frac < 1) revealRaf.current = requestAnimationFrame(step);
            else revealRaf.current = null;
          };
          step();
        },
        // Barge-in: cancel the server turn AND drop the stale caption immediately,
        // so interrupting gives instant "I'm listening" feedback.
        onBargeIn: (spoken) => {
          client.current?.cancel(spoken);
          // Truncate the assistant node to what was actually spoken — the server
          // persists the same cutoff, so the panel and the saved history agree.
          // Stop the in-flight word reveal and snap the transcript to `spoken`
          // (the engine's authoritative, sentence-granular cutoff).
          stopReveal();
          set({ toolStatus: "" });
          // Keep what's already revealed (voice-synced ≈ what was spoken); just stop
          // advancing. Commit the current chunk so the next turn starts clean.
          if (curChunk.current) segText.current = segText.current ? `${segText.current} ${curChunk.current}` : curChunk.current;
          curChunk.current = null;
          set({ agentCaption: "", userCaption: "", userPartial: false });
        },
        onError: (message) => set({ error: message }),
      };
      const eng = nativeVoice
        ? new NativeVoiceEngine(voiceHandlers)
        : new VoiceEngine(voiceHandlers, player.current ?? undefined);
      engine.current = eng;
      await eng.start(stream);
      eng.setInputMode(useLiveStore.getState().inputMode);
      if (tornDown.current) return;

      // 4. Socket. Phase stays "connecting" until the socket actually opens — no
      //    more optimistic "Listening" that lies when the connection never lands.
      set({ phase: "connecting" });
      const c = new LiveClient({
        onOpen: () => { set({ phase: "idle", error: undefined, warming: true }); void acquireWakeLock(); },
        onReconnecting: () => set({ phase: "reconnecting" }),
        onClose: () => teardown(),
        onError: (m) => {
          set({ error: m });
          // A delivery or provider error must release native speech recognition
          // from its waiting state; otherwise iOS stays on "Thinking" forever.
          if (useLiveStore.getState().phase === "thinking") engine.current?.endAgentTurn();
        },
        onSse: (e) => {
          if (e.type === "error") { set({ error: e.message }); return; }
          // Warm-up done → drop the "Warming up…" spinner; the first turn is now hot.
          if (e.type === "status") { if (e.text === "ready") set({ warming: false }); return; }
          // Prose text drives the VOICE only; the chat transcript is filled word-by-word
          // as each chunk is spoken (onAgentText), NOT from the generated stream (which
          // races ahead) — so an interrupt leaves the panel showing only what was said.
          if (e.type === "text_delta") { engine.current?.feedAgentDelta(e.text); return; }
          // Reasoning streams into the transcript's work block (interleaved with tools).
          if (e.type === "reasoning_delta") { if (assistantId.current) chatStore.liveReason(chatId, assistantId.current, e.text); return; }
          if (e.type === "done") {
            set({ toolStatus: "" });
            engine.current?.endAgentTurn();
            // Finish the spoken turn but KEEP assistantId pointing at it, so any
            // trailing event still attaches. It rolls forward on the next user turn
            // (handleUserText) and is finalized on teardown.
            if (assistantId.current) chatStore.liveFinish(chatId, assistantId.current);
            return;
          }
          // Show tool activity LIVE — the moment it starts — so the user gets a real
          // cue (transcript chip + the "Searching the web…" subtitle) WHILE it runs,
          // not bundled in after the answer. toolStatus drives the in-call status line.
          if (e.type === "tool_start") {
            set({ toolStatus: e.tool });
            if (assistantId.current) chatStore.liveEvent(chatId, assistantId.current, e);
            return;
          }
          if (e.type === "tool_done") {
            set({ toolStatus: "" });
            if (assistantId.current) chatStore.liveEvent(chatId, assistantId.current, e);
            return;
          }
        },
        onNeedFrame: async (reqId) => {
          const st = useLiveStore.getState();
          const src = st.cameraOn ? camRef.current : st.screenOn ? screenRef.current : null;
          if (!src) { client.current?.frameResponse(reqId); return; }
          const jpeg = await src.captureHiRes();
          client.current?.frameResponse(reqId);   // server arms for the look frame FIRST
          if (jpeg) client.current?.sendFrame(jpeg);
        },
        // OS bridge (clipboard / open_url) — runs through the Electron main process.
        // On the web build there's no bridge, so we answer instantly (no dead air).
        onToolBridge: async (reqId, op, arg) => {
          const api = (window as unknown as { openlive?: { bridge?: (op: string, arg?: string) => Promise<string> } }).openlive;
          if (!api?.bridge) { client.current?.toolBridgeResult(reqId, "That's only available in the OpenLive desktop app."); return; }
          try { client.current?.toolBridgeResult(reqId, await api.bridge(op, arg)); }
          catch (e: any) { client.current?.toolBridgeResult(reqId, `Couldn't do that: ${String(e?.message ?? e)}`); }
        },
      });
      client.current = c;
      c.connect(chatId);

      onVisibility.current = () => {
        if (document.visibilityState === "hidden") {
          client.current?.suspend();
          releaseWakeLock();
          return;
        }
        void fetch("/auth/status", { cache: "no-store" }).then(async (response) => {
          if (!response.ok) return;
          const auth = await response.json();
          if (auth.enabled && !auth.authenticated) { window.location.reload(); return; }
          client.current?.resume();
          if (!useLiveStore.getState().muted) engine.current?.setMuted(false);
          void acquireWakeLock();
        }).catch(() => { client.current?.resume(); void acquireWakeLock(); });
      };
      document.addEventListener("visibilitychange", onVisibility.current);
      await refreshDevices();
    } catch (e: any) {
      const denied = e?.name === "NotAllowedError" || e?.name === "SecurityError";
      set({ error: denied ? "Microphone access denied. Allow the mic and try again." : `Couldn't start live mode: ${String(e?.message ?? e)}` });
      teardown();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acquireWakeLock, chatId, releaseWakeLock, set, teardown]);

  // A completed user turn: attach the freshest camera frame, send the text, and
  // reflect the exchange in the chat store (so it renders + persists like typing).
  const handleUserText = useCallback(async (text: string) => {
    // Attach the freshest frame from every active visual source (camera + screen
    // can both be on), inline with the turn so the model sees exactly this moment.
    const st0 = useLiveStore.getState();
    const frames: { data: string; mime: string; source: "camera" | "screen" }[] = [];
    if (st0.cameraOn && camRef.current) { const j = await camRef.current.captureFreshest(); if (j) frames.push({ data: abToBase64(j), mime: "image/jpeg", source: "camera" }); }
    if (st0.screenOn && screenRef.current) { const j = await screenRef.current.captureFreshest(); if (j) frames.push({ data: abToBase64(j), mime: "image/jpeg", source: "screen" }); }
    client.current?.userText(text, frames);
    set({ userCaption: "", userPartial: false, agentCaption: "" });
    if (assistantId.current) chatStore.liveFinish(chatId, assistantId.current);
    resetTranscript(); // new turn → the word reveal starts fresh (don't carry prior spoken text)
    assistantId.current = chatStore.liveUserTurn(chatId, text);
  }, [chatId, set]);

  // Explicit, user-initiated model download (pre-call). Nothing downloads until
  // the user asks — and because the worker stays warm, this only happens once.
  const download = useCallback(async () => {
    if (preferNativeVoice()) {
      nativeFallback.current = true;
      try { sessionStorage.setItem("openlive-native-voice-fallback", "1"); } catch { /* */ }
      set({ modelsDownloaded: true, downloading: false, error: undefined });
      return;
    }
    if (modelsReady()) { set({ modelsDownloaded: true }); return; }
    set({ downloading: true, downloadPct: 0, error: undefined });
    try {
      await loadModels((p) => set({ downloadPct: p.pct, downloadLoaded: p.loaded, downloadTotal: p.total, downloadModels: p.models }));
      set({ modelsDownloaded: true, downloading: false });
    } catch (e: any) {
      if (nativeVoiceAvailable()) {
        nativeFallback.current = true;
        try { sessionStorage.setItem("openlive-native-voice-fallback", "1"); } catch { /* */ }
        set({
          modelsDownloaded: true,
          downloading: false,
          error: `On-device AI models could not download, but browser voice is available for testing: ${String(e?.message ?? e)}`,
        });
        return;
      }
      set({ downloading: false, error: `Couldn't download the AI models: ${String(e?.message ?? e)}` });
    }
  }, [set]);

  const refreshDevices = useCallback(async () => {
    // Cached (from a prior session's Cache-API weights) counts as "downloaded" so
    // the pre-call screen never re-asks after a refresh. If cached but the worker
    // isn't warm in THIS page, silently pre-load it in the background so hitting
    // start is instant — no visible progress bar (it reads from cache, fast).
    let rememberedNative = preferNativeVoice();
    try { rememberedNative ||= sessionStorage.getItem("openlive-native-voice-fallback") === "1" && nativeVoiceAvailable(); } catch { /* */ }
    nativeFallback.current = rememberedNative;
    const cached = modelsCached();
    set({ modelsDownloaded: rememberedNative || cached || modelsReady() });
    if (cached && !rememberedNative && !modelsReady()) void loadModels(() => {}).catch(() => {});
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      set({
        mics: devs.filter((d) => d.kind === "audioinput").map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` })),
        cams: devs.filter((d) => d.kind === "videoinput").map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` })),
      });
    } catch { /* enumerate not available */ }
  }, [set]);

  const stop = useCallback(() => teardown(), [teardown]);

  const toggleMute = useCallback(() => {
    const next = !useLiveStore.getState().muted;
    engine.current?.setMuted(next);
    set({ muted: next });
  }, [set]);

  const setInputMode = useCallback((mode: VoiceInputMode) => {
    engine.current?.setInputMode(mode);
    if (mode === "conversation") engine.current?.setMuted(false);
    set({ inputMode: mode, pushActive: false, muted: false, userCaption: "", userPartial: false });
  }, [set]);

  const togglePushToTalk = useCallback(() => {
    if (useLiveStore.getState().inputMode !== "push-to-talk") return;
    const next = !useLiveStore.getState().pushActive;
    if (next) engine.current?.beginPushToTalk();
    else engine.current?.endPushToTalk();
    set({ pushActive: next });
  }, [set]);

  // Change the mic — live if a call is active (rebuild the stream + VAD), else it
  // just applies on the next start.
  const setMic = useCallback(async (id: string) => {
    set({ micId: id });
    if (!useLiveStore.getState().active || !engine.current) return;
    try {
      const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, deviceId: { exact: id } };
      const stream = await navigator.mediaDevices.getUserMedia({ audio });
      const old = micStream.current;
      micStream.current = stream;
      await engine.current.setStream(stream);
      old?.getTracks().forEach((t) => t.stop()); // stop the previous mic only after the swap
    } catch { set({ error: "Couldn't switch microphone." }); }
  }, [set]);

  const setCam = useCallback(async (id: string) => {
    set({ camId: id });
    if (camRef.current && useLiveStore.getState().cameraOn) {
      camRef.current.stop();
      const c = new CameraCapture();
      camRef.current = c;
      try { await c.start(id); set({ cameraStream: c.getStream() ?? null }); }
      catch { camRef.current = null; set({ error: "Couldn't switch camera.", cameraStream: null }); }
    }
  }, [set]);

  const toggleCamera = useCallback(async () => {
    const on = !useLiveStore.getState().cameraOn;
    if (on) {
      const camera = new CameraCapture();
      camRef.current = camera;
      try {
        await camera.start(useLiveStore.getState().camId);
        await refreshDevices();
      } catch {
        try { camera.stop(); } catch { /* */ }
        camRef.current = null;
        set({ error: "Camera access denied." });
        return;
      }
      client.current?.control("camera_on");
      set({ cameraOn: true, cameraStream: camera.getStream() ?? null });
    } else {
      client.current?.control("camera_off");
      camRef.current?.stop();
      camRef.current = null;
      set({ cameraOn: false, cameraStream: null });
    }
  }, [set, refreshDevices]);

  // Share a screen/window — independent of the camera (both can be on). The
  // model sees the shared screen through the same inline-frame pipeline.
  const toggleScreen = useCallback(async () => {
    const on = !useLiveStore.getState().screenOn;
    if (on) {
      const cap = new CameraCapture();
      screenRef.current = cap;
      try {
        await cap.startScreen(() => {
          client.current?.control("screen_off");
          try { screenRef.current?.stop(); } catch { /* */ }
          screenRef.current = null;
          set({ screenOn: false, screenStream: null });
        });
      } catch {
        try { cap.stop(); } catch { /* */ }
        screenRef.current = null;
        set({ error: "Screen share was cancelled." });
        return;
      }
      client.current?.control("screen_on");
      set({ screenOn: true, screenStream: cap.getStream() ?? null });
    } else {
      client.current?.control("screen_off");
      screenRef.current?.stop();
      screenRef.current = null;
      set({ screenOn: false, screenStream: null });
    }
  }, [set]);

  const getLevels = useCallback(() => ({ mic: engine.current?.micLevel() ?? 0, agent: engine.current?.agentLevel() ?? 0 }), []);
  // Per-frequency-band energy (0..1) of the live voice — drives the orb's real
  // reactive spectrum while you or the agent talk.
  const getBands = useCallback(() => ({ mic: engine.current?.micBands() ?? NO_BANDS, agent: engine.current?.agentBands() ?? NO_BANDS }), []);

  return { start, stop, download, toggleMute, toggleCamera, toggleScreen, setInputMode, togglePushToTalk, getLevels, getBands, refreshDevices, setMic, setCam };
}
