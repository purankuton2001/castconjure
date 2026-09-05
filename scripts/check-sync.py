#!/usr/bin/env python3
"""
Measure audio/video sync of a recording without listening. For each reaction clip, the clip's frame
*sequence* is matched against the recording (centre crop, 20 fps) in two windows — early (0.3–2.3 s)
and late (2.6–4.8 s) — and the best time offset relative to where the audio was placed (tPlay) is reported.

  python3 scripts/check-sync.py --rec rec.webm --events events.json [--window 1.5] [--tol 0.12]

offset > 0 means the video appears LATER than the audio. Same offset in both windows = start misplaced;
different offsets = playback stalled or drifted inside the clip.
"""
import argparse, json, os, subprocess, tempfile
from PIL import Image, ImageChops, ImageStat

ap = argparse.ArgumentParser()
ap.add_argument("--rec", required=True); ap.add_argument("--events", required=True)
ap.add_argument("--window", type=float, default=1.5); ap.add_argument("--tol", type=float, default=0.12)
a = ap.parse_args()
FPS = 20; W, H = 192, 108
CROP = (int(W * 0.2), int(H * 0.12), int(W * 0.8), int(H * 0.72))  # away from the caption/badge areas
tmp = tempfile.mkdtemp(prefix="cc-sync-")

def frames(src, start, dur, prefix):
    out = os.path.join(tmp, prefix + "%05d.png")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{max(0, start):.3f}", "-t", f"{dur:.3f}", "-i", src, "-vf", f"fps={FPS},scale={W}:{H}", out], check=True)
    files = sorted(f for f in os.listdir(tmp) if f.startswith(prefix))
    return [Image.open(os.path.join(tmp, f)).convert("L").crop(CROP) for f in files]

def diff(x, y):
    return ImageStat.Stat(ImageChops.difference(x, y)).mean[0]

def best_offset(rec, rec_start, clip, tp, k0, k1):
    """offset d (s) minimising Σ_k |rec(tp+k+d) − clip(k)| for k in [k0,k1]."""
    ks = [round(k0 + 0.1 * i, 2) for i in range(int((k1 - k0) / 0.1) + 1)]
    best, best_d = float("inf"), 0.0
    steps = int(a.window / 0.05)
    for si in range(-steps, steps + 1):
        d = si * 0.05; cost = 0.0; n = 0
        for k in ks:
            ci = int(round(k * FPS)); ri = int(round((tp + k + d - rec_start) * FPS))
            if ci >= len(clip) or ri < 0 or ri >= len(rec): continue
            cost += diff(rec[ri], clip[ci]); n += 1
        if n and cost / n < best: best, best_d = cost / n, d
    return best_d, best

events = json.load(open(a.events))
worst = 0.0; results = []
for n, e in enumerate(events):
    if not e.get("audio") or e.get("tPlay") is None or not os.path.exists(e["audio"]):
        print(f'[{n}] "{e.get("comment")}": no clip file, skipped'); continue
    tp = float(e["tPlay"])
    clip = frames(e["audio"], 0, 5.2, f"c{n}_")
    rec_start = max(0.0, tp - a.window - 0.5)
    rec = frames(a.rec, rec_start, 5.2 + 2 * a.window + 1.0, f"r{n}_")
    d_early, c1 = best_offset(rec, rec_start, clip, tp, 0.3, 2.3)
    d_late, c2 = best_offset(rec, rec_start, clip, tp, 2.6, 4.8)
    mx = max(abs(d_early), abs(d_late)); worst = max(worst, mx)
    verdict = "OK" if mx <= a.tol else ("START OFF" if abs(d_early - d_late) <= a.tol else "STALL/DRIFT")
    print(f'[{n}] "{e.get("comment")}" tPlay={tp:.2f}  early {d_early:+.2f}s (cost {c1:.1f})  late {d_late:+.2f}s (cost {c2:.1f})  → {verdict}')
    results.append({"comment": e.get("comment"), "tPlay": tp, "early": d_early, "late": d_late})
print(f"worst |offset| = {worst:.2f}s ({'PASS' if worst <= a.tol else 'FAIL'}, tol {a.tol}s)")
json.dump(results, open(os.path.join(os.path.dirname(a.events), "sync.json"), "w"), indent=2)
