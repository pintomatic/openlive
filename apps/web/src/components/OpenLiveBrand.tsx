"use client";

import { OpenLiveOrb } from "./OpenLiveOrb";
import { cn } from "@/lib/cn";

export function OpenLiveBrand({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center", compact ? "gap-2.5" : "gap-3", className)}>
      <OpenLiveOrb size={compact ? 30 : 38} />
      <div className="min-w-0 text-left leading-none">
        <div className={cn("font-semibold text-foreground", compact ? "text-[14px]" : "text-[17px]")}>OpenLive</div>
        <div className="mt-1 text-[9px] font-medium uppercase text-muted-foreground">Kernal / Andes</div>
      </div>
    </div>
  );
}
