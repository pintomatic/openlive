"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, MessageSquare, Settings2 } from "lucide-react";
import { api } from "@/lib/api";
import { useUi } from "@/lib/uiStore";
import { LiveDock } from "@/components/live/LiveDock";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { OpenLiveMark } from "@/components/OpenLiveMark";
import { OpenLiveBrand } from "@/components/OpenLiveBrand";
import { useAppVersion } from "@/lib/useAppVersion";
import { loadModels, modelsCached, modelsReady } from "@/lib/live/models";

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Resume dropdown: shows saved conversations; picking one resumes it (its context
// rehydrates) and drops into the lobby (where camera/mic/model options live).
function ResumeMenu({ onPick }: { onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: chats = [] } = useQuery({ queryKey: ["chats"], queryFn: api.chats, enabled: open });
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} title="Resume a past conversation"
        className="flex h-12 items-center justify-center gap-2 rounded-md border border-border px-5 text-[14px] text-muted-foreground transition hover:border-border-heavy hover:text-foreground">
        <MessageSquare className="size-4" /> Resume
      </button>
      {open && (
        <div className="absolute left-1/2 z-50 mt-2 w-80 -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover text-left shadow-xl">
          <div className="takt-scroll max-h-80 overflow-y-auto py-1">
            {chats.length === 0 && <p className="px-3 py-5 text-center text-[12.5px] text-faint">No saved conversations yet.</p>}
            {chats.map((c) => (
              <button key={c.id} onClick={() => { setOpen(false); onPick(c.id); }}
                className="block w-full px-3 py-2 text-left transition hover:bg-foreground/[0.05]">
                <div className="truncate text-[13px] text-foreground">{c.title || "Conversation"}</div>
                <div className="text-[11px] text-faint">{relTime(c.createdAt)}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const appVersion = useAppVersion();
  const liveOpen = useUi((s) => s.liveOpen);
  const setLiveOpen = useUi((s) => s.setLiveOpen);
  const openSettings = useUi((s) => s.openSettings);
  const activeChatId = useUi((s) => s.activeChatId);
  const newConversation = useUi((s) => s.newConversation);
  const resumeChat = useUi((s) => s.resumeChat);
  const minimized = useUi((s) => s.minimized);

  // Warm the on-device voice models in the background as soon as the app loads, so
  // opening Live doesn't stall on "Preparing…". Only when the weights are already
  // cached — a fresh install still downloads via the explicit pre-call button (we
  // don't silently pull hundreds of MB on first launch).
  useEffect(() => {
    if (modelsCached() && !modelsReady()) void loadModels(() => {}).catch(() => {});
  }, []);

  const startNew = () => { newConversation(); setLiveOpen(true); };
  const resume = (id: string) => { resumeChat(id); setLiveOpen(true); };

  return (
    <main className="relative z-10 flex min-h-dvh flex-col bg-background text-left">
      {!minimized && (
        <>
          {/* Frameless-window drag handle: a top strip clear of the window controls
              (top-left) and the settings button (top-right). Desktop only (.desktop). */}
          <div className="app-drag fixed left-[90px] right-16 top-0 z-0 h-10" />
          <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-border px-4 pt-[env(safe-area-inset-top)] sm:px-6">
            <OpenLiveBrand />
            <button onClick={openSettings} aria-label="Settings"
              className="grid size-10 place-items-center rounded-md border border-border text-muted-foreground transition hover:bg-surface hover:text-foreground">
              <Settings2 className="size-[18px]" />
            </button>
          </header>

          <section className="relative flex min-h-0 flex-1 bg-surface px-5 py-8 sm:px-8 sm:py-10">
            <div className="mx-auto flex w-full max-w-3xl flex-col">
              <div className="flex items-center justify-between border-b border-border pb-3 text-[11px] font-medium uppercase text-muted-foreground">
                <span>Private workspace</span>
                <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-success" />Ready</span>
              </div>
              <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
                <OpenLiveMark size={136} />
                <h1 className="mt-8 text-[30px] font-semibold sm:text-[34px]">OpenLive</h1>
                <p className="mt-2 text-[13px] text-muted-foreground">Kernal is connected</p>
              </div>
              <div className="border-t border-border pt-3 text-[11px] text-muted-foreground">
                Continuous conversation
              </div>
            </div>
          </section>

          <footer className="shrink-0 border-t border-border bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-6">
            <div className="mx-auto flex w-full max-w-md gap-3">
              <button onClick={startNew}
                className="flex h-12 min-w-0 flex-1 items-center justify-between rounded-md bg-accent px-5 text-[15px] font-medium text-accent-foreground shadow-sm transition hover:opacity-90 active:scale-[0.99]">
                Start conversation <ArrowRight className="size-5" />
              </button>
              <ResumeMenu onPick={resume} />
            </div>
            <div className="mx-auto mt-3 max-w-md text-right text-[10px] text-faint">
              {appVersion ? `v${appVersion}` : "dev"}
            </div>
          </footer>
        </>
      )}

      {liveOpen && <LiveDock key={activeChatId} chatId={activeChatId} onExit={() => setLiveOpen(false)} />}
      {!minimized && <SettingsModal />}
    </main>
  );
}
