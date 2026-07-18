import { createHmac, createPrivateKey, randomBytes, sign as signBytes, timingSafeEqual } from "node:crypto";
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
const RECOVERY_COOKIE = "openlive_recovery";
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
function html(res, status, body) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}
function ssoPage(returnTo) {
  const startUrl = `/auth/sso/start?return_to=${encodeURIComponent(returnTo)}`;
  const verifyUrl = `/auth/authenticate/verify?return_to=${encodeURIComponent(returnTo)}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unlock Wattback</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#07080a;color:#f5f7fa;font:16px system-ui,-apple-system,sans-serif}.shell{width:min(88vw,360px);text-align:center}.mark{width:64px;height:64px;margin:0 auto 22px;border:1px solid #31353d;border-radius:50%;display:grid;place-items:center;font-size:28px;background:#111318}h1{font-size:24px;margin:0 0 10px}p{color:#aeb4bf;line-height:1.5;margin:0 0 22px}button{border:0;border-radius:8px;padding:13px 18px;background:#f5f7fa;color:#090a0c;font-weight:700;font-size:15px}#error{color:#ff8585;min-height:24px;margin-top:18px;font-size:14px}
</style></head><body><main class="shell"><div class="mark">&#9673;</div><h1>Unlock Wattback</h1><p>Confirm Face ID once to open the secured tools.</p><button id="unlock" type="button">Use Face ID</button><div id="error" role="alert"></div></main>
<script>
const b64ToBytes=(s)=>{s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';const v=atob(s);return Uint8Array.from(v,c=>c.charCodeAt(0))};
const bytesToB64=(v)=>{let s='';for(const b of new Uint8Array(v))s+=String.fromCharCode(b);return btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'')};
const serialize=(c)=>({id:c.id,rawId:bytesToB64(c.rawId),type:c.type,authenticatorAttachment:c.authenticatorAttachment,response:{clientDataJSON:bytesToB64(c.response.clientDataJSON),authenticatorData:bytesToB64(c.response.authenticatorData),signature:bytesToB64(c.response.signature),userHandle:c.response.userHandle?bytesToB64(c.response.userHandle):null},clientExtensionResults:c.getClientExtensionResults()});
async function unlock(){const error=document.querySelector('#error');const button=document.querySelector('#unlock');error.textContent='';button.disabled=true;button.textContent='Waiting for Face ID...';try{const optionsResponse=await fetch('/auth/authenticate/options',{method:'POST'});const options=await optionsResponse.json();if(!optionsResponse.ok)throw new Error(options.error||'Could not start Face ID.');options.challenge=b64ToBytes(options.challenge);options.allowCredentials=(options.allowCredentials||[]).map(c=>({...c,id:b64ToBytes(c.id)}));const credential=await navigator.credentials.get({publicKey:options});button.textContent='Opening service...';const form=document.createElement('form');form.method='POST';form.action=${JSON.stringify(`${verifyUrl}&mode=navigate`)};form.enctype='application/x-www-form-urlencoded';const input=document.createElement('input');input.type='hidden';input.name='credential';input.value=JSON.stringify(serialize(credential));form.appendChild(input);document.body.appendChild(form);form.submit();}catch(e){error.textContent=e.name==='NotAllowedError'?'Face ID was cancelled.':(e.message||String(e));button.disabled=false;button.textContent='Use Face ID';}}
document.querySelector('#unlock').addEventListener('click',unlock);
</script></body></html>`;
}
async function readText(req) {
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > JSON_LIMIT) throw new Error("Request body is too large.");
    parts.push(chunk);
  }
  return Buffer.concat(parts).toString("utf8");
}
async function readJson(req) {
  return JSON.parse(await readText(req) || "{}");
}
async function readCredential(req) {
  const body = await readText(req);
  if (String(req.headers?.["content-type"] || "").toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    const encoded = new URLSearchParams(body).get("credential");
    if (!encoded) throw new Error("Credential form field is missing.");
    return JSON.parse(encoded);
  }
  return JSON.parse(body || "{}");
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
  const recoverySeconds = positiveInt(env.OPENLIVE_WEBAUTHN_RECOVERY_SECONDS, 10 * 60);
  const ssoPrivateKeyValue = String(env.OPENLIVE_SSO_PRIVATE_KEY || "").trim();
  const ssoCallback = String(env.OPENLIVE_SSO_CALLBACK || "").trim();
  const ssoAllowedHosts = new Set(String(env.OPENLIVE_SSO_ALLOWED_HOSTS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  const ssoEnabled = bool(env.OPENLIVE_SSO_ENABLED);
  const configured = !!(rpID && origin && secret);
  const ssoPrivateKey = ssoPrivateKeyValue ? createPrivateKey({ key: Buffer.from(ssoPrivateKeyValue, "base64"), format: "der", type: "pkcs8" }) : null;
  const ssoConfigured = !!(ssoPrivateKey && ssoCallback && ssoAllowedHosts.size);

  if (enforced && !enabled) throw new Error("OPENLIVE_WEBAUTHN_ENFORCED requires OPENLIVE_WEBAUTHN_ENABLED=1.");
  if (enforced && !configured) throw new Error("WebAuthn enforcement requires RP ID, origin, and session secret configuration.");
  if (ssoEnabled && !ssoConfigured) throw new Error("OpenLive SSO requires a private key, callback, and allowed return hosts.");

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
  const issueRecovery = () => cookie(RECOVERY_COOKIE, sign({
    kind: "recovery", user: userName, exp: Date.now() + recoverySeconds * 1000,
  }), { maxAge: recoverySeconds });
  const hasRecovery = (req) => !!verifySigned(cookies(req)[RECOVERY_COOKIE], "recovery");
  const validReturnTo = (raw) => {
    try {
      const target = new URL(String(raw || ""));
      if (target.protocol !== "https:" || target.username || target.password || !ssoAllowedHosts.has(target.hostname.toLowerCase())) return null;
      return target.toString();
    } catch { return null; }
  };
  const issueSsoToken = (returnTo) => {
    const encoded = b64url(JSON.stringify({ kind: "wattback-sso", sub: userName, aud: "wattback.no", returnTo, nonce: randomBytes(16).toString("base64url"), exp: Date.now() + 60_000 }));
    const signature = signBytes(null, Buffer.from(encoded), ssoPrivateKey).toString("base64url");
    return `${encoded}.${signature}`;
  };

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
        json(res, 200, { enabled, enforced, configured, enrolled: !!credential, recoveryAuthorized: hasRecovery(req), ...auth });
        return true;
      }
      if (req.method === "GET" && path === "/auth/sso/start") {
        if (!ssoEnabled || !ssoConfigured) { json(res, 404, { error: "Shared Face ID is disabled." }); return true; }
        const requestUrl = new URL(req.url || "/", origin);
        const returnTo = validReturnTo(requestUrl.searchParams.get("return_to"));
        if (!returnTo) { json(res, 400, { error: "The requested return address is not allowed." }); return true; }
        if (!authenticate(req).authenticated) { html(res, 200, ssoPage(returnTo)); return true; }
        const callback = new URL(ssoCallback);
        callback.searchParams.set("token", issueSsoToken(returnTo));
        res.writeHead(302, { location: callback.toString(), "cache-control": "no-store" });
        res.end();
        return true;
      }
      if (req.method === "GET" && path === "/auth/recovery") {
        if (!basicUser) { json(res, 403, { error: "Recovery password required." }); return true; }
        res.writeHead(302, { location: "/", "cache-control": "no-store", "set-cookie": issueRecovery() });
        res.end();
        return true;
      }
      if (req.method === "POST" && path === "/auth/lock") {
        json(res, 200, { authenticated: false }, { "set-cookie": cookie(SESSION_COOKIE, "", { maxAge: 0 }) });
        return true;
      }
      if (req.method === "POST" && path === "/auth/register/options") {
        if (!hasRecovery(req)) { json(res, 403, { error: "Open password recovery before setting up Face ID." }); return true; }
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
        if (!hasRecovery(req)) { json(res, 403, { error: "Password recovery expired. Start recovery again." }); return true; }
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
        json(res, 200, { verified: true }, { "set-cookie": [issueSession(res), cookie(CHALLENGE_COOKIE, "", { maxAge: 0 }), cookie(RECOVERY_COOKIE, "", { maxAge: 0 })] });
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
          response: await readCredential(req), expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID,
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
        const requestUrl = new URL(req.url || "/", origin);
        const requestedReturn = requestUrl.searchParams.get("return_to");
        let redirectTo = null;
        if (requestedReturn) {
          const returnTo = validReturnTo(requestedReturn);
          if (!ssoEnabled || !ssoConfigured || !returnTo) { json(res, 400, { error: "The requested return address is not allowed." }); return true; }
          const callback = new URL(ssoCallback);
          callback.searchParams.set("token", issueSsoToken(returnTo));
          redirectTo = callback.toString();
        }
        const sessionHeaders = { "set-cookie": [issueSession(res), cookie(CHALLENGE_COOKIE, "", { maxAge: 0 })] };
        if (redirectTo && requestUrl.searchParams.get("mode") === "navigate") {
          console.log("[web] shared Face ID verified; issuing HTTP redirect to Wattback callback");
          res.writeHead(303, { location: redirectTo, "cache-control": "no-store", ...sessionHeaders });
          res.end();
        } else {
          json(res, 200, { verified: true, expiresAt: Date.now() + sessionSeconds * 1000, ...(redirectTo ? { redirectTo } : {}) }, sessionHeaders);
        }
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
