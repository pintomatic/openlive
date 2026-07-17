import test from "node:test";
import assert from "node:assert/strict";
import { buildAuditSnapshot } from "./audit.js";

test("audit snapshot reflects Kernal feature flags without exposing credentials", () => {
  const prior = {
    read: process.env.KERNAL_READ_ENABLED,
    write: process.env.KERNAL_WRITE_ENABLED,
    key: process.env.KERNAL_REST_KEY_BLEKKIE,
  };
  process.env.KERNAL_READ_ENABLED = "true";
  process.env.KERNAL_WRITE_ENABLED = "true";
  process.env.KERNAL_REST_KEY_BLEKKIE = "test-secret-that-must-not-leak";
  try {
    const snapshot = buildAuditSnapshot();
    assert.equal(snapshot.access.kernalRead, true);
    assert.equal(snapshot.access.kernalWrite, true);
    assert.equal(snapshot.access.localNotes, false);
    assert.equal(snapshot.tools.find((tool) => tool.name === "confirm_keeper_action")?.availability, "available");
    assert.equal(JSON.stringify(snapshot).includes("test-secret-that-must-not-leak"), false);
  } finally {
    if (prior.read === undefined) delete process.env.KERNAL_READ_ENABLED; else process.env.KERNAL_READ_ENABLED = prior.read;
    if (prior.write === undefined) delete process.env.KERNAL_WRITE_ENABLED; else process.env.KERNAL_WRITE_ENABLED = prior.write;
    if (prior.key === undefined) delete process.env.KERNAL_REST_KEY_BLEKKIE; else process.env.KERNAL_REST_KEY_BLEKKIE = prior.key;
  }
});
