export const SULAFAT_VOICE_ID = "gemini:sulafat";
export const GEMINI_TTS_SAMPLE_RATE = 24_000;

interface StreamingAudioPlayer {
  play(
    audio: Float32Array,
    epoch: number,
    sampleRate?: number,
    onStart?: () => void,
  ): Promise<void> | void;
}

export interface StreamSulafatOptions {
  signal?: AbortSignal;
  epoch: number;
  onFirstAudio?: () => void;
  fetcher?: typeof fetch;
}

export interface StreamSulafatResult {
  durationMs: number;
  playbackDone: Promise<void>;
  sampleRate: number;
}

export class GeminiTtsError extends Error {
  readonly audioStarted: boolean;
  readonly playbackDone: Promise<void>;

  constructor(
    message: string,
    audioStarted = false,
    playbackDone: Promise<void> = Promise.resolve(),
  ) {
    super(message);
    this.name = "GeminiTtsError";
    this.audioStarted = audioStarted;
    this.playbackDone = playbackDone;
  }
}

function sampleRateFrom(contentType: string | null): number {
  const match = /(?:^|;)\s*rate=(\d+)/i.exec(contentType ?? "");
  const rate = Number(match?.[1]);
  return Number.isFinite(rate) && rate > 0 ? rate : GEMINI_TTS_SAMPLE_RATE;
}

function pcm16le(bytes: Uint8Array): Float32Array {
  const audio = new Float32Array(bytes.byteLength / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < audio.length; i++) audio[i] = view.getInt16(i * 2, true) / 32_768;
  return audio;
}

function joinBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const joined = new Uint8Array(a.byteLength + b.byteLength);
  joined.set(a, 0);
  joined.set(b, a.byteLength);
  return joined;
}

export async function streamSulafat(
  text: string,
  player: StreamingAudioPlayer,
  options: StreamSulafatOptions,
): Promise<StreamSulafatResult> {
  const fetcher = options.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      cache: "no-store",
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new GeminiTtsError("Natural voice is temporarily unavailable.");
  }

  if (!response.ok || !response.body) {
    throw new GeminiTtsError(`Natural voice request failed (HTTP ${response.status}).`);
  }

  const sampleRate = sampleRateFrom(response.headers.get("content-type"));
  const reader = response.body.getReader();
  let carry = new Uint8Array(0);
  let samples = 0;
  let first = true;
  let playbackDone = Promise.resolve();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      const bytes = carry.byteLength ? joinBytes(carry, value) : value;
      const evenLength = bytes.byteLength - (bytes.byteLength % 2);
      carry = evenLength < bytes.byteLength ? bytes.slice(evenLength) : new Uint8Array(0);
      if (!evenLength) continue;
      const audio = pcm16le(bytes.subarray(0, evenLength));
      samples += audio.length;
      const startsHere = first;
      first = false;
      playbackDone = Promise.resolve(player.play(
        audio,
        options.epoch,
        sampleRate,
        startsHere ? options.onFirstAudio : undefined,
      ));
    }
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new GeminiTtsError("Natural voice stream was interrupted.", samples > 0, playbackDone);
  } finally {
    reader.releaseLock();
  }

  if (carry.byteLength || samples === 0) {
    throw new GeminiTtsError("Natural voice returned no playable audio.", samples > 0, playbackDone);
  }

  return {
    durationMs: (samples / sampleRate) * 1_000,
    playbackDone,
    sampleRate,
  };
}
