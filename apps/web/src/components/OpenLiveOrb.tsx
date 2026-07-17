"use client";

import { useEffect, useId, useRef } from "react";
import type { LivePhase } from "@/lib/live/liveStore";

// The OpenLive mark: a lit orb with a five-bar waveform CARVED into it. ONE
// component everywhere: the animated in-call orb, the home hero + top-bar logo
// (idle pulse), and a static favicon.
//
// Live states (animated by getLevels):
//   idle       → a slow, gentle breathing wave
//   listening  → a soundwave that rides YOUR mic level (traveling across the bars)
//   speaking   → the same soundwave, riding the AGENT's voice level
//   thinking/… → a distinct traveling "working" ripple (no rings)
// Bars ease toward their target each frame and the palette CROSS-FADES via CSS, so
// a state change morphs. While listening or speaking the orb also emits soft rings.
const BARS = [0.5, 0.78, 1, 0.78, 0.5];
const BAR_W = 6.4, GAP = 5.6, MAX_H = 62, FLAT = 6, CY = 50;
const SPAN = MAX_H - FLAT;
const START_X = (100 - (BARS.length * BAR_W + (BARS.length - 1) * GAP)) / 2;
const restH = (i: number) => FLAT + BARS[i]! * SPAN * 0.62;
const BUSY = new Set<LivePhase>(["thinking", "connecting", "loading", "reconnecting"]);
const VOICE = new Set<LivePhase>(["listening", "speaking"]); // soundwave + rings

type Palette = { hi: string; mid: string; lo: string; ring: string; glow: string };
// Per-phase so the mark itself signals state: green hearing you, blue speaking,
// amber working, calm neutral idle.
function paletteFor(phase: LivePhase): Palette {
  switch (phase) {
    case "listening": return { hi: "#d8f1e1", mid: "#5f9b78", lo: "#244d36", ring: "#79aa8d", glow: "#5f9b78" };
    case "speaking": return { hi: "#d5eeea", mid: "#4f9e96", lo: "#1f5e59", ring: "#70b7af", glow: "#4f9e96" };
    case "thinking": case "connecting": case "loading": case "reconnecting":
      return { hi: "#eef1cf", mid: "#a8b968", lo: "#5c6f2d", ring: "#b6c77b", glow: "#a8b968" };
    default: return { hi: "#e0ebe4", mid: "#779483", lo: "#345544", ring: "#8da999", glow: "#779483" };
  }
}

