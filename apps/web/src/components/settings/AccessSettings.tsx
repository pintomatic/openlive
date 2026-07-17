"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, CircleOff, Database, Eye, Loader2, LockKeyhole, Wrench } from "lucide-react";
import { api } from "@/lib/api";
import { useChat } from "@/lib/chatStore";
import { useLiveStore } from "@/lib/live/liveStore";
import { toolMeta } from "@/lib/live/toolMeta";
import { useUi } from "@/lib/uiStore";
import { cn } from "@/lib/cn";

const MODE = {
  read: "Read",
  write: "Write",
  device: "Device",
  session: "Session",
} as const;

export function AccessSettings() {
  const chatId = useUi((state) => state.activeChatId);
  const messages = useChat(chatId);
  const { cameraOn, screenOn, active } = useLiveStore();
  const audit = useQuery({ queryKey: ["audit"], queryFn: api.audit, staleTime: 15_000, retry: 1 });
  const traces = useMemo(() => messages.flatMap((message) =>
    message.parts.filter((part) => part.kind === "tool").map((part) => ({
      tool: part.kind === "tool" ? part.tool : "",
      summary: part.kind === "tool" ? part.summary : undefined,
      detail: part.kind === "tool" ? part.detail : undefined,
      done: part.kind === "tool" ? part.done : true,
    })),
  ).slice(-12).reverse(), [messages]);

  if (audit.isPending) return <div className="grid min-h-64 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (audit.isError || !audit.data) return <div className="border-y border-border py-8 text-center text-[13px] text-muted-foreground">The live authority report is temporarily unavailable.</div>;
  const data = audit.data;

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle icon={LockKeyhole} title="Authority" />
        <div className="mt-3 border-y border-border">
          <Row label="Surface identity" value={data.identity.name} />
          <Row label="Policy" value={data.identity.policy} />
          <Row label="Kernal read" value={data.access.kernalRead ? "Enabled" : "Disabled"} ok={data.access.kernalRead} />
          <Row label="Kernal write" value={data.access.kernalWrite ? "Confirmation required" : "Disabled"} ok={data.access.kernalWrite} />
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">{data.identity.authority}</p>
      </section>

      <section>
        <SectionTitle icon={Eye} title="Current session" />
        <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
          <Metric label="Call" value={active ? "Active" : "Idle"} />
          <Metric label="Turns loaded" value={String(Math.min(messages.length, 20))} />
          <Metric label="Camera" value={cameraOn ? "Shared" : "Off"} />
          <Metric label="Screen" value={screenOn ? "Shared" : "Off"} />
        </div>
      </section>

      <section>
        <SectionTitle icon={Wrench} title="Available tools" />
        <div className="mt-3 divide-y divide-border border-y border-border">
          {data.tools.map((tool) => (
            <div key={tool.name} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium">{tool.label}</span>
                  <code className="text-[10px] text-faint">{tool.name}</code>
                </div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">{tool.boundary}</p>
              </div>
              <div className="flex items-center gap-1.5 self-start sm:justify-end">
                <Badge>{MODE[tool.mode]}</Badge>
                <Badge muted={tool.availability !== "available"}>{tool.availability.replace("-", " ")}</Badge>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle icon={Database} title="Context and retention" />
        <div className="mt-3 divide-y divide-border border-y border-border">
          {data.context.map((item) => (
            <div key={item.label} className="flex gap-3 py-3">
              {item.enabled ? <Check className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleOff className="mt-0.5 size-4 shrink-0 text-faint" />}
              <div className="min-w-0">
                <p className="text-[13px] font-medium">{item.label}</p>
                <p className="mt-1 text-[11.5px] text-muted-foreground">{item.timing} · {item.retention}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 space-y-3">
          {data.storage.map((item) => <div key={item.label}><p className="text-[12px] font-medium">{item.label}</p><p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{item.detail}</p></div>)}
        </div>
      </section>

      <section>
        <SectionTitle icon={Wrench} title="This conversation" />
        {traces.length ? (
          <div className="mt-3 divide-y divide-border border-y border-border">
            {traces.map((trace, index) => {
              const meta = toolMeta(trace.tool);
              const Icon = meta.icon;
              return (
                <div key={`${trace.tool}-${index}`} className="flex items-start gap-3 py-3">
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3"><span className="text-[12.5px] font-medium">{meta.label}</span><span className="text-[10px] text-faint">{trace.done ? trace.detail || "done" : "running"}</span></div>
                    {trace.summary && <p className="mt-1 truncate text-[11.5px] text-muted-foreground">{trace.summary}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : <p className="mt-3 border-y border-border py-5 text-[12px] text-muted-foreground">No tool calls in this conversation.</p>}
      </section>

      <section>
        <SectionTitle icon={Database} title="Verified Kernal writes" />
        {data.recentWrites.length ? (
          <div className="mt-3 divide-y divide-border border-y border-border">
            {data.recentWrites.map((write) => (
              <div key={write.activityId} className="py-3">
                <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                  <span>{write.actionId ? `Action #${write.actionId}` : "Recorded write"}</span>
                  <span>Activity #{write.activityId}</span>
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed">{write.summary}</p>
              </div>
            ))}
          </div>
        ) : <p className="mt-3 border-y border-border py-5 text-[12px] text-muted-foreground">{data.writesStatus === "unavailable" ? "Kernal write verification is temporarily unavailable." : "No OpenLive-authored Kernal writes found."}</p>}
      </section>
    </div>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: typeof Wrench; title: string }) {
  return <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase text-muted-foreground"><Icon className="size-4" />{title}</h2>;
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return <div className="flex items-center justify-between gap-4 py-2.5 text-[12px]"><span className="text-muted-foreground">{label}</span><span className={cn("truncate text-right font-medium", ok && "text-success")}>{value}</span></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="bg-background px-3 py-3"><p className="text-[9px] font-medium uppercase text-faint">{label}</p><p className="mt-1 text-[13px] font-medium">{value}</p></div>;
}

function Badge({ children, muted = false }: { children: string; muted?: boolean }) {
  return <span className={cn("rounded-sm border px-1.5 py-0.5 text-[9px] font-medium uppercase", muted ? "border-border text-faint" : "border-accent/30 bg-accent-soft text-accent")}>{children}</span>;
}
