import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import { LiveSession } from "./session.js";

export function kernalUpgradeRejection(input: {
  enabled: boolean; agentSecret: string; providedSecret: string; accessUser: string; providedUser: string;
}): string | null {
  if (!input.enabled) return null;
  if (!input.agentSecret) return "Kernal sessions require OPENLIVE_AGENT_SECRET";
  if (input.providedSecret !== input.agentSecret) return "bad or missing x-openlive-secret";
  if (!input.accessUser || input.providedUser !== input.accessUser) return "Kernal session requires an authenticated allowlisted user";
  return null;
}

// Attach the /live WebSocket to the agent's existing http.Server (the one
// @hono/node-server's serve() returns), leaving every HTTP route untouched.
export function attachLiveWs(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const AGENT_SECRET = process.env.OPENLIVE_AGENT_SECRET?.trim() || "";
  const ACCESS_USER = process.env.OPENLIVE_ACCESS_USER?.trim() || "";
  const kernalEnabled = /^(1|true|yes|on)$/i.test(process.env.KERNAL_READ_ENABLED?.trim() ?? "");

  const reject = (socket: import("node:stream").Duplex, status: string, why: string) => {
    console.log(`[agent] /live upgrade rejected — ${why}`);
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`); socket.destroy();
  };

  server.on("upgrade", (req, socket, head) => {
    let url: URL;
    try { url = new URL(req.url ?? "", "http://localhost"); } catch { socket.destroy(); return; }
    if (url.pathname !== "/live") { socket.destroy(); return; }
    // Only the trusted web proxy (which holds the secret) may open a live socket.
    if (AGENT_SECRET && (req.headers["x-openlive-secret"] as string)?.trim() !== AGENT_SECRET) {
      return reject(socket, "401 Unauthorized", "bad or missing x-openlive-secret");
    }
    const userId = (req.headers["x-openlive-user"] as string)?.trim() ?? "";
    const kernalRejection = kernalUpgradeRejection({
      enabled: kernalEnabled,
      agentSecret: AGENT_SECRET,
      providedSecret: (req.headers["x-openlive-secret"] as string)?.trim() ?? "",
      accessUser: ACCESS_USER,
      providedUser: userId,
    });
    if (kernalRejection) return reject(socket, "403 Forbidden", kernalRejection);
    const chatId = url.searchParams.get("chat") ?? "";
    console.log(`[agent] /live upgrade accepted — chat=${chatId || "(none)"}`);
    wss.handleUpgrade(req, socket, head, (ws) => {
      void new LiveSession(ws, chatId, userId).start();
    });
  });
  return wss;
}
