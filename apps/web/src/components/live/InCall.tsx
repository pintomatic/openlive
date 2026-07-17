"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { AudioLines, Mic, MicOff, Video, VideoOff, ScreenShare, ScreenShareOff, ChevronUp, Minimize2, PanelRightOpen } from "lucide-react";
import { useLiveStore, type LivePhase, type DeviceOpt } from "@/lib/live/liveStore";
import type { VoiceInputMode } from "@/lib/live/voiceEngine";
import { toolMeta } from "@/lib/live/toolMeta";
import { useUi } from "@/lib/uiStore";
import { Orb } from "./Orb";
import { CameraPiP } from "./CameraPiP";
import { ScreenTile } from "./ScreenTile";
import { EndCallButton } from "./EndCallButton";
import { TranscriptPanel } from "./TranscriptPanel";
import { TopBar } from "./TopBar";
import { cn } from "@/lib/cn";

const PHASE_LABEL: Record<LivePhase, string> = {
  off: "", connecting: "Connecting…", loading: "Preparing…", reconnecting: "Reconnecting…",
  idle: "Listening", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking",
};

export interface InCallProps {
  chatId: string; phase: LivePhase; muted: boolean;
  inputMode: VoiceInputMode; pushActive: boolean;
  cameraOn: boolean; screenOn: boolean; cameraStream: MediaStream | null; screenStream: MediaStream | null; error?: string;
  toggleMute: () => void;
  setInputMode: (mode: VoiceInputMode) => void; togglePushToTalk: () => void;
  toggleCamera: () => void | Promise<void>; toggleScreen: () => void | Promise<void>;
  setMic: (id: string) => void; setCam: (id: string) => void;
  getLevels: () => { mic: number; agent: number };
  getBands: () => { mic: number[]; agent: number[] };
  onEnd: () => void;
}

