import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";

const SESSION_COOKIE = "openlive_session";
const CHALLENGE_COOKIE = "openlive_webauthn_challenge";
const JSON_LIMIT = 128 * 1024;

function bool(value) { return String(value || "").trim() === "1"; }
function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function b64url(value) { return Buffer.from(value).toString("base64url"); }
function fromB64url(value) { return new Uint8Array(Buffer.from(value, "base64url")); }
function same(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}
function cookies(req) {
  return Object.fromEntries(String(req.headers?.cookie || "").split(";").map((part) => {
    const index = part.indexOf("=");
    if (index < 0) return ["", ""];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}
function cookie(name, value, { maxAge } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "Secure", "SameSite=Strict"];
  if (maxAge != null) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  return parts.join("; ");
}
function json(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}
async function readJson(req) {
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > JSON_LIMIT) throw new Error("Request body is too large.");
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8") || "{}");
}
export function createWebAuthnGate(env = process.env) {
  const enabled = bool(env.OPENLIVE_WEBAUTHN_ENABLED);
  const enforced = bool(env.OPENLIVE_WEBAUTHN_ENFORCED);
  const rpID = String(env.OPENLIVE_WEBAUTHN_RP_ID || "").trim();
  const origin = String(env.OPENLIVE_WEBAUTHN_ORIGIN || "").trim().replace(/\/$/, "");
  const secret = String(env.OPENLIVE_WEBAUTHN_SESSION_SECRET || "").trim();
  const userName = String(env.OPENLIVE_ACCESS_USER || "cesar").trim() || "cesar";
  const dataPath = String(env.OPENLIVE_WEBAUTHN_DATA_PATH || join(process.cwd(), "data", "webauthn-credential.json")).trim();
  const sessionSeconds = positiveInt(env.OPENLIVE_WEBAUTHN_SESSION_SECONDS, 12 * 60 * 60);
  const configured = !!(rpID && origin && secret);

  if (enforced && !enabled) throw new Error("OPENLIVE_WEBAUTHN_ENFORCED requires OPENLIVE_WEBAUTHN_ENABLED=1.");
  if (enforced && !configured) throw new Error("WebAuthn enforcement requires RP ID, origin, and session secret configuration.");

  const sign = (payload) => {
    const encoded = b64url(JSON.stringify(payload));
    const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
    return `${encoded}.${signature}`;
  };
  const verifySigned = (token, kind) => {
    if (!configured || !token) return null;
    const split = token.lastIndexOf(".");
    if (split < 1) return null;
    const encoded = token.slice(0, split);
    const actual = token.slice(split + 1);
    const expected = createHmac("sha256", secret).update(encoded).digest("base64url");
    if (!same(actual, expected)) return null;
    try {
      const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
      if (payload.kind !== kind || !Number.isFinite(payload.exp) || payload.exp <= Date.now()) return null;
      return payload;
    } catch { return null; }
  };

  async function loadCredential() {
    try {
      const value = JSON.parse(await readFile(dataPath, "utf8"));
      if (!value?.id || !value?.publicKey) return null;
      return value;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }
  async function saveCredential(value) {
    await mkdir(dirname(dataPath), { recursive: true });
    const temp = `${dataPath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, dataPath);
  }
  const challengeFor = (req, purpose) => {
    const token = cookies(req)[CHALLENGE_COOKIE];
    const payload = verifySigned(token, "challenge");
    return payload?.purpose === purpose ? payload.challenge : null;
  };
  const issueChallenge = (res, purpose, challenge) => cookie(CHALLENGE_COOKIE, sign({
    kind: "challenge", purpose, challenge, exp: Date.now() + 5 * 60_000,
  }), { maxAge: 5 * 60 });
  const issueSession = (res) => cookie(SESSION_COOKIE, sign({
    kind: "session", user: userName, exp: Date.now() + sessionSeconds * 1000,
  }), { maxAge: sessionSeconds });

  function authenticate(req) {
    if (!enabled) return { authenticated: true, user: userName, expiresAt: null };
    const session = verifySigned(cookies(req)[SESSION_COOKIE], "session");
    return session ? { authenticated: true, user: session.user, expiresAt: session.exp } : { authenticated: false, user: null, expiresAt: null };
  }
  function reject(res) {
    json(res, 401, { error: "Face ID unlock required.", code: "WEBAUTHN_REQUIRED" });
  }

  async function handle(req, res, basicUser) {
    let path = "/";
    try { path = new URL(req.url || "/", "http://localhost").pathname; } catch { /* keep default */ }
    if (!path.startsWith("/auth/")) return false;
    if (!enabled) {
      if (path === "/auth/status") json(res, 200, { enabled: false, enforced: false, configured: false, enrolled: false, authenticated: true });
      else json(res, 404, { error: "Face ID authentication is disabled." });
      return true;
    }
    if (!configured) {
      json(res, 503, { error: "Face ID authentication is not configured.", enabled, enforced, configured: false });
      return true;
    }
    try {
      const credential = await loadCredential();
      if (req.method === "GET" && path === "/auth/status") {
        const auth = authenticate(req);
        json(res, 200, { enabled, enforced, configured, enrolled: !!credential, ...auth });
        return true;
      }
      if (req.method === "POST" && path === "/auth/lock") {
        json(res, 200, { authenticated: false }, { "set-cookie": cookie(SESSION_COOKIE, "", { maxAge: 0 }) });
        return true;
      }
      if (req.method === "POST" && path === "/auth/register/options") {
        if (!basicUser) { json(res, 403, { error: "Backstop authentication required." }); return true; }
        if (credential && !bool(env.OPENLIVE_WEBAUTHN_ALLOW_REREGISTRATION)) { json(res, 409, { error: "A Face ID credential is already registered." }); return true; }
        const options = await generateRegistrationOptions({
          rpName: "OpenLive",
          rpID,
          userName,
          userDisplayName: "Cesar",
          timeout: 300_000,
          attestationType: "none",
          excludeCredentials: credential ? [{ id: credential.id, transports: credential.transports }] : [],
          authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" },
          preferredAuthenticatorType: "localDevice",
        });
        json(res, 200, options, { "set-cookie": issueChallenge(res, "registration", options.challenge) });
        return true;
      }
      if (req.method === "POST" && path === "/auth/register/verify") {
        if (!basicUser) { json(res, 403, { error: "Backstop authentication required." }); return true; }
        const challenge = challengeFor(req, "registration");
        if (!challenge) { json(res, 400, { error: "Registration challenge expired." }); return true; }
        const verification = await verifyRegistrationResponse({
          response: await readJson(req), expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID,
          requireUserPresence: true, requireUserVerification: true,
        });
        if (!verification.verified || !verification.registrationInfo) { json(res, 401, { error: "Face ID registration was not verified." }); return true; }
        const info = verification.registrationInfo;
        await saveCredential({
          id: info.credential.id,
          publicKey: b64url(info.credential.publicKey),
          counter: info.credential.counter,
          transports: info.credential.transports || [],
          deviceType: info.credentialDeviceType,
          backedUp: info.credentialBackedUp,
          createdAt: new Date().toISOString(),
        });
        json(res, 200, { verified: true }, { "set-cookie": [issueSession(res), cookie(CHALLENGE_COOKIE, "", { maxAge: 0 })] });
        return true;
      }
      if (req.method === "POST" && path === "/auth/authenticate/options") {
        if (!credential) { json(res, 409, { error: "Face ID has not been registered." }); return true; }
        const options = await generateAuthenticationOptions({
          rpID, timeout: 300_000, userVerification: "required",
          allowCredentials: [{ id: credential.id, transports: credential.transports }],
        });
        json(res, 200, options, { "set-cookie": issueChallenge(res, "authentication", options.challenge) });
        return true;
      }
      if (req.method === "POST" && path === "/auth/authenticate/verify") {
        if (!credential) { json(res, 409, { error: "Face ID has not been registered." }); return true; }
        const challenge = challengeFor(req, "authentication");
        if (!challenge) { json(res, 400, { error: "Authentication challenge expired." }); return true; }
        const verification = await verifyAuthenticationResponse({
          response: await readJson(req), expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID,
          requireUserVerification: true,
          credential: {
            id: credential.id,
            publicKey: fromB64url(credential.publicKey),
            counter: credential.counter,
            transports: credential.transports,
          },
        });
        if (!verification.verified || !verification.authenticationInfo.userVerified) { json(res, 401, { error: "Face ID authentication was not verified." }); return true; }
        await saveCredential({ ...credential, counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date().toISOString() });
        json(res, 200, { verified: true, expiresAt: Date.now() + sessionSeconds * 1000 }, {
          "set-cookie": [issueSession(res), cookie(CHALLENGE_COOKIE, "", { maxAge: 0 })],
        });
        return true;
      }
      if (req.method === "POST" && path === "/auth/refresh") {
        const auth = authenticate(req);
        if (!auth.authenticated) { reject(res); return true; }
        json(res, 200, { authenticated: true, expiresAt: Date.now() + sessionSeconds * 1000 }, { "set-cookie": issueSession(res) });
        return true;
      }
      json(res, 404, { error: "Authentication route not found." });
      return true;
    } catch (error) {
      console.warn(`[web] WebAuthn ${path} failed:`, error?.message || error);
      json(res, 400, { error: "Face ID operation failed." });
      return true;
    }
  }

  return { enabled, enforced, configured, authenticate, reject, handle, dataPath };
}
