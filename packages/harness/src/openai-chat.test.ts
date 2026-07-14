import test from "node:test";
import assert from "node:assert/strict";
import { toChatMessages } from "./openai-chat.js";

test("Gemini thought signatures survive assistant tool-call replay", () => {
  const messages = toChatMessages([
    { role: "user", text: "Check keeper status" },
    {
      role: "assistant",
      text: "",
      toolCalls: [{ id: "call-1", name: "keeper_status", arguments: "{}", thoughtSignature: "signed-context" }],
    },
    { role: "tool", callId: "call-1", name: "keeper_status", result: "Active" },
  ]) as any[];
  assert.equal(messages[1]?.tool_calls?.[0]?.extra_content?.google?.thought_signature, "signed-context");
});
