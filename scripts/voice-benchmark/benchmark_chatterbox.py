import json
import os
import statistics
import time
from pathlib import Path

import torch
import torchaudio
import perth

if perth.PerthImplicitWatermarker is None:
    # The benchmark measures synthesis, not watermark resilience. Some minimal
    # GPU images lack Perth's optional native implementation.
    perth.PerthImplicitWatermarker = perth.DummyWatermarker

from chatterbox.tts_turbo import ChatterboxTurboTTS


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "results" / "chatterbox-turbo"
PROMPT = ROOT / "reference.wav"


def sync() -> None:
    if torch.cuda.is_available():
        torch.cuda.synchronize()


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    utterances = json.loads((ROOT / "utterances.json").read_text(encoding="utf-8"))
    device = "cuda" if torch.cuda.is_available() else "cpu"

    load_started = time.perf_counter()
    model = ChatterboxTurboTTS.from_pretrained(device=device)
    sync()
    load_seconds = time.perf_counter() - load_started

    model.generate("The voice benchmark is ready.", audio_prompt_path=str(PROMPT))
    sync()
    if torch.cuda.is_available():
        torch.cuda.reset_peak_memory_stats()

    rows = []
    for index, text in enumerate(utterances, start=1):
        started = time.perf_counter()
        wav = model.generate(text, audio_prompt_path=str(PROMPT))
        sync()
        generation_seconds = time.perf_counter() - started
        wav = wav.detach().cpu()
        audio_seconds = wav.shape[-1] / model.sr
        path = OUTPUT / f"{index:02d}.wav"
        torchaudio.save(str(path), wav, model.sr)
        rows.append(
            {
                "index": index,
                "text": text,
                "generation_seconds": round(generation_seconds, 4),
                "first_audio_seconds": None,
                "audio_seconds": round(audio_seconds, 4),
                "rtf": round(generation_seconds / audio_seconds, 4),
                "file": path.name,
            }
        )

    times = [row["generation_seconds"] for row in rows]
    summary = {
        "model": "Chatterbox Turbo",
        "device": device,
        "streaming_api_measured": False,
        "load_seconds": round(load_seconds, 4),
        "median_generation_seconds": round(statistics.median(times), 4),
        "p95_generation_seconds": round(sorted(times)[int(0.95 * (len(times) - 1))], 4),
        "median_rtf": round(statistics.median(row["rtf"] for row in rows), 4),
        "peak_gpu_memory_mb": round(torch.cuda.max_memory_allocated() / 1024**2, 1) if torch.cuda.is_available() else 0,
        "runs": rows,
    }
    (OUTPUT / "results.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
