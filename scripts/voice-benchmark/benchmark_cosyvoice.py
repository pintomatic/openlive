import json
import statistics
import sys
import time
from pathlib import Path

import torch
import torchaudio


ROOT = Path(__file__).resolve().parent
REPO = ROOT / "CosyVoice"
OUTPUT = ROOT / "results" / "cosyvoice-3"
PROMPT = ROOT / "reference.wav"
MODEL_DIR = REPO / "pretrained_models" / "Fun-CosyVoice3-0.5B"

sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "third_party" / "Matcha-TTS"))

from cosyvoice.cli.cosyvoice import AutoModel  # noqa: E402


def sync() -> None:
    if torch.cuda.is_available():
        torch.cuda.synchronize()


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    utterances = json.loads((ROOT / "utterances.json").read_text(encoding="utf-8"))

    load_started = time.perf_counter()
    model = AutoModel(model_dir=str(MODEL_DIR), fp16=torch.cuda.is_available())
    sync()
    load_seconds = time.perf_counter() - load_started

    list(model.inference_cross_lingual("The voice benchmark is ready.", str(PROMPT), stream=True))
    sync()
    if torch.cuda.is_available():
        torch.cuda.reset_peak_memory_stats()

    rows = []
    for index, text in enumerate(utterances, start=1):
        chunks = []
        first_audio_seconds = None
        started = time.perf_counter()
        for result in model.inference_cross_lingual(text, str(PROMPT), stream=True):
            sync()
            if first_audio_seconds is None:
                first_audio_seconds = time.perf_counter() - started
            chunks.append(result["tts_speech"].detach().cpu())
        sync()
        generation_seconds = time.perf_counter() - started
        wav = torch.cat(chunks, dim=-1)
        audio_seconds = wav.shape[-1] / model.sample_rate
        path = OUTPUT / f"{index:02d}.wav"
        torchaudio.save(str(path), wav, model.sample_rate)
        rows.append(
            {
                "index": index,
                "text": text,
                "generation_seconds": round(generation_seconds, 4),
                "first_audio_seconds": round(first_audio_seconds, 4) if first_audio_seconds is not None else None,
                "audio_seconds": round(audio_seconds, 4),
                "rtf": round(generation_seconds / audio_seconds, 4),
                "file": path.name,
            }
        )

    times = [row["generation_seconds"] for row in rows]
    first_times = [row["first_audio_seconds"] for row in rows if row["first_audio_seconds"] is not None]
    summary = {
        "model": "CosyVoice 3 0.5B",
        "device": "cuda" if torch.cuda.is_available() else "cpu",
        "streaming_api_measured": True,
        "load_seconds": round(load_seconds, 4),
        "median_generation_seconds": round(statistics.median(times), 4),
        "p95_generation_seconds": round(sorted(times)[int(0.95 * (len(times) - 1))], 4),
        "median_first_audio_seconds": round(statistics.median(first_times), 4),
        "p95_first_audio_seconds": round(sorted(first_times)[int(0.95 * (len(first_times) - 1))], 4),
        "median_rtf": round(statistics.median(row["rtf"] for row in rows), 4),
        "peak_gpu_memory_mb": round(torch.cuda.max_memory_allocated() / 1024**2, 1) if torch.cuda.is_available() else 0,
        "runs": rows,
    }
    (OUTPUT / "results.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
