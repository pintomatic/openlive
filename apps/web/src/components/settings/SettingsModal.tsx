"use client";

import { useRef, useState } from "react";
import { Settings2, ShieldCheck, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useUi } from "@/lib/uiStore";
import { useAppVersion } from "@/lib/useAppVersion";
import { ModelsSettings } from "./ModelsSettings";
import { AccessSettings } from "./AccessSettings";
import { overlay, modal } from "@/lib/motion";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { cn } from "@/lib/cn";

export function SettingsModal() {
  const appVersion = useAppVersion();
  const open = useUi((s) => s.settingsOpen);
  const close = useUi((s) => s.closeSettings);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open, close);
  const [tab, setTab] = useState<"models" | "access">("models");

  return (
    <AnimatePresence>
      {open && (
        <motion.div variants={overlay} initial="hidden" animate="show" exit="exit"
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={close}>
          <motion.div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Settings" tabIndex={-1}
            variants={modal} className="flex h-[min(88dvh,760px)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-background text-left shadow-2xl outline-none" onClick={(e) => e.stopPropagation()}>
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
              <span className="flex items-baseline gap-2 text-[14px] font-semibold">
                Settings
                {appVersion && <span className="text-[11px] font-normal text-muted-foreground">v{appVersion}</span>}
              </span>
              <button onClick={close} aria-label="Close settings" className="grid size-8 place-items-center rounded-md text-muted-foreground transition hover:bg-surface hover:text-foreground"><X className="size-4" /></button>
            </div>
            <div className="flex shrink-0 border-b border-border px-4 pt-3" role="tablist" aria-label="Settings sections">
              <Tab active={tab === "models"} onClick={() => setTab("models")} icon={Settings2}>Model</Tab>
              <Tab active={tab === "access"} onClick={() => setTab("access")} icon={ShieldCheck}>Flight plan</Tab>
            </div>
            <div className="takt-scroll min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
              {tab === "models" ? <ModelsSettings /> : <AccessSettings />}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Tab({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: typeof Settings2; children: string }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick}
      className={cn("flex h-9 items-center gap-2 border-b-2 px-3 text-[12px] font-medium transition", active ? "border-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground") }>
      <Icon className="size-4" />{children}
    </button>
  );
}
