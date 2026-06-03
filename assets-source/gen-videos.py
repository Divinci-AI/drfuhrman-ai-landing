#!/usr/bin/env python3
"""
Batch image-to-video via Vertex VEO 3.1 Fast for the four section
marketing images. Polls all 4 LROs concurrently, downloads, converts
to WebM, and stages them under assets-source/. Intentionally NOT
uploading to R2 from here — the calling script handles that.

Usage: python3 gen-videos.py
"""
import base64, json, subprocess, sys, time, urllib.request, urllib.error
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

PROJECT = "openai-api-4375643"
LOCATION = "us-central1"
MODEL = "veo-3.0-fast-generate-001"
ENDPOINT = (
    f"https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT}"
    f"/locations/{LOCATION}/publishers/google/models/{MODEL}"
)
DURATION_SEC = 6
ASPECT = "16:9"

PUBLIC = Path(__file__).parent.parent / "public" / "marketing"
OUT_DIR = Path(__file__).parent / "videos"
OUT_DIR.mkdir(exist_ok=True)

# Each entry: (slug, image filename, motion prompt for VEO)
TASKS = [
    (
        "corpus",
        "corpus.jpg",
        "Slow, very gentle camera push-in toward the open book and warm "
        "desk lamp. Faint steam rises from a teacup. Pages of the open "
        "book stir almost imperceptibly. Soft archival, contemplative.",
    ),
    (
        "examples",
        "examples.jpg",
        "A subtle dolly-in from over the shoulder onto the smartphone "
        "screen, the green chat bubbles gently pulsing as if a new "
        "message arrived. Warm morning kitchen light softly shifts. "
        "The person smiles slightly.",
    ),
    (
        "mobile-app",
        "mobile-app.jpg",
        "Camera holds steady. The phone in the foreground tilts a few "
        "degrees as the person frames the produce. A soft green analysis "
        "ring on the phone screen rotates and pulses subtly. Farmers-"
        "market activity stays softly blurred in the background.",
    ),
    (
        "offline-ai",
        "offline-ai.jpg",
        "Clouds drift slowly past the airplane window in soft golden-hour "
        "light. The traveler's thumb scrolls smoothly down the chat "
        "interface on the phone. Cabin light is warm and stable.",
    ),
]


def gcloud_token() -> str:
    return (
        subprocess.run(
            ["gcloud", "auth", "print-access-token"],
            check=True,
            capture_output=True,
            text=True,
        )
        .stdout.strip()
    )


def submit(slug: str, image_path: Path, prompt: str, token: str) -> str:
    img_b64 = base64.b64encode(image_path.read_bytes()).decode("ascii")
    body = {
        "instances": [
            {
                "prompt": prompt,
                "image": {
                    "bytesBase64Encoded": img_b64,
                    "mimeType": "image/jpeg",
                },
            }
        ],
        "parameters": {
            "aspectRatio": ASPECT,
            "durationSeconds": DURATION_SEC,
            "sampleCount": 1,
            "personGeneration": "allow_all",
        },
    }
    req = urllib.request.Request(
        f"{ENDPOINT}:predictLongRunning",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(f"[{slug}] submit failed: {e.code} {e.read()[:400]}", file=sys.stderr)
        raise
    op_name = data["name"]
    print(f"[{slug}] LRO started: {op_name.split('/')[-1]}")
    return op_name


def poll(slug: str, op_name: str, token: str) -> dict:
    poll_url = (
        f"https://{LOCATION}-aiplatform.googleapis.com/v1/"
        f"{ENDPOINT.split('/v1/')[1]}"
        ":fetchPredictOperation"
    )
    body = {"operationName": op_name}
    started = time.time()
    while True:
        req = urllib.request.Request(
            poll_url,
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read())
        except urllib.error.HTTPError as e:
            print(f"[{slug}] poll error: {e.code} {e.read()[:300]}", file=sys.stderr)
            time.sleep(8)
            continue
        if data.get("done"):
            elapsed = int(time.time() - started)
            if "error" in data:
                print(f"[{slug}] FAILED in {elapsed}s: {data['error']}", file=sys.stderr)
                raise RuntimeError(data["error"])
            print(f"[{slug}] complete in {elapsed}s")
            return data["response"]
        # progress hint
        progress = data.get("metadata", {}).get("progressPercent")
        if progress:
            print(f"[{slug}] {progress}%")
        time.sleep(8)


def write_mp4(slug: str, response: dict) -> Path:
    preds = response.get("predictions") or response.get("videos") or []
    if not preds:
        # Vertex may also return under "generatedSamples" — be liberal
        preds = response.get("generatedSamples", [])
    if not preds:
        raise RuntimeError(f"[{slug}] no predictions in response: {json.dumps(response)[:300]}")
    sample = preds[0]
    b64 = (
        sample.get("bytesBase64Encoded")
        or sample.get("video", {}).get("bytesBase64Encoded")
    )
    if not b64:
        raise RuntimeError(f"[{slug}] no bytes in sample: {json.dumps(sample)[:300]}")
    out = OUT_DIR / f"{slug}.mp4"
    out.write_bytes(base64.b64decode(b64))
    print(f"[{slug}] wrote {out} ({out.stat().st_size:,} bytes)")
    return out


def to_webm(slug: str, mp4_path: Path) -> Path:
    out = OUT_DIR / f"{slug}.webm"
    # VP9 / Opus — solid web compat. CRF 32 gets us ~300-600 KB for 5s 720p,
    # which is the right LCP budget for an autoplay hero loop.
    cmd = [
        "ffmpeg",
        "-y",
        "-i", str(mp4_path),
        "-c:v", "libvpx-vp9",
        "-b:v", "0",
        "-crf", "32",
        "-row-mt", "1",
        "-deadline", "good",
        "-cpu-used", "2",
        "-an",  # no audio — these are silent ambient loops
        str(out),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    print(f"[{slug}] WebM {out.stat().st_size:,} bytes")
    return out


def run_one(slug: str, img_name: str, prompt: str) -> tuple[str, Path]:
    token = gcloud_token()
    op = submit(slug, PUBLIC / img_name, prompt, token)
    resp = poll(slug, op, token)
    mp4 = write_mp4(slug, resp)
    webm = to_webm(slug, mp4)
    return slug, webm


def main() -> None:
    print(f"Generating {len(TASKS)} VEO 3.1 fast videos…")
    failed: list[str] = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(run_one, *t): t[0] for t in TASKS}
        for f in futures:
            try:
                f.result()
            except Exception as e:
                failed.append(futures[f])
                print(f"[{futures[f]}] ❌ {e}", file=sys.stderr)
    print(f"\nDone. Failed: {failed or 'none'}")


if __name__ == "__main__":
    main()
