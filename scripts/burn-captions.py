#!/usr/bin/env python3
"""
Burn captions into a recorded overlay video (Pillow renders PNGs, ffmpeg overlays them) and mix the
reaction clips' own audio (recordings are silent) at their measured start times.

Single event:
  python3 scripts/burn-captions.py --in rec.webm --out live.mp4 --comment "dance!!" --author taro_k \
      --t-comment 4.7 --t-gen 5.0 --t-play 19.8 --latency 15.1 --audio clip.mp4 [--ack-audio ack.mp3 --t-ack 6.0]
Several events (one recording, many comments):
  python3 scripts/burn-captions.py --in rec.webm --out live.mp4 --events events.json
  events.json = [{"author","comment","reply","tComment","tGen","tPlay","latency","audio","ackAudio","tAck"}, ...]
Single clip with its own audio (montages):
  python3 scripts/burn-captions.py --in clip.mp4 --out cap.mp4 --comment .. --t-comment 0 --t-play 0 --keep-audio
"""
import argparse, json, os, subprocess, tempfile
from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument("--in", dest="src", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--events", default=None)
ap.add_argument("--comment", default="dance!!"); ap.add_argument("--author", default="taro_k"); ap.add_argument("--reply", default="")
ap.add_argument("--t-comment", type=float, default=None); ap.add_argument("--t-gen", type=float, default=None)
ap.add_argument("--t-play", type=float, default=None); ap.add_argument("--latency", default="?"); ap.add_argument("--cost", default="$0.25")
ap.add_argument("--audio", default=None); ap.add_argument("--ack-audio", default=None); ap.add_argument("--t-ack", type=float, default=None)
ap.add_argument("--keep-audio", action="store_true")
a = ap.parse_args()

if a.events:
    events = json.load(open(a.events))
else:
    events = [{"author": a.author, "comment": a.comment, "reply": a.reply, "tComment": a.t_comment, "tGen": a.t_gen, "tPlay": a.t_play,
               "latency": a.latency, "audio": a.audio, "ackAudio": a.ack_audio, "tAck": a.t_ack, "cost": a.cost}]

def font(size, bold=True, text=""):
    cands = [("/System/Library/Fonts/Hiragino Sans GB.ttc", 2 if bold else 0), ("/Library/Fonts/Arial Unicode.ttf", 0)]
    if any("\uac00" <= ch <= "\ud7a3" for ch in text): cands.reverse()  # Hiragino has no Hangul
    for p, i in cands:
        if os.path.exists(p):
            try: return ImageFont.truetype(p, size, index=i)
            except Exception: pass
    return ImageFont.load_default()

def pill(text, size, fg, pad=(14, 8), bg=(0, 0, 0, 150)):
    f = font(size, True, text); w = int(f.getbbox(text)[2]) + pad[0] * 2; h = size + pad[1] * 2 + 4
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=8, fill=bg); d.text((pad[0], pad[1]), text, font=f, fill=fg)
    return img

def bubble(name, text):
    fn, ft = font(26, True, name), font(40, True, text); head = f"{name}  ·  live chat"
    w = max(int(fn.getbbox(head)[2]) + 56, int(ft.getbbox(text)[2]) + 22) + 30; h = 26 + 40 + 44
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=16, fill=(0, 0, 0, 170)); d.rectangle([0, 10, 7, h - 10], fill=(124, 92, 255, 255))
    d.ellipse([22, 16, 46, 40], fill=(90, 200, 255, 255)); d.text((56, 14), head, font=fn, fill=(200, 200, 215, 255))
    d.text((22, 52), text, font=ft, fill=(255, 255, 255, 255))
    return img

tmp = tempfile.mkdtemp(prefix="cc-cap-")
layers = []  # (png, x, y, enable)
def add(img, x, y, enable):
    p = os.path.join(tmp, f"c{len(layers)}.png"); img.save(p); layers.append((p, x, y, enable))

dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", a.src], capture_output=True, text=True).stdout.strip() or "0")
first_tc = events[0].get("tComment")
if first_tc is not None and first_tc > 0.5:
    add(pill("waiting for chat…  (idle loop, pre-generated)", 22, (200, 200, 215, 255)), 24, 24, f"lt(t,{first_tc:.2f})")
for i, e in enumerate(events):
    tc = e.get("tComment"); tg = e.get("tGen"); tp = e.get("tPlay"); ta = e.get("tAck")
    nxt = events[i + 1].get("tComment") if i + 1 < len(events) else None
    until = nxt if nxt is not None else dur + 1
    if tc is not None:
        add(bubble(e["author"], e["comment"]), 24, 24, f"between(t,{tc:.2f},{until:.2f})")
    if tg is not None:
        add(pill("generating her reaction… (fal H3 Max Turbo)", 24, (201, 191, 255, 255)), 24, 150, f"between(t,{tg:.2f},{(tp if tp is not None else tg + 60):.2f})")
    if ta is not None and e.get("reply"):
        add(pill(f"she answers right away: “{e['reply']}”  (subtitle + cloned voice)", 24, (255, 230, 150, 255)), 24, 206, f"between(t,{ta:.2f},{(tp if tp is not None else ta + 60):.2f})")
    if tp is not None:
        add(pill(f"on screen {e.get('latency', '?')}s after the comment  ·  480p · 5s · {e.get('cost', '$0.25')}" + (f"  ·  she says: “{e['reply']}”" if e.get("reply") else ""), 24, (140, 240, 192, 255)), 24, 150, f"between(t,{tp:.2f},{until:.2f})")
badge = pill("castconjure · live recording, not edited · generated persona (AI)", 18, (255, 255, 255, 220), pad=(10, 6), bg=(0, 0, 0, 115))
add(badge, 1280 - badge.width - 24, 720 - badge.height - 24, "1")

inputs = ["-i", a.src]
for p, *_ in layers: inputs += ["-i", p]
chain, prev = [], "[0:v]"
for i, (_, x, y, en) in enumerate(layers):
    nxt = f"[v{i}]"; chain.append(f"{prev}[{i + 1}:v]overlay={x}:{y}:enable='{en}'{nxt}"); prev = nxt
maps = ["-map", prev]
tracks = []
def track(path, at):
    ai = len(layers) + 1 + len(tracks); inputs.extend(["-i", path]); ms = int(at * 1000)
    chain.append(f"[{ai}:a]adelay={ms}|{ms}[a{len(tracks)}]"); tracks.append(f"[a{len(tracks)}]")
if a.keep_audio:
    maps += ["-map", "0:a?", "-c:a", "aac", "-b:a", "160k"]
else:
    for e in events:
        if e.get("audio") and e.get("tPlay") is not None and os.path.exists(e["audio"]): track(e["audio"], e["tPlay"])
        if e.get("ackAudio") and e.get("tAck") is not None and os.path.exists(e["ackAudio"]): track(e["ackAudio"], e["tAck"])
    if tracks:
        chain.append(f"{''.join(tracks)}amix=inputs={len(tracks)}:normalize=0,apad[a]" if len(tracks) > 1 else f"{tracks[0]}apad[a]")
        maps += ["-map", "[a]", "-c:a", "aac", "-b:a", "160k", "-shortest"]
cmd = ["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(chain), *maps, "-c:v", "libx264", "-crf", "19", "-pix_fmt", "yuv420p", "-movflags", "+faststart", a.out]
subprocess.run(cmd, check=True)
print("wrote", a.out)
