import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadLiveClient() {
  const source = await readFile(new URL("./src/lib/live/liveClient.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("queues a recognized turn until the live socket opens", async () => {
  const sockets = [];
  class FakeWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = FakeWebSocket.CONNECTING;
    sent = [];
    constructor() { sockets.push(this); }
    send(value) { this.sent.push(value); }
    close() { this.readyState = 3; }
  }
  globalThis.WebSocket = FakeWebSocket;
  globalThis.location = { protocol: "https:", host: "openlive.andes.no" };

  const { LiveClient } = await loadLiveClient();
  const client = new LiveClient({});
  client.connect("chat-1");
  const socket = sockets[0];

  client.userText("Hello");
  assert.deepEqual(socket.sent, []);

  socket.readyState = FakeWebSocket.OPEN;
  socket.onopen();
  assert.deepEqual(socket.sent.map(JSON.parse), [{ t: "user_text", text: "Hello" }]);

  client.close();
});
