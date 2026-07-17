import { loadKernalConfig } from "./kernal.js";

const WRITER = "surface.openlive.voice";

export interface AuditSnapshot {
  identity: { name: string; policy: string; authority: string };
  access: { kernalRead: boolean; kernalWrite: boolean; localNotes: boolean };
  tools: Array<{
    name: string; label: string; mode: "read" | "write" | "device" | "session";
    availability: "available" | "disabled" | "desktop-only" | "via-assistant";
    boundary: string;
  }>;
  context: Array<{ label: string; timing: string; retention: string; enabled: boolean }>;
  storage: Array<{ label: string; detail: string }>;
  recentWrites: Array<{ activityId: number; actionId: number | null; date: string; summary: string }>;
  writesStatus: "available" | "disabled" | "unavailable";
}

export function buildAuditSnapshot(): AuditSnapshot {
  const kernal = loadKernalConfig();
  return {
    identity: {
      name: WRITER,
      policy: "openlive-kernal-v1",
      authority: "Voice surface only. No keeper identity or branch authority.",
    },
    access: {
      kernalRead: kernal.readEnabled,
      kernalWrite: kernal.writeEnabled,
      localNotes: !kernal.readEnabled,
    },
    tools: [
      { name: "delegate", label: "Research assistant", mode: "read", availability: "available", boundary: "Hands one bounded lookup to the web worker." },
      { name: "web_search", label: "Web search", mode: "read", availability: "via-assistant", boundary: "Public web results only." },
      { name: "fetch_url", label: "Read public page", mode: "read", availability: "via-assistant", boundary: "HTTP(S) only; private, local and metadata addresses are blocked." },
      { name: "look", label: "Fresh camera or screen look", mode: "device", availability: "available", boundary: "Only while you are actively sharing; images are not written to Kernal." },
      { name: "keeper_status", label: "Keeper fleet status", mode: "read", availability: kernal.readEnabled ? "available" : "disabled", boundary: "ACTIVE fleet, owned HUBs, next actions and freshness." },
      { name: "kernal_recall", label: "Kernal recall", mode: "read", availability: kernal.readEnabled ? "available" : "disabled", boundary: "On-demand search, at most six bounded results." },
      { name: "prepare_keeper_action", label: "Prepare keeper action", mode: "write", availability: kernal.writeEnabled ? "available" : "disabled", boundary: "Stages one proposal; writes nothing." },
      { name: "confirm_keeper_action", label: "Confirm keeper action", mode: "write", availability: kernal.writeEnabled ? "available" : "disabled", boundary: "Requires an explicit yes on the immediately following turn; creates one action plus provenance activity." },
      { name: "update_todos", label: "Session checklist", mode: "session", availability: "available", boundary: "Transient call checklist; not written to Kernal." },
      { name: "clipboard_read", label: "Read clipboard", mode: "device", availability: "desktop-only", boundary: "Unavailable in the iPhone web app." },
      { name: "clipboard_write", label: "Write clipboard", mode: "device", availability: "desktop-only", boundary: "Unavailable in the iPhone web app." },
      { name: "open_url", label: "Open URL", mode: "device", availability: "desktop-only", boundary: "Unavailable in the iPhone web app." },
    ],
    context: [
      { label: "Voice behavior and safety policy", timing: "Every call", retention: "Application policy", enabled: true },
      { label: "Current date", timing: "Every call", retention: "Current session", enabled: true },
      { label: "Active keeper fleet and owned HUBs", timing: "Call start", retention: "Cached for 60 seconds", enabled: kernal.readEnabled },
      { label: "Recent conversation", timing: "Call start and each turn", retention: "Last 20 turns in model context", enabled: true },
      { label: "Camera or shared screen", timing: "Only while sharing", retention: "At most two recent visual turns in model context", enabled: true },
      { label: "Kernal facts", timing: "Only when recall is called", retention: "At most six bounded results for that turn", enabled: kernal.readEnabled },
    ],
    storage: [
      { label: "Conversation transcript", detail: "Stored in OpenLive data for resume and transcript review; not copied to Kernal." },
      { label: "Tool trace", detail: "Tool name, bounded request summary and completion state are stored with the conversation." },
      { label: "Provider credentials", detail: "Encrypted server-side; plaintext keys are never returned to the browser." },
      { label: "Kernal writes", detail: "Only explicitly confirmed keeper actions, plus a provenance activity carrying the OpenLive writer identity." },
    ],
    recentWrites: [],
    writesStatus: kernal.writeEnabled ? "available" : "disabled",
  };
}

export async function loadAuditSnapshot(): Promise<AuditSnapshot> {
  const snapshot = buildAuditSnapshot();
  const kernal = loadKernalConfig();
  if (!kernal.readEnabled || !kernal.apiKey) return snapshot;
  try {
    const response = await fetch(`${kernal.baseUrl}/api/activities?limit=100`, {
      headers: { "x-api-key": kernal.apiKey, "x-kernal-env": "blekkie", "x-kernal-writer": WRITER },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error(`Kernal HTTP ${response.status}`);
    const payload = await response.json() as { activities?: Array<Record<string, unknown>> };
    snapshot.recentWrites = (payload.activities ?? [])
      .filter((activity) => String(activity.notes ?? "").includes(`writer=${WRITER}`))
      .slice(0, 8)
      .map((activity) => {
        const match = String(activity.notes ?? "").match(/action_id=(\d+)/);
        return {
          activityId: Number(activity.id),
          actionId: match ? Number(match[1]) : null,
          date: String(activity.date ?? activity.created_at ?? ""),
          summary: String(activity.summary ?? activity.title ?? "").slice(0, 220),
        };
      })
      .filter((item) => Number.isFinite(item.activityId));
    snapshot.writesStatus = kernal.writeEnabled ? "available" : "disabled";
  } catch {
    snapshot.writesStatus = "unavailable";
  }
  return snapshot;
}
