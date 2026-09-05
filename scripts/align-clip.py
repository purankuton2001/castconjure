#!/usr/bin/env python3
"""
Find where a reaction clip starts inside a screen recording by matching frame *sequences* (no clock guessing).
Prints the clip's start time in the recording (seconds).

  python3 scripts/align-clip.py --rec rec.webm --clip clip.mp4 --approx 9.3 [--window 2.0]

Method: recording frames (20 fps, 160×90 grey) in [approx−window, approx+window+3]; clip frames for its
first 2.6 s. For each candidate start t (50 ms steps) sum |rec(t+k) − clip(k)| over k = 0.4…2.4 s and take the
minimum. Sequence matching is robust even though the clip's first frame looks like the idle loop. Pillow only.
"""
import argparse, os, subprocess, tempfile
from PIL import Image, ImageChops, ImageStat

ap = argparse.ArgumentParser()
ap.add_argument("--rec", required=True); ap.add_argument("--clip", required=True)
ap.add_argument("--approx", type=float, required=True); ap.add_argument("--window", type=float, default=2.0)
ap.add_argument("--crop", default=None, help="x:y:w:h region of the recording that shows the overlay")
a = ap.parse_args()
tmp = tempfile.mkdtemp(prefix="cc-align-")
FPS = 20; W, H = 160, 90

def frames(src, start, dur, prefix, crop=None):
    out = os.path.join(tmp, prefix + "%04d.png")
    vf = (f"crop={crop.split(':')[2]}:{crop.split(':')[3]}:{crop.split(':')[0]}:{crop.split(':')[1]}," if crop else "") + f"fps={FPS},scale={W}:{H}"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{max(0, start):.3f}", "-t", f"{dur:.3f}", "-i", src, "-vf", vf, out], check=True)
    files = sorted(f for f in os.listdir(tmp) if f.startswith(prefix))
    return [Image.open(os.path.join(tmp, f)).convert("L") for f in files]

def diff(x, y):
    return ImageStat.Stat(ImageChops.difference(x, y)).mean[0]

rec_start = max(0.0, a.approx - a.window)
rec = frames(a.rec, rec_start, a.window * 2 + 3.0, "r", a.crop)
clip = frames(a.clip, 0, 2.6, "c")
ks = [int(round(k * FPS)) for k in [0.4 + 0.2 * i for i in range(11)]]
best_t, best_cost = a.approx, float("inf")
for i in range(0, len(rec) - max(ks) - 1):
    cost = 0.0
    for k in ks:
        if k >= len(clip): break
        cost += diff(rec[i + k], clip[k])
    if cost < best_cost:
        best_cost, best_t = cost, rec_start + i / FPS
print(f"{best_t:.3f}")
