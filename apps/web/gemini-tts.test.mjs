import assert from "node:assert/strict";
import test from "node:test";
import { GeminiTtsError, streamSulafat } from "./src/lib/live/geminiTts.ts";

function pcm(...samples) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  return bytes;
}

test("streams uneven PCM chunks into gapless player calls", async () => {
  const bytes = pcm(0, 16_384, -32_768, 32_767);
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, 3));
      controller.enqueue(bytes.slice(3));
      controller.close();
    },
  });
  const calls = [];
  let starts = 0;
  const player = {
    play(audio, epoch, rate, onStart) {
      calls.push({ audio: [...audio], epoch, rate, hasStart: Boolean(onStart) });
      onStart?.();
      return Promise.resolve();
    },
  };

  const result = await streamSulafat("hello", player, {
    epoch: 7,
    onFirstAudio: () => starts++,
    fetcher: async () => new Response(body, { headers: { "content-type": "audio/L16;rate=24000;channels=1" } }),
  });
  await result.playbackDone;

  assert.equal(starts, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.hasStart), [true, false]);
  assert.deepEqual(calls.map((call) => [call.epoch, call.rate]), [[7, 24_000], [7, 24_000]]);
  const rendered = calls.flatMap((call) => call.audio);
  assert.ok(Math.abs(rendered[0] - 0) < 0.0001);
  assert.ok(Math.abs(rendered[1] - 0.5) < 0.0001);
  assert.equal(rendered[2], -1);
  assert.ok(rendered[3] > 0.999);
  assert.ok(Math.abs(result.durationMs - (4 / 24_000 * 1_000)) < 0.001);
});

test("marks a failed partial stream so the engine can avoid replaying it", async () => {
  let pulls = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (pulls++ === 0) controller.enqueue(pcm(1_000));
      else controller.error(new Error("connection reset"));
    },
  });
  const player = { play: () => Promise.resolve() };

  await assert.rejects(
    () => streamSulafat("hello", player, {
      epoch: 1,
      fetcher: async () => new Response(body, { headers: { "content-type": "audio/L16;rate=24000" } }),
    }),
    (error) => error instanceof GeminiTtsError && error.audioStarted === true,
  );
});

test("passes cancellation through and treats HTTP failures as pre-audio errors", async () => {
  const controller = new AbortController();
  let receivedSignal;
  const fetcher = async (_url, init) => {
    receivedSignal = init.signal;
    return new Response("unavailable", { status: 503 });
  };
  const player = { play: () => Promise.resolve() };

  await assert.rejects(
    () => streamSulafat("hello", player, { epoch: 1, signal: controller.signal, fetcher }),
    (error) => error instanceof GeminiTtsError && error.audioStarted === false,
  );
  assert.equal(receivedSignal, controller.signal);
});