export function InCall(props: InCallProps) {
  const { chatId, phase, muted, inputMode, pushActive, cameraOn, screenOn, cameraStream, screenStream, error,
    toggleMute, setInputMode, togglePushToTalk, toggleCamera, toggleScreen, setMic, setCam, getLevels, getBands, onEnd } = props;
  const { userCaption, userPartial, agentCaption, agentCaptionMs, toolStatus, warming, mics, cams, micId, camId } = useLiveStore();
  const setMinimized = useUi((s) => s.setMinimized);
  const reduce = useReducedMotion();
  const sharing = cameraOn || screenOn; // orb shrinks into the bar while a visual source is on

  // Transcript sidebar: resizable width + open/closed, both remembered.
  const [panelOpen, setPanelOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    const saved = localStorage.getItem("ol-transcript-open-v2");
    return saved == null ? window.innerWidth >= 768 : saved !== "0";
  });
  const [panelW, setPanelW] = useState(() => {
    if (typeof window === "undefined") return 360;
    const v = Number(localStorage.getItem("ol-transcript-w"));
    return v >= 280 && v <= 640 ? v : 360;
  });
  useEffect(() => { localStorage.setItem("ol-transcript-open-v2", panelOpen ? "1" : "0"); }, [panelOpen]);
  useEffect(() => { localStorage.setItem("ol-transcript-w", String(panelW)); }, [panelW]);

  const [agentWindow, setAgentWindow] = useState("");
  useEffect(() => {
    const words = agentCaption.split(/\s+/).filter(Boolean);
    if (words.length <= 5) { setAgentWindow(words.join(" ")); return; }
    const dur = agentCaptionMs > 0 ? agentCaptionMs : words.length * 320;
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const frac = Math.min(1, (performance.now() - start) / dur);
      const idx = Math.max(1, Math.min(words.length, Math.ceil(frac * words.length)));
      setAgentWindow(words.slice(Math.max(0, idx - 5), idx).join(" "));
      if (frac < 1) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [agentCaption, agentCaptionMs]);

  // Just the WORDS — what you're saying (interim) or what the agent is saying. The
  // live state is shown ONCE, by the status label below (no duplicate "Listening").
  const words = userPartial && userCaption
    ? <span className="italic text-muted-foreground">{userCaption}</span>
    : agentCaption
      ? <span className="font-medium text-foreground">{agentWindow || agentCaption}</span>
      : null;

  // Status line: a live tool cue while a tool runs, "Warming up…" right after
  // connecting (both blue shimmer), otherwise the plain phase label.
  const statusLabel = toolStatus ? `${toolMeta(toolStatus).active}…` : warming ? "Warming up…" : inputMode === "push-to-talk" && phase === "idle" ? "Ready" : PHASE_LABEL[phase];
  const statusBusy = !!toolStatus || warming;

  return (
    <div className={cn("fixed inset-0 z-40 flex flex-col bg-surface", !reduce && "animate-live-in")}>
      <TopBar />

      <div className="flex min-h-0 flex-1">
        {/* stage — orb hero, floating tiles, control bar */}
        <main className="relative min-w-0 flex-1 overflow-hidden bg-surface">
          {!sharing && (
            <div className="pointer-events-none absolute inset-0 flex flex-col px-5 pb-24 pt-4 sm:px-8 sm:pt-6">
              <div className="mx-auto flex w-full max-w-3xl items-center justify-between border-b border-border pb-3 text-[10px] font-medium uppercase text-muted-foreground">
                <span>Kernal session</span>
                <span className={cn("flex items-center gap-2", statusBusy && "arc-shimmer")}><span className="size-1.5 rounded-full bg-success" />{statusLabel}</span>
              </div>
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-4">
                <div className="scale-[0.82] sm:scale-100"><Orb phase={phase} getLevels={getLevels} getBands={getBands} size={220} /></div>
              </div>
              <div className="mx-auto w-full max-w-3xl border-t border-border pt-4">
                <p className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Live response</p>
                <p className="min-h-[50px] max-w-2xl text-left text-[18px] leading-snug sm:text-[20px]" aria-live="polite">
                  {words ?? <span className="text-muted-foreground">Listening for you</span>}
                </p>
              </div>
            </div>
          )}

          {cameraOn && <CameraPiP stream={cameraStream} />}
          {screenOn && <ScreenTile stream={screenStream} />}

          {error && <p className="absolute inset-x-0 top-3 mx-auto max-w-md px-6 text-center text-[12.5px] text-danger">{error}</p>}

          {!panelOpen && (
            <button onClick={() => setPanelOpen(true)} title="Show transcript" aria-label="Show transcript"
              className="absolute right-4 top-4 z-20 grid size-9 place-items-center rounded-md border border-border bg-background text-muted-foreground shadow-sm transition hover:text-foreground">
              <PanelRightOpen className="size-4" />
            </button>
          )}

          {/* Status pill (orb + caption) while sharing — floats ABOVE the control bar
              so toggling a screen/camera share never resizes the bar itself. */}
          {sharing && (
            <div className="absolute bottom-[88px] left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 shadow-lg">
              <Orb phase={phase} getLevels={getLevels} getBands={getBands} size={26} />
              <span className="max-w-[260px] truncate text-[12.5px]" aria-live="polite">
                {words ?? <span className={cn(statusBusy ? "arc-shimmer font-medium" : "text-muted-foreground")}>{statusLabel}</span>}
              </span>
            </div>
          )}

          {/* control bar — a stable width regardless of sharing */}
          <div className="absolute inset-x-0 bottom-0 z-20 border-t border-border bg-background px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 shadow-[0_-10px_30px_-24px_rgba(0,0,0,0.5)]">
            <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-1">
              <ModeSwitch mode={inputMode} onChange={setInputMode} />
              {inputMode === "conversation" ? (
                <ControlWithMenu on={!muted} icon={muted ? MicOff : Mic} danger={muted} title={muted ? "Resume conversation" : "Pause conversation"} onClick={toggleMute}
                  devices={mics} activeId={micId} onPick={setMic} label="Microphone" />
              ) : (
                <IconBtn on={pushActive} title={pushActive ? "Send" : "Talk"} onClick={togglePushToTalk} icon={Mic} />
              )}
              <ControlWithMenu on={cameraOn} icon={cameraOn ? Video : VideoOff} title={cameraOn ? "Turn camera off" : "Turn camera on"} onClick={() => void toggleCamera()}
                devices={cams} activeId={camId} onPick={setCam} label="Camera" />
              <IconBtn on={screenOn} title={screenOn ? "Stop sharing screen" : "Share screen"} onClick={() => void toggleScreen()} icon={screenOn ? ScreenShareOff : ScreenShare} />
              <span className="mx-0.5 h-6 w-px bg-border" />
              <IconBtn on={false} title="Minimize to floating bar" onClick={() => setMinimized(true)} icon={Minimize2} />
              <EndCallButton onEnd={onEnd} size="size-10" />
            </div>
          </div>
        </main>

        {/* transcript sidebar — resizable + collapsible */}
        {panelOpen && <TranscriptPanel chatId={chatId} width={panelW} onResize={setPanelW} onClose={() => setPanelOpen(false)} />}
      </div>
    </div>
  );
}

