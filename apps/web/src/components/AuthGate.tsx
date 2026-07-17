"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { OpenLiveMark } from "./OpenLiveMark";

interface AuthStatus {
  enabled: boolean;
  enforced: boolean;
  configured: boolean;
  enrolled: boolean;
  authenticated: boolean;
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || response.statusText);
  return body as T;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const next = await request<AuthStatus>("/auth/status");
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    void refresh().catch((cause) => setError(String(cause?.message || cause)));
  }, [refresh]);

  useEffect(() => {
    if (!status?.enabled || !status.enrolled) return;
    if (sessionStorage.getItem("openlive-webauthn-launch") === "ok") return;
    void request("/auth/lock", { method: "POST" })
      .then(() => setStatus((current) => current ? { ...current, authenticated: false } : current))
      .catch(() => {});
  }, [status?.enabled, status?.enrolled]);

  const unlock = async () => {
    setBusy(true); setError("");
    try {
      const optionsJSON = await request<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/auth/authenticate/options", { method: "POST" });
      const response = await startAuthentication({ optionsJSON });
      await request("/auth/authenticate/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(response) });
      sessionStorage.setItem("openlive-webauthn-launch", "ok");
      await refresh();
    } catch (cause: any) {
      setError(cause?.name === "NotAllowedError" ? "Face ID was cancelled." : String(cause?.message || cause));
    } finally { setBusy(false); }
  };

  const register = async () => {
    setBusy(true); setError("");
    try {
      const optionsJSON = await request<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/auth/register/options", { method: "POST" });
      const response = await startRegistration({ optionsJSON });
      await request("/auth/register/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(response) });
      sessionStorage.setItem("openlive-webauthn-launch", "ok");
      await refresh();
    } catch (cause: any) {
      setError(cause?.name === "NotAllowedError" ? "Face ID setup was cancelled." : String(cause?.message || cause));
    } finally { setBusy(false); }
  };

  if (!status && !error) return <GateFrame busy />;
  if (status && (!status.enabled || (status.authenticated && sessionStorage.getItem("openlive-webauthn-launch") === "ok"))) return children;

  const configured = status?.configured !== false;
  const enrolled = !!status?.enrolled;
  return (
    <GateFrame>
      <button type="button" onClick={() => void (enrolled ? unlock() : register())} disabled={busy || !configured}
        className="flex min-w-48 items-center justify-center gap-2 rounded-full bg-accent px-6 py-3 text-[15px] font-medium text-accent-foreground shadow-lg transition hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? <LoaderCircle className="size-5 animate-spin" /> : <Fingerprint className="size-5" />}
        {enrolled ? "Unlock with Face ID" : "Set up Face ID"}
      </button>
      {error && <p className="max-w-sm text-center text-[12.5px] text-danger">{error}</p>}
    </GateFrame>
  );
}

function GateFrame({ children, busy = false }: { children?: ReactNode; busy?: boolean }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-7 bg-background px-6">
      <OpenLiveMark size={76} />
      {children ?? (busy ? <LoaderCircle className="size-5 animate-spin text-muted-foreground" /> : null)}
    </main>
  );
}
