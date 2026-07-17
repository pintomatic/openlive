import assert from "node:assert/strict";
import test from "node:test";
import { requiresBasicAuth } from "./auth-policy.mjs";

test("Face ID enforcement removes Basic Auth from normal app traffic", () => {
  assert.equal(requiresBasicAuth("/", true, true), false);
  assert.equal(requiresBasicAuth("/api/chats", true, true), false);
  assert.equal(requiresBasicAuth("/live", true, true), false);
});

test("recovery stays password protected and compatibility mode is unchanged", () => {
  assert.equal(requiresBasicAuth("/auth/recovery", true, true), true);
  assert.equal(requiresBasicAuth("/", true, false), true);
  assert.equal(requiresBasicAuth("/", false, false), false);
});
