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
ap.add_argument("--cost", default="$0.46")
ap.add_argument("--audio", default=None, help="reaction clip mp4 whose audio is mixed in at --t-play (recordings are silent)")
ap.add_argument("--reply", default="", help="the persona's reply line, shown with the comment")
ap.add_argument("--keep-audio", action="store_true", help="keep the source's own audio track (reaction clips)")
ap.add_argument("--ack-audio", default=None, help="TTS of the instant reply, mixed in at --t-ack"); ap.add_argument("--t-ack", type=float, default=None)
a = ap.parse_args()

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

# big chat bubble: avatar dot + name + comment, so it is obvious what was typed
def bubble(name, text):
    fn, ft = font(26), font(40); head = f"{name}  ·  live chat"
    w = max(int(fn.getbbox(head)[2]) + 56, int(ft.getbbox(text)[2]) + 22) + 30; h = 26 + 40 + 44
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=16, fill=(0, 0, 0, 170)); d.rectangle([0, 10, 7, h - 10], fill=(124, 92, 255, 255))
    d.ellipse([22, 16, 46, 40], fill=(90, 200, 255, 255)); d.text((56, 14), head, font=fn, fill=(200, 200, 215, 255))
    d.text((22, 52), text, font=ft, fill=(255, 255, 255, 255))
    return img
add(pill("waiting for chat…  (idle loop, pre-generated)", 22, (200, 200, 215, 255)), 24, 24, f"lt(t,{a.t_comment:.2f})")
add(bubble(a.author, a.comment), 24, 24, f"gte(t,{a.t_comment:.2f})")
if a.t_gen is not None:
    end = a.t_play if a.t_play is not None else a.t_gen + 60
    add(pill("generating her reaction… (fal H3 Max, reference-to-video)", 24, (201, 191, 255, 255)), 24, 150, f"between(t,{a.t_gen:.2f},{end:.2f})")
if a.t_ack is not None and a.reply:
    end = a.t_play if a.t_play is not None else a.t_ack + 60
    add(pill(f"she answers right away: “{a.reply}”  (subtitle + voice, TTS)", 24, (255, 230, 150, 255)), 24, 206, f"between(t,{a.t_ack:.2f},{end:.2f})")
if a.t_play is not None:
    add(pill(f"on screen {a.latency}s after the comment  ·  480p · 5s · {a.cost}" + (f"  ·  she says: “{a.reply}”" if a.reply else ""), 24, (140, 240, 192, 255)), 24, 150, f"gte(t,{a.t_play:.2f})")
badge = pill("castconjure · live recording, not edited · generated persona (AI)", 18, (255, 255, 255, 220), pad=(10, 6), bg=(0, 0, 0, 115))
add(badge, 1280 - badge.width - 24, 720 - badge.height - 24, "1")

inputs = ["-i", a.src]
for p, *_ in layers: inputs += ["-i", p]
chain, prev = [], "[0:v]"
for i, (_, x, y, en) in enumerate(layers):
    nxt = f"[v{i}]"
    chain.append(f"{prev}[{i + 1}:v]overlay={x}:{y}:enable='{en}'{nxt}"); prev = nxt
maps = ["-map", prev]
tracks = []
if a.audio and a.t_play is not None:
    ai = len(layers) + 1 + len(tracks); inputs += ["-i", a.audio]; ms = int(a.t_play * 1000)
    chain.append(f"[{ai}:a]adelay={ms}|{ms}[a{len(tracks)}]"); tracks.append(f"[a{len(tracks)}]")
if a.ack_audio and a.t_ack is not None:
    ai = len(layers) + 1 + len(tracks); inputs += ["-i", a.ack_audio]; ms = int(a.t_ack * 1000)
    chain.append(f"[{ai}:a]adelay={ms}|{ms}[a{len(tracks)}]"); tracks.append(f"[a{len(tracks)}]")
if a.keep_audio:
    maps += ["-map", "0:a?", "-c:a", "aac", "-b:a", "160k"]
elif tracks:
    chain.append(f"{''.join(tracks)}amix=inputs={len(tracks)}:normalize=0,apad[a]" if len(tracks) > 1 else f"{tracks[0]}apad[a]")
    maps += ["-map", "[a]", "-c:a", "aac", "-b:a", "160k", "-shortest"]
cmd = ["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(chain), *maps, "-c:v", "libx264", "-crf", "19", "-pix_fmt", "yuv420p", "-movflags", "+faststart", a.out]
subprocess.run(cmd, check=True)
print("wrote", a.out)
