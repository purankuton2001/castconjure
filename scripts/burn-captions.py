#!/usr/bin/env python3
"""
Burn captions into a recorded overlay video without ffmpeg's drawtext (Pillow renders PNGs, ffmpeg overlays them).
Called by scripts/record-live.mjs; usable standalone:

  python3 scripts/burn-captions.py --in rec.webm --out docs/live.mp4 --comment "dance!!" --author taro_k \
      --t-comment 4.7 --t-gen 5.0 --t-play 19.8 --latency 15.1
"""
import argparse, os, subprocess, tempfile
from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument("--in", dest="src", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--comment", default="dance!!"); ap.add_argument("--author", default="taro_k")
ap.add_argument("--t-comment", type=float, required=True); ap.add_argument("--t-gen", type=float, default=None)
ap.add_argument("--t-play", type=float, default=None); ap.add_argument("--latency", default="?")
ap.add_argument("--cost", default="$0.46"); a = ap.parse_args()

def font(size, bold=True):
    for p, i in [("/System/Library/Fonts/Hiragino Sans GB.ttc", 2 if bold else 0), ("/Library/Fonts/Arial Unicode.ttf", 0)]:
        if os.path.exists(p):
            try: return ImageFont.truetype(p, size, index=i)
            except Exception: pass
    return ImageFont.load_default()

def pill(text, size, fg, pad=(14, 8), bg=(0, 0, 0, 150)):
    f = font(size); w = int(f.getbbox(text)[2]) + pad[0] * 2; h = size + pad[1] * 2 + 4
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=8, fill=bg); d.text((pad[0], pad[1]), text, font=f, fill=fg)
    return img

tmp = tempfile.mkdtemp(prefix="cc-cap-")
layers = []  # (png, x, y, enable)
def add(img, x, y, enable):
    p = os.path.join(tmp, f"c{len(layers)}.png"); img.save(p); layers.append((p, x, y, enable))

add(pill(f"chat · {a.author}: {a.comment}", 28, (255, 255, 255, 255)), 24, 24, f"gte(t,{a.t_comment:.2f})")
if a.t_gen is not None:
    end = a.t_play if a.t_play is not None else a.t_gen + 60
    add(pill("generating…", 22, (201, 191, 255, 255)), 24, 84, f"between(t,{a.t_gen:.2f},{end:.2f})")
if a.t_play is not None:
    add(pill(f"on screen {a.latency}s after the comment  ·  reference-to-video 480p · 5s · {a.cost}", 22, (140, 240, 192, 255)), 24, 84, f"gte(t,{a.t_play:.2f})")
badge = pill("castconjure · live recording, not edited · generated persona (AI)", 18, (255, 255, 255, 220), pad=(10, 6), bg=(0, 0, 0, 115))
add(badge, 1280 - badge.width - 24, 720 - badge.height - 24, "1")

inputs = ["-i", a.src]
for p, *_ in layers: inputs += ["-i", p]
chain, prev = [], "[0:v]"
for i, (_, x, y, en) in enumerate(layers):
    nxt = f"[v{i}]"
    chain.append(f"{prev}[{i + 1}:v]overlay={x}:{y}:enable='{en}'{nxt}"); prev = nxt
cmd = ["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(chain), "-map", prev, "-c:v", "libx264", "-crf", "19", "-pix_fmt", "yuv420p", "-movflags", "+faststart", a.out]
subprocess.run(cmd, check=True)
print("wrote", a.out)
