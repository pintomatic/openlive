import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"
RESULTS.mkdir(parents=True, exist_ok=True)


def read(name: str) -> dict:
    path = RESULTS / name / "results.json"
    if not path.exists():
        return {"model": name, "status": "failed", "results_available": False}
    return json.loads(path.read_text(encoding="utf-8"))


payload = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "hardware": "AWS CodeBuild Linux GPU Small, one NVIDIA A10G, 4 vCPU, 16 GiB",
    "method": "Ten fixed OpenLive-style English utterances, one warm-up, shared reference voice, one measured run per utterance.",
    "models": [read("chatterbox-turbo"), read("cosyvoice-3")],
}
(RESULTS / "summary.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
print(json.dumps(payload, indent=2))
