import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createWebAuthnGate } from "./webauthn.mjs";

function request(url, method = "GET", headers = {}) {
  const req = Readable.from([]);
  Object.assign(req, { url, method, headers });
  return req;
}
function response() {
  return {
    status: 0, headers: {}, body: "",
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body = "") { this.body = String(body); },
  };
}

test("enforcement refuses incomplete WebAuthn configuration", () => {
  assert.throws(() => createWebAuthnGate({ OPENLIVE_WEBAUTHN_ENABLED: "1", OPENLIVE_WEBAUTHN_ENFORCED: "1" }), /requires RP ID/);
});
test("disabled gate reports an authenticated compatibility state", async () => {
  const gate = createWebAuthnGate({});
  const res = response();
  assert.equal(await gate.handle(request("/auth/status"), res, "cesar"), true);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { enabled: false, enforced: false, configured: false, enrolled: false, authenticated: true });
});

test("configured gate starts locked and exposes no credential details", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openlive-webauthn-"));
  try {
    const gate = createWebAuthnGate({
      OPENLIVE_WEBAUTHN_ENABLED: "1",
      OPENLIVE_WEBAUTHN_ENFORCED: "1",
      OPENLIVE_WEBAUTHN_RP_ID: "openlive.example.com",
      OPENLIVE_WEBAUTHN_ORIGIN: "https://openlive.example.com",
      OPENLIVE_WEBAUTHN_SESSION_SECRET: "test-secret-with-sufficient-entropy",
      OPENLIVE_WEBAUTHN_DATA_PATH: join(dir, "credential.json"),
      OPENLIVE_ACCESS_USER: "cesar",
    });
    const res = response();
    await gate.handle(request("/auth/status"), res, "cesar");
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), {
      enabled: true, enforced: true, configured: true, enrolled: false,
      recoveryAuthorized: false,
      authenticated: false, user: null, expiresAt: null,
    });
    assert.equal(gate.authenticate(request("/")).authenticated, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("lock clears the server session cookie", async () => {
  const gate = createWebAuthnGate({
    OPENLIVE_WEBAUTHN_ENABLED: "1",
    OPENLIVE_WEBAUTHN_RP_ID: "openlive.example.com",
    OPENLIVE_WEBAUTHN_ORIGIN: "https://openlive.example.com",
    OPENLIVE_WEBAUTHN_SESSION_SECRET: "test-secret-with-sufficient-entropy",
  });
  const res = response();
  await gate.handle(request("/auth/lock", "POST"), res, "cesar");
  assert.equal(res.status, 200);
  assert.match(String(res.headers["set-cookie"]), /openlive_session=;.*Max-Age=0/);
});

test("recovery password creates a short-lived registration grant", async () => {
  const gate = createWebAuthnGate({
    OPENLIVE_WEBAUTHN_ENABLED: "1",
    OPENLIVE_WEBAUTHN_RP_ID: "openlive.example.com",
    OPENLIVE_WEBAUTHN_ORIGIN: "https://openlive.example.com",
    OPENLIVE_WEBAUTHN_SESSION_SECRET: "test-secret-with-sufficient-entropy",
  });
  const denied = response();
  await gate.handle(request("/auth/register/options", "POST"), denied, "");
  assert.equal(denied.status, 403);
  assert.match(denied.body, /password recovery/i);

  const recovery = response();
  await gate.handle(request("/auth/recovery"), recovery, "cesar");
  assert.equal(recovery.status, 302);
  assert.equal(recovery.headers.location, "/");
  assert.match(String(recovery.headers["set-cookie"]), /openlive_recovery=/);
  assert.match(String(recovery.headers["set-cookie"]), /HttpOnly/);
});

test("shared Face ID accepts only allowlisted HTTPS return addresses", async () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const gate = createWebAuthnGate({
    OPENLIVE_WEBAUTHN_ENABLED: "1",
    OPENLIVE_WEBAUTHN_RP_ID: "openlive.example.com",
    OPENLIVE_WEBAUTHN_ORIGIN: "https://openlive.example.com",
    OPENLIVE_WEBAUTHN_SESSION_SECRET: "test-secret-with-sufficient-entropy",
    OPENLIVE_SSO_ENABLED: "1",
    OPENLIVE_SSO_PRIVATE_KEY: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    OPENLIVE_SSO_CALLBACK: "https://video.example.com/auth/callback",
    OPENLIVE_SSO_ALLOWED_HOSTS: "pythia.example.com,video.example.com",
  });

  const denied = response();
  await gate.handle(request("/auth/sso/start?return_to=https%3A%2F%2Fevil.example%2F"), denied, "");
  assert.equal(denied.status, 400);

  const locked = response();
  await gate.handle(request("/auth/sso/start?return_to=https%3A%2F%2Fpythia.example.com%2Fforecast"), locked, "");
  assert.equal(locked.status, 401);
  assert.match(locked.body, /Use Face ID/);
  assert.doesNotMatch(locked.body, /evil\.example/);
});
