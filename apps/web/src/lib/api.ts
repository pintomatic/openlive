import type { Provider, ChatSummary, ChatMessage } from "@openlive/shared";

export interface ModelInfo {
  id: string; display_name: string; created_at?: string;
  contextWindow?: number; maxOutput?: number; reasoning?: boolean; vision?: boolean;
  cost?: { input: number; output: number };
}
export interface AppSettings {
  liveModel?: string;
  liveProviderId?: string;
  liveEffort?: string;
  /** Optional dedicated vision model (own provider) for when the live model can't see. */
  visionProviderId?: string;
  visionModel?: string;
}

export interface AuditSnapshot {
  identity: { name: string; policy: string; authority: string };
  access: { kernalRead: boolean; kernalWrite: boolean; localNotes: boolean };
  tools: Array<{ name: string; label: string; mode: "read" | "write" | "device" | "session"; availability: "available" | "disabled" | "desktop-only" | "via-assistant"; boundary: string }>;
  context: Array<{ label: string; timing: string; retention: string; enabled: boolean }>;
  storage: Array<{ label: string; detail: string }>;
  recentWrites: Array<{ activityId: number; actionId: number | null; date: string; summary: string }>;
  writesStatus: "available" | "disabled" | "unavailable";
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? res.statusText);
  return res.json() as Promise<T>;
}

export const api = {
  providers: () => fetch("/api/providers").then(j<Provider[]>),
  updateProviderKey: (id: string, apiKey: string) =>
    fetch(`/api/providers/${id}`, { method: "PATCH", body: JSON.stringify({ apiKey }) }).then(j<Provider>),
  removeProviderKey: (id: string) =>
    fetch(`/api/providers/${id}`, { method: "PATCH", body: JSON.stringify({ clear: true }) }).then(j<Provider>),
  // Upsert a key for a provider by its registry id (creates the DB row if new).
  setProviderKey: (kind: string, apiKey: string) =>
    fetch("/api/providers", { method: "POST", body: JSON.stringify({ kind, apiKey }) }).then(j<Provider>),
  models: (provider?: string) =>
    fetch(`/api/models${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`).then(j<ModelInfo[]>),
  settings: () => fetch("/api/settings").then(j<AppSettings>),
  audit: () => fetch("/api/audit", { cache: "no-store" }).then(j<AuditSnapshot>),
  updateSettings: (b: Partial<AppSettings>) =>
    fetch("/api/settings", { method: "PUT", body: JSON.stringify(b) }).then(j<AppSettings>),
  chats: () => fetch("/api/chats").then(j<ChatSummary[]>),
  messages: (id: string) => fetch(`/api/chats/${id}`).then(j<ChatMessage[]>),
  deleteChat: (id: string) => fetch(`/api/chats/${id}`, { method: "DELETE" }).then(j),
};
