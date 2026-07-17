# CODEX HANDOVER — OpenLive push-to-talk + install-as-app + Face ID gate

**For:** Codex (owner of the OpenLive / code-local-ops branch)
**From:** Blekkie (Fable), 2026-07-17, at Cesar's direction
**Why:** Cesar is running OpenLive live and loving the voice loop (talks to his Kernal counterpart through Ray-Ban glasses as a BT headset). He wants three additions for the iPhone experience. OpenLive is your live AWS deploy (live.52.49.250.39.sslip.io) — build, TEST on the live surface, deploy. Do NOT break the working voice loop; ship additively.

## The three changes (apps/web)

### 1. Push-to-talk mode
Add an explicit push-to-talk affordance alongside the current always-listening VAD. A large tap-and-hold (or tap-to-start / tap-to-stop) mic button that gates a single turn: press → capture → on release run the existing on-device STT → send the existing `{t:"user_text", text}` over the live WS → speak the `text_delta` reply. Reuse `apps/web/src/lib/live/voiceEngine.ts` and `liveClient.ts` exactly; this is a UI + turn-gating layer, not a protocol change. Keep VAD mode available; add a toggle. Rationale: hands-free VAD misfires as a general BT-headset mic; push-to-talk is the reliable primary for the glasses.

### 2. Install-as-app (PWA)
Make the web app installable on iOS home screen: `manifest.webmanifest` (name "OpenLive", standalone display, theme/bg, 192+512 icons), apple-touch-icon, `apple-mobile-web-app-capable`, and a minimal service worker for the app shell (do NOT cache the live WS or auth state). Goal: launches full-screen from the home icon, one tap to the talk button.

### 3. Face ID per-session gate (this is the security caveat Cesar asked for)
Cesar wants it to authenticate EVERY launch (it reads his whole graph and can write keeper actions), but as a Face ID glance, not a typed password. Implement WebAuthn/passkey: on each app open, require a `navigator.credentials.get()` platform-authenticator assertion (registered once) before the WS/auth session is established. On iOS Safari/standalone this triggers Face ID. Fail closed — no Kernal read/write until the assertion passes. This layers ON TOP of the existing single-user auth (`apps/web/auth.mjs` + the web proxy that injects `x-openlive-secret`); do not move the agent secret to the client. Keep the current auth as the backstop.

## Constraints
- Additive only. The existing voice loop must keep working through the whole change.
- Deploy timing: Cesar is actively using the live service tonight (Kailua evening). Deploy when he's NOT mid-conversation, or behind a flag he opts into.
- Test on the live surface end to end: install to home screen on an iPhone, Face ID gate fires each launch, push-to-talk through a BT headset produces a spoken Kernal answer.
- Fail-closed writes and the HUB #468 OpenLive rules stay in force.

## Out of scope (later, Oslo, Dordi's Mac)
The native hands-free "Hi Kernal" wake-word app (VisionClaw-style, DAT SDK) built straight to Cesar's iPhone. Not this handover.