export function OpenLiveOrb({ phase = "idle", getLevels, getBands, size = 240, pulse = false }: {
  phase?: LivePhase;
  getLevels?: () => { mic: number; agent: number };
  getBands?: () => { mic: number[]; agent: number[] }; // per-octave-band energy → real spectrum
  size?: number;
  pulse?: boolean; // idle breathing for the static marks (no getLevels)
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const rects = useRef<(SVGRectElement | null)[]>([]);
  const heights = useRef<number[]>(BARS.map((_, i) => restH(i)));
  const env = useRef(0); // smoothed voice envelope (0..1) — steadies the level
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const p = paletteFor(phase);
  // Rings only on the big animated orb, and only while listening/speaking.
  const rings = !!getLevels && size >= 96 && VOICE.has(phase);
  const cTrans = "0.55s var(--ease-out-quart)"; // palette cross-fade

  useEffect(() => {
    if (!getLevels) return;
    const reduce = matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const hs = heights.current;
    let raf = 0, t0 = 0;
    const loop = (ms: number) => {
      if (!t0) t0 = ms;
      const time = (ms - t0) / 1000;
      const ph = phaseRef.current;
      const isVoice = VOICE.has(ph);
      const isBusy = BUSY.has(ph);
      // A SYMMETRIC voice bell driven by the live spectrum: fold the octave bands
      // into a mirror shape (low/voice → center, mid → inner, high → edges) so both
      // sides always match — no lopsided bass-heavy side. Compressed (sqrt) so loud
      // passages swell rather than slam, with a gentle wobble so it feels alive.
      const bands = isVoice && getBands ? (ph === "listening" ? getBands().mic : getBands().agent) : null;
      let sym: number[] | null = null;
      if (bands) {
        const lowMid = ((bands[0] ?? 0) + (bands[1] ?? 0)) / 2;
        const mid = bands[2] ?? 0;
        const high = ((bands[3] ?? 0) + (bands[4] ?? 0)) / 2;
        sym = [high, mid, lowMid, mid, high]; // mirror: edges=high, inner=mid, center=voice body
      }
      let envRaw = 0;
      if (isVoice && !bands) { const { mic, agent } = getLevels(); envRaw = Math.min(1, ph === "listening" ? mic * 5 : agent * 6); }
      env.current += (envRaw - env.current) * (envRaw > env.current ? 0.5 : 0.12);
      for (let i = 0; i < rects.current.length; i++) {
        let target: number;
        if (sym) {
          const v = Math.sqrt(Math.max(0, Math.min(1, sym[i]!)));            // perceptual (compress loud)
          const wob = 0.05 * Math.sin(time * 3 + Math.abs(i - 2) * 0.7);     // symmetric shimmer → alive at rest
          const amp = Math.max(BARS[i]! * 0.1, BARS[i]! * (0.14 + wob) + v * 0.6);
          target = FLAT + SPAN * Math.min(0.9, amp);
        } else if (isVoice) {
          const A = Math.max(0.16, env.current);                            // fallback amplitude wave
          const wave = 0.5 + 0.5 * Math.sin(time * 7 - i * 0.95);
          target = FLAT + BARS[i]! * SPAN * (0.32 + 0.68 * A) * wave;
        } else if (isBusy) {
          const w = 0.5 + 0.5 * Math.sin(time * 4.5 - i * 1.05);            // "working" ripple
          target = FLAT + 3 + BARS[i]! * SPAN * 0.5 * w;
        } else {
          const breath = 0.5 + 0.5 * Math.sin(time * 1.7 + i * 0.55);        // idle → a slow gentle breathing wave
          target = FLAT + BARS[i]! * SPAN * 0.14 * breath;
        }
        if (reduce) target = FLAT + BARS[i]! * SPAN * (isVoice || isBusy ? 0.3 : 0.06);
        const h = hs[i]! + (target - hs[i]!) * 0.28;                         // ease → smooth, still responsive
        hs[i] = h;
        const el = rects.current[i];
        if (el) { el.setAttribute("height", String(h)); el.setAttribute("y", String(CY - h / 2)); }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [getLevels, getBands]);

  const barCls = pulse ? `olw-${uid}` : undefined;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden
      style={{ overflow: "visible", filter: `drop-shadow(0 0 ${Math.round(size * 0.045)}px ${p.glow})`, transition: `filter ${cTrans}`, display: "block" }}>
      <defs>
        <radialGradient id={`disc-${uid}`} cx="38%" cy="30%" r="80%">
          <stop offset="0%" style={{ stopColor: p.hi, transition: `stop-color ${cTrans}` }} />
          <stop offset="52%" style={{ stopColor: p.mid, transition: `stop-color ${cTrans}` }} />
          <stop offset="100%" style={{ stopColor: p.lo, transition: `stop-color ${cTrans}` }} />
        </radialGradient>
        <linearGradient id={`well-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#111f38" stopOpacity="0.97" />
          <stop offset="100%" stopColor="#04060c" stopOpacity="0.97" />
        </linearGradient>
      </defs>
      {(pulse || rings) && (
        <style>{
          `@keyframes olwk-${uid}{0%,100%{transform:scaleY(1)}50%{transform:scaleY(.5)}}` +
          `.olw-${uid}{transform-box:fill-box;transform-origin:center;animation:olwk-${uid} 1.6s ease-in-out infinite}` +
          `@keyframes olwr-${uid}{0%{transform:scale(.9);opacity:.5}100%{transform:scale(1.75);opacity:0}}` +
          `.olwr-${uid}{transform-box:fill-box;transform-origin:center;animation:olwr-${uid} 2.6s var(--ease-out-quart) infinite}`
        }</style>
      )}
      {/* soft rings emitted outward while listening / speaking */}
      {rings && [0, 1, 2].map((k) => (
        <circle key={`r${k}`} className={`olwr-${uid}`} cx="50" cy="50" r="47" fill="none"
          style={{ stroke: p.ring, transition: `stroke ${cTrans}`, animationDelay: `${k * 0.87}s` }}
          strokeWidth="1" />
      ))}
      <circle cx="50" cy="50" r="47" fill={`url(#disc-${uid})`} />
      <circle cx="50" cy="50" r="47" fill="none" strokeOpacity="0.5" strokeWidth="1.3"
        style={{ stroke: p.ring, transition: `stroke ${cTrans}` }} />
      {BARS.map((_, i) => {
        const h = heights.current[i]!;
        return (
          <rect key={i} ref={(el) => { rects.current[i] = el; }} className={barCls}
            x={START_X + i * (BAR_W + GAP)} y={CY - h / 2} width={BAR_W} height={h}
            rx={BAR_W / 2} fill={`url(#well-${uid})`} stroke="#ffffff" strokeOpacity="0.12" strokeWidth="0.5"
            style={pulse ? { animationDelay: `${i * 0.12}s` } : undefined} />
        );
      })}
    </svg>
  );
}