function ModeSwitch({ mode, onChange }: { mode: VoiceInputMode; onChange: (mode: VoiceInputMode) => void }) {
  return (
    <div className="flex h-10 items-center rounded-md bg-surface p-0.5" role="group" aria-label="Voice mode">
      <button type="button" title="Conversation mode" aria-label="Conversation mode" aria-pressed={mode === "conversation"}
        onClick={() => onChange("conversation")}
        className={cn("grid size-9 place-items-center rounded-md transition", mode === "conversation" ? "bg-background text-foreground shadow-sm" : "text-faint hover:text-muted-foreground")}>
        <AudioLines className="size-4" />
      </button>
      <button type="button" title="Push-to-talk mode" aria-label="Push-to-talk mode" aria-pressed={mode === "push-to-talk"}
        onClick={() => onChange("push-to-talk")}
        className={cn("grid size-9 place-items-center rounded-md transition", mode === "push-to-talk" ? "bg-background text-foreground shadow-sm" : "text-faint hover:text-muted-foreground")}>
        <Mic className="size-4" />
      </button>
    </div>
  );
}

function IconBtn({ on, title, onClick, icon: Icon, danger }: { on: boolean; title: string; onClick: () => void; icon: typeof Mic; danger?: boolean }) {
  return (
    <button onClick={onClick} title={title} aria-label={title} aria-pressed={on}
      className={cn("grid size-10 place-items-center rounded-md transition hover:bg-surface",
        danger ? "text-danger" : on ? "text-foreground" : "text-muted-foreground")}>
      <Icon className="size-4" />
    </button>
  );
}

function ControlWithMenu({ on, icon, title, onClick, danger, devices, activeId, onPick, label }: {
  on: boolean; icon: typeof Mic; title: string; onClick: () => void; danger?: boolean;
  devices: DeviceOpt[]; activeId?: string; onPick: (id: string) => void; label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div ref={ref} className="relative flex items-center">
      <IconBtn on={on} title={title} onClick={onClick} icon={icon} danger={danger} />
      {devices.length > 0 && (
        <button onClick={() => setOpen((o) => !o)} aria-label={`Choose ${label}`}
          className="-ml-1 grid size-5 place-items-center rounded-full text-faint transition hover:text-foreground">
          <ChevronUp className={cn("size-3.5 transition", open && "rotate-180")} />
        </button>
      )}
      {open && (
        <div className="absolute bottom-11 left-0 z-50 w-60 overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-xl">
          <div className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">{label}</div>
          {devices.map((d) => (
            <button key={d.id} onClick={() => { onPick(d.id); setOpen(false); }}
              className={cn("block w-full truncate px-3 py-1.5 text-left text-[12.5px] transition hover:bg-foreground/[0.06]",
                d.id === activeId ? "text-foreground" : "text-muted-foreground")}>
              {d.id === activeId ? "✓ " : "   "}{d.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
