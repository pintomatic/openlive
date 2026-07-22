import { GoogleGenAI } from "@google/genai";
import { getProviderApiKey, listProviders } from "@openlive/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VOICE = "Sulafat";
const MODEL = (process.env.OPENLIVE_GEMINI_TTS_MODEL || "gemini-3.1-flash-tts-preview").trim();
const MAX_TEXT_LENGTH = 1_200;
const DIRECTION = [
  "Synthesize only the transcript below.",
  "Voice direction: warm, relaxed and natural conversational English, like a calm colleague speaking across a desk.",
  "Keep it understated and slightly quick. Do not perform, announce, or over-enunciate.",
  "Transcript:",
].join("\n");

function apiKey(): string {
  const envKey = [
    process.env.OPENLIVE_GEMINI_TTS_API_KEY,
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
  ].map((value) => value?.trim()).find(Boolean);
  if (envKey) return envKey;
  const provider = listProviders().find((item) => item.kind === "google" && item.hasKey);
  return provider ? (getProviderApiKey(provider.id) ?? "") : "";
}

export function GET() {
  return NextResponse.json(
    { available: Boolean(apiKey()), voice: VOICE, model: MODEL },
    { headers: { "cache-control": "no-store" } },
  );
}

function audioData(chunk: unknown): Buffer[] {
  const response = chunk as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>;
  };
  const output: Buffer[] = [];
  for (const candidate of response?.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const data = part.inlineData?.data;
      if (data) output.push(Buffer.from(data, "base64"));
    }
  }
  return output;
}

async function nextAudio(iterator: AsyncIterator<unknown>): Promise<Buffer[] | null> {
  while (true) {
    const next = await iterator.next();
    if (next.done) return null;
    const audio = audioData(next.value);
    if (audio.length) return audio;
  }
}

export async function POST(request: Request) {
  const key = apiKey();
  if (!key) return NextResponse.json({ error: "Natural voice is not configured." }, { status: 503 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "JSON content type required." }, { status: 415 });
  }

  let text = "";
  try {
    const body = await request.json() as { text?: unknown };
    text = typeof body.text === "string" ? body.text.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!text || text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: "Speech text must be between 1 and 1200 characters." }, { status: 400 });
  }

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
  try {
    const client = new GoogleGenAI({ apiKey: key });
    const stream = await client.models.generateContentStream({
      model: MODEL,
      contents: `${DIRECTION}\n${text}`,
      config: {
        abortSignal: signal,
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } },
        },
      },
    });
    const iterator = stream[Symbol.asyncIterator]();
    const first = await nextAudio(iterator);
    if (!first) throw new Error("Gemini returned no audio data");

    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for (const chunk of first) controller.enqueue(chunk);
          while (true) {
            const audio = await nextAudio(iterator);
            if (!audio) break;
            for (const chunk of audio) controller.enqueue(chunk);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel() {
        try { await iterator.return?.(undefined); } catch { /* upstream already closed */ }
      },
    });

    return new Response(body, {
      headers: {
        "cache-control": "no-store",
        "content-type": "audio/pcm;rate=24000;channels=1",
        "x-content-type-options": "nosniff",
        "x-openlive-voice": VOICE,
      },
    });
  } catch (error) {
    if (!signal.aborted) console.error("[web] Gemini TTS failed:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Natural voice is temporarily unavailable." }, { status: 502 });
  }
}
