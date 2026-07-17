"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useLiveStore } from "@/lib/live/liveStore";
import { useLiveSession } from "@/lib/live/useLiveSession";
import { useUi } from "@/lib/uiStore";
import { api } from "@/lib/api";
import { chatStore } from "@/lib/chatStore";
import { PreCall } from "./LiveStage";
import { InCall } from "./InCall";
import { MiniBar } from "./MiniBar";

// Hosts one live call: a centered setup MODAL before the call (permissions,
// mic/camera, model download, model pick), then the full-screen in-call view
// (orb + transcript) once active.
export function LiveDock({ chatId, onExit }: { chatId: string; onExit: () => void }) {
  const { start, stop, download, toggleMute, toggleCamera, toggleScreen, setInputMode, togglePushToTalk, getLevels, getBands, refreshDevices, setMic, setCam } = useLiveSession(chatId);
  const { active, phase, modelsDownloaded, downloading, downloadPct, downloadLoaded, downloadTotal, downloadModels, muted, inputMode, pushActive, cameraOn, screenOn, cameraStream, screenStream, error, mics, cams, micId, camId } = useLiveStore();
  const openSettings = useUi((s) => s.openSettings);
  const minimized = useUi((s) => s.minimized);
  const setMinimized = useUi((s) => s.setMinimized);

  useEffect(() => { void refreshDevices(); }, [refreshDevices]);
  // Preload a resumed conversation's transcript from the saved store.
  useEffect(() => { api.messages(chatId).then((m) => chatStore.preload(chatId, m as never)).catch(() => {}); }, [chatId]);
  useEffect(() => () => stop(), [stop]);

  const end = () => { setMinimized(false); stop(); onExit(); };

  return (
    <>
      <AnimatePresence>
        {!active && (
          <motion.div key="precall" className="fixed inset-0 z-40 grid place-items-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={end} />
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.97 }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              className="relative z-10 flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_70px_-20px_rgba(0,0,0,0.55)]">
              <div className="flex justify-end p-2">
                <button onClick={end} title="Close" aria-label="Close live" className="grid size-8 place-items-center rounded-full text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground"><X className="size-4" /></button>
              </div>
              <PreCall mics={mics} cams={cams} micId={micId} camId={camId} onMic={(id) => void setMic(id)} onCam={setCam}
                error={error} modelsDownloaded={modelsDownloaded} downloading={downloading} downloadPct={downloadPct}
                downloadLoaded={downloadLoaded} downloadTotal={downloadTotal} downloadModels={downloadModels}
                refreshDevices={refreshDevices} onDownload={() => void download()} onStart={() => void start()}
                onOpenSettings={openSettings} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {active && minimized && (
        <MiniBar phase={phase} muted={muted} inputMode={inputMode} pushActive={pushActive} cameraOn={cameraOn} screenOn={screenOn}
          cameraStream={cameraStream} screenStream={screenStream}
          toggleMute={toggleMute} togglePushToTalk={togglePushToTalk} toggleCamera={toggleCamera} toggleScreen={toggleScreen}
          getLevels={getLevels} getBands={getBands} onEnd={end} />
      )}
      {active && !minimized && (
        <InCall chatId={chatId} phase={phase} muted={muted} inputMode={inputMode} pushActive={pushActive} cameraOn={cameraOn} screenOn={screenOn}
          cameraStream={cameraStream} screenStream={screenStream} error={error}
          toggleMute={toggleMute} setInputMode={setInputMode} togglePushToTalk={togglePushToTalk} toggleCamera={toggleCamera} toggleScreen={toggleScreen}
          setMic={(id) => void setMic(id)} setCam={setCam}
          getLevels={getLevels} getBands={getBands} onEnd={end} />
      )}
    </>
  );
}
