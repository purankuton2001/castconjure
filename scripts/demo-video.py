#!/usr/bin/env python3
"""
Render the castconjure demo video (1280x720, 30 fps, ~24 s) for X / README.

  python3 scripts/demo-video.py                       # mock clips (procedural, labelled "mock")
  python3 scripts/demo-video.py --clips a.mp4,b.mp4   # real H3 clips (from data/clips or gen:once)
  python3 scripts/demo-video.py --out docs/demo.mp4 --gif docs/demo.gif --hero docs/hero.png

Needs: Pillow, ffmpeg on PATH. Fonts are looked up from macOS system fonts (Hiragino / Avenir / Menlo),
falling back to Arial Unicode.
"""
from __future__ import annotations

import argparse
import math
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1280, 720, 30
ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------- fonts
def _font(candidates: list[tuple[str, int]], size: int) -> ImageFont.FreeTypeFont:
    for path, idx in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size, index=idx)
            except Exception:
                continue
    return ImageFont.load_default()

JP_BOLD = [("/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc", 0), ("/System/Library/Fonts/Hiragino Sans GB.ttc", 2), ("/Library/Fonts/Arial Unicode.ttf", 0)]
JP_REG = [("/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc", 0), ("/System/Library/Fonts/Hiragino Sans GB.ttc", 0), ("/Library/Fonts/Arial Unicode.ttf", 0)]
DISPLAY = [("/System/Library/Fonts/Avenir Next.ttc", 8), ("/System/Library/Fonts/Avenir Next.ttc", 0), ("/Library/Fonts/Arial Unicode.ttf", 0)]
MONO = [("/System/Library/Fonts/Menlo.ttc", 0), ("/Library/Fonts/Arial Unicode.ttf", 0)]

_cache: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}
def F(kind: str, size: int) -> ImageFont.FreeTypeFont:
    k = (kind, size)
    if k not in _cache:
        _cache[k] = _font({"jpb": JP_BOLD, "jp": JP_REG, "disp": DISPLAY, "mono": MONO}[kind], size)
    return _cache[k]

# ---------------------------------------------------------------- palette
BG = (15, 17, 23)
PANEL = (23, 26, 35)
LINE = (42, 46, 60)
INK = (232, 233, 238)
MUT = (139, 144, 160)
ACC = (124, 92, 255)
ACC_DEEP = (74, 52, 170)
OK = (62, 207, 142)
RED = (255, 61, 61)

# ---------------------------------------------------------------- helpers
def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))

def ease(t):
    t = clamp(t)
    return 1 - (1 - t) ** 3

def lerp(a, b, t):
    return a + (b - a) * t

def mix(c1, c2, t):
    return tuple(int(lerp(a, b, t)) for a, b in zip(c1, c2))

def gradient(w, h, top, bottom, horizontal=False):
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    n = w if horizontal else h
    for i in range(n):
        c = mix(top, bottom, i / max(1, n - 1))
        if horizontal:
            d.line([(i, 0), (i, h)], fill=c)
        else:
            d.line([(0, i), (w, i)], fill=c)
    return img

def text_w(font, s):
    return font.getbbox(s)[2]

def wrap(font, s, max_w):
    lines, cur = [], ""
    for ch in s:
        if text_w(font, cur + ch) > max_w and cur:
            lines.append(cur); cur = ch
        else:
            cur += ch
    if cur: lines.append(cur)
    return lines or [""]

def pill(d: ImageDraw.ImageDraw, xy, text, font, fill, ink, pad=(12, 5), radius=999, alpha_img=None):
    x, y = xy
    w = text_w(font, text) + pad[0] * 2
    h = font.size + pad[1] * 2 + 2
    d.rounded_rectangle([x, y, x + w, y + h], radius=min(radius, h // 2), fill=fill)
    d.text((x + pad[0], y + pad[1] - 1), text, font=font, fill=ink)
    return w, h

def paste_rgba(base: Image.Image, layer: Image.Image, xy, opacity=1.0):
    if opacity <= 0:
        return
    if opacity < 1:
        a = layer.getchannel("A").point(lambda v: int(v * opacity))
        layer = layer.copy()
        layer.putalpha(a)
    base.alpha_composite(layer, dest=(int(xy[0]), int(xy[1])))

# ---------------------------------------------------------------- mock clips (procedural, honest placeholders)
def clip_cat_surf(w, h, t):
    """A cat on a surfboard riding sunset waves."""
    img = gradient(w, h, (255, 150, 90), (90, 60, 160))
    d = ImageDraw.Draw(img)
    # sun
    d.ellipse([w * 0.62, h * 0.18, w * 0.62 + h * 0.34, h * 0.18 + h * 0.34], fill=(255, 220, 120))
    # sea
    sea = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sea)
    for k, (col, amp, spd, base) in enumerate([((40, 90, 190, 255), 8, 1.6, 0.56), ((30, 120, 210, 255), 10, 1.2, 0.64), ((20, 150, 230, 255), 12, 0.9, 0.74)]):
        pts = [(x, h * base + amp * math.sin(x / 34 + t * spd + k)) for x in range(0, w + 8, 8)]
        sd.polygon(pts + [(w, h), (0, h)], fill=col)
    img.paste(sea, (0, 0), sea)
    d = ImageDraw.Draw(img)
    # board + cat bob with the wave
    cx, cy = w * 0.42, h * 0.60 + 8 * math.sin(t * 1.6 + 1.2)
    tilt = 6 * math.sin(t * 1.6)
    board = Image.new("RGBA", (int(w * 0.34), int(h * 0.09)), (0, 0, 0, 0))
    ImageDraw.Draw(board).ellipse([0, 0, board.width - 1, board.height - 1], fill=(250, 240, 200, 255), outline=(220, 120, 80, 255), width=3)
    board = board.rotate(tilt, expand=True, resample=Image.BICUBIC)
    img.paste(board, (int(cx - board.width / 2), int(cy - board.height / 2)), board)
    d = ImageDraw.Draw(img)
    # cat
    bx, by = cx - w * 0.02, cy - h * 0.13
    r = h * 0.09
    d.ellipse([bx - r * 1.2, by - r * 0.2, bx + r * 1.2, by + r * 1.3], fill=(250, 170, 80))  # body
    d.ellipse([bx - r, by - r * 1.6, bx + r, by + r * 0.2], fill=(250, 180, 90))  # head
    d.polygon([(bx - r * 0.9, by - r * 1.2), (bx - r * 0.7, by - r * 2.2), (bx - r * 0.2, by - r * 1.5)], fill=(250, 180, 90))
    d.polygon([(bx + r * 0.9, by - r * 1.2), (bx + r * 0.7, by - r * 2.2), (bx + r * 0.2, by - r * 1.5)], fill=(250, 180, 90))
    for ex in (-0.4, 0.4):
        d.ellipse([bx + ex * r - r * 0.13, by - r * 0.85, bx + ex * r + r * 0.13, by - r * 0.55], fill=(40, 30, 40))
    d.arc([bx - r * 0.3, by - r * 0.6, bx + r * 0.3, by - r * 0.2], 0, 180, fill=(120, 60, 60), width=2)
    # tail
    d.arc([bx + r * 0.9, by - r * 0.2, bx + r * 2.2, by + r * 1.1], 200, 340, fill=(250, 170, 80), width=int(r * 0.25))
    # spray
    for i in range(6):
        px = cx - w * 0.2 + i * 12 + 6 * math.sin(t * 5 + i)
        py = cy + 10 - 14 * abs(math.sin(t * 4 + i * 0.7))
        d.ellipse([px, py, px + 6, py + 6], fill=(240, 250, 255))
    return img

def clip_dragon_ramen(w, h, t):
    """A green dragon slurping ramen in a warm noodle shop."""
    img = gradient(w, h, (120, 50, 40), (40, 20, 25))
    d = ImageDraw.Draw(img)
    # lantern glow
    for i, lx in enumerate((0.15, 0.8)):
        r = h * 0.09
        cx, cy = w * lx, h * 0.2 + 3 * math.sin(t * 2 + i)
        glow = Image.new("RGBA", (int(r * 6), int(r * 6)), (0, 0, 0, 0))
        ImageDraw.Draw(glow).ellipse([0, 0, glow.width, glow.height], fill=(255, 150, 60, 70))
        glow = glow.filter(ImageFilter.GaussianBlur(r))
        img.paste(glow, (int(cx - glow.width / 2), int(cy - glow.height / 2)), glow)
        d = ImageDraw.Draw(img)
        d.ellipse([cx - r * 0.6, cy - r, cx + r * 0.6, cy + r], fill=(230, 70, 50), outline=(255, 200, 120), width=2)
    # counter
    d.rectangle([0, h * 0.72, w, h], fill=(90, 55, 35))
    d.rectangle([0, h * 0.72, w, h * 0.75], fill=(130, 85, 50))
    # bowl
    bx, by, bw = w * 0.5, h * 0.62, w * 0.34
    d.ellipse([bx - bw / 2, by - bw * 0.16, bx + bw / 2, by + bw * 0.16], fill=(245, 235, 220))
    d.chord([bx - bw / 2, by - bw * 0.35, bx + bw / 2, by + bw * 0.45], 0, 180, fill=(40, 40, 60))
    d.ellipse([bx - bw / 2 + 8, by - bw * 0.12, bx + bw / 2 - 8, by + bw * 0.12], fill=(210, 150, 60))
    for k in range(7):  # noodles
        pts = [(bx - bw * 0.36 + k * bw * 0.11 + 4 * math.sin(x / 9 + t * 3 + k), by - bw * 0.08 + x * 0.4) for x in range(0, 40, 4)]
        d.line(pts, fill=(250, 225, 150), width=3)
    # steam
    for k in range(5):
        ph = (t * 0.5 + k * 0.23) % 1.0
        sx = bx - bw * 0.25 + k * bw * 0.12 + 10 * math.sin(ph * 6 + k)
        sy = by - bw * 0.15 - ph * h * 0.28
        rr = 8 + ph * 10
        st = Image.new("RGBA", (int(rr * 2), int(rr * 2)), (0, 0, 0, 0))
        ImageDraw.Draw(st).ellipse([0, 0, st.width - 1, st.height - 1], fill=(255, 255, 255, int(110 * (1 - ph))))
        img.paste(st, (int(sx - rr), int(sy - rr)), st)
        d = ImageDraw.Draw(img)
    # dragon (behind bowl, head bobbing to slurp)
    hx, hy = bx + bw * 0.42, h * 0.32 + 10 * abs(math.sin(t * 2.2))
    r = h * 0.12
    d.ellipse([hx - r * 0.4, hy + r * 0.4, hx + r * 2.2, hy + r * 2.6], fill=(70, 160, 90))  # body
    d.ellipse([hx - r, hy - r * 0.6, hx + r * 0.9, hy + r * 0.9], fill=(80, 180, 100))  # head
    d.ellipse([hx - r * 1.5, hy + r * 0.1, hx - r * 0.2, hy + r * 0.8], fill=(80, 180, 100))  # snout
    for k in range(3):  # spikes
        sx0 = hx - r * 0.2 + k * r * 0.45
        d.polygon([(sx0, hy - r * 0.55), (sx0 + r * 0.2, hy - r * 1.1), (sx0 + r * 0.4, hy - r * 0.5)], fill=(200, 90, 70))
    d.ellipse([hx - r * 0.55, hy - r * 0.25, hx - r * 0.2, hy + r * 0.1], fill=(255, 255, 255))
    d.ellipse([hx - r * 0.45, hy - r * 0.15, hx - r * 0.28, hy + 0.02 * r], fill=(20, 20, 30))
    d.ellipse([hx - r * 1.1, hy + r * 0.3, hx - r * 0.95, hy + r * 0.45], fill=(30, 60, 40))
    # chopsticks + noodle being slurped
    d.line([(hx - r * 1.2, hy + r * 0.6), (bx + bw * 0.1, by - bw * 0.05)], fill=(160, 110, 60), width=4)
    d.line([(hx - r * 1.05, hy + r * 0.7), (bx + bw * 0.16, by - bw * 0.02)], fill=(160, 110, 60), width=4)
    d.line([(hx - r * 1.3, hy + r * 0.55), (bx + bw * 0.05, by)], fill=(250, 225, 150), width=3)
    return img

MOCK_CLIPS = [clip_cat_surf, clip_dragon_ramen]

class ClipSource:
    """Yields frames for the overlay clip box. Real mp4s are pre-extracted with ffmpeg."""
    def __init__(self, w, h, real_paths: list[str] | None):
        self.w, self.h = w, h
        self.real = []
        self.tmp = None
        if real_paths:
            self.tmp = tempfile.mkdtemp(prefix="cc-demo-")
            for i, p in enumerate(real_paths):
                out = Path(self.tmp) / f"c{i}"
                out.mkdir()
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", p, "-vf", f"fps={FPS},scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}", str(out / "%04d.png")], check=True)
                self.real.append(sorted(out.glob("*.png")))

    def frame(self, idx: int, local_t: float) -> Image.Image:
        if self.real:
            frames = self.real[idx % len(self.real)]
            f = frames[min(len(frames) - 1, int(local_t * FPS))]
            return Image.open(f).convert("RGB")
        img = MOCK_CLIPS[idx % len(MOCK_CLIPS)](self.w, self.h, local_t)
        d = ImageDraw.Draw(img)
        d.text((8, self.h - 18), "mock clip — swap for a real H3 clip", font=F("mono", 10), fill=(255, 255, 255))
        return img

# ---------------------------------------------------------------- scene data
CHAT = [  # (t, name, color, text, cast)
    (3.0, "ゆき", (255, 170, 90), "こんばんは〜", False),
    (3.8, "taro_k", (90, 200, 255), "今日も配信ありがとう", False),
    (4.8, "みかん", (255, 120, 170), "猫がサーフィンしてる", True),
    (6.6, "ren", (140, 230, 140), "え？なにこれ", False),
    (8.6, "ゆき", (255, 170, 90), "出たwwww", False),
    (9.7, "taro_k", (90, 200, 255), "みかんのコメントが映像になってる", False),
    (10.8, "kazu", (200, 160, 255), "ドラゴンがラーメン食べてる", True),
    (12.4, "sora", (255, 220, 120), "自分のも出るかな", False),
    (14.6, "みかん", (255, 120, 170), "自分のが出て嬉しい", False),
    (15.6, "ren", (140, 230, 140), "次おれのやつ！", False),
    (16.6, "ゆき", (255, 170, 90), "ラーメンwww", False),
    (17.6, "sora", (255, 220, 120), "宇宙でペンギンがダンス", True),
]
# overlay timeline: (generating_from, play_from, play_to, clip_idx, name, text)
GEN_LAG = 3.0
OVERLAY = [
    (5.1, 8.2, 13.2, 0, "みかん", "猫がサーフィンしてる"),
    (11.1, 13.4, 18.4, 1, "kazu", "ドラゴンがラーメン食べてる"),
    (17.9, 21.0, 26.0, 0, "sora", "宇宙でペンギンがダンス"),
]
T_TITLE, T_SCENE, T_END, T_TOTAL = 2.4, 2.4, 20.6, 24.4

# ---------------------------------------------------------------- static layers
VID = (24, 64, 924, 570)  # x0,y0,x1,y1 of the stream video box
CLIP_W, CLIP_H = 380, 214

def build_page_bg():
    img = Image.new("RGBA", (W, H), BG + (255,))
    d = ImageDraw.Draw(img)
    # chat panel
    d.rounded_rectangle([948, 64, 1256, 570], radius=10, fill=PANEL + (255,), outline=LINE + (255,))
    d.line([(948, 104), (1256, 104)], fill=LINE + (255,))
    d.text((964, 76), "チャット", font=F("jpb", 15), fill=INK)
    d.rounded_rectangle([964, 526, 1240, 556], radius=8, fill=BG + (255,), outline=LINE + (255,))
    d.text((976, 533), "メッセージを入力…", font=F("jp", 13), fill=MUT)
    # title row
    d.text((24, 26), "castconjure demo stream", font=F("jpb", 18), fill=INK)
    x = 24 + text_w(F("jpb", 18), "castconjure demo stream") + 14
    pill(d, (x, 24), "LIVE", F("disp", 12), RED, (255, 255, 255), pad=(8, 3))
    d.text((24, 586), "purankuton2001", font=F("mono", 13), fill=MUT)
    d.text((24, 606), "コメントを唱えると、映像が現れる。 OBS ブラウザソース 1 枚 · BYOK · MIT", font=F("jp", 14), fill=MUT)
    return img

def build_game_bg():
    """A stand-in for 'whatever you already stream': a synthwave road at night."""
    w, h = VID[2] - VID[0], VID[3] - VID[1]
    img = gradient(w, h, (18, 12, 50), (60, 20, 90))
    d = ImageDraw.Draw(img)
    # sun
    sun = Image.new("RGBA", (300, 300), (0, 0, 0, 0))
    ImageDraw.Draw(sun).ellipse([0, 0, 299, 299], fill=(255, 110, 150, 255))
    for yy in range(160, 300, 14):
        ImageDraw.Draw(sun).rectangle([0, yy, 300, yy + 5], fill=(0, 0, 0, 0))
    img.paste(sun, (w // 2 - 150, int(h * 0.12)), sun)
    d = ImageDraw.Draw(img)
    d.rectangle([0, h * 0.55, w, h], fill=(10, 6, 30))
    # stars
    import random
    rnd = random.Random(7)
    for _ in range(90):
        sx, sy = rnd.randint(0, w), rnd.randint(0, int(h * 0.5))
        d.point((sx, sy), fill=(200, 200, 255))
    return img

def draw_grid(d: ImageDraw.ImageDraw, ox, oy, w, h, t):
    horizon = oy + h * 0.55
    # perspective verticals
    for k in range(-9, 10):
        d.line([(ox + w / 2 + k * 28, horizon), (ox + w / 2 + k * 260, oy + h)], fill=(120, 60, 200), width=1)
    # moving horizontals
    for k in range(12):
        p = ((k / 12) + (t * 0.35)) % 1.0
        y = horizon + (p ** 2.2) * (h * 0.45)
        d.line([(ox, y), (ox + w, y)], fill=mix((60, 30, 110), (200, 120, 255), p), width=1 + int(p * 2))

def draw_mascot(img: Image.Image, cx, cy, r, t):
    """The streamer's own mascot (a round plankton with a top hat) in a face-cam circle."""
    layer = Image.new("RGBA", (int(r * 2.6), int(r * 2.6)), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    c = layer.width / 2
    d.ellipse([0, 0, layer.width - 1, layer.height - 1], fill=(20, 22, 34, 235), outline=ACC + (255,), width=3)
    bob = 3 * math.sin(t * 3)
    d.ellipse([c - r * 0.75, c - r * 0.6 + bob, c + r * 0.75, c + r * 0.85 + bob], fill=(90, 170, 255, 255))
    for ex in (-0.3, 0.3):
        d.ellipse([c + ex * r - r * 0.15, c - r * 0.2 + bob, c + ex * r + r * 0.15, c + r * 0.1 + bob], fill=(255, 255, 255, 255))
        d.ellipse([c + ex * r - r * 0.06, c - r * 0.1 + bob, c + ex * r + r * 0.06, c + 0.02 * r + bob], fill=(20, 20, 40, 255))
    blink = (t % 3.7) < 0.12
    if blink:
        d.rectangle([c - r * 0.5, c - r * 0.2 + bob, c + r * 0.5, c + r * 0.1 + bob], fill=(90, 170, 255, 255))
    d.arc([c - r * 0.25, c + r * 0.15 + bob, c + r * 0.25, c + r * 0.45 + bob], 0, 180, fill=(20, 20, 40, 255), width=3)
    d.rectangle([c - r * 0.32, c - r * 0.92 + bob, c + r * 0.32, c - r * 0.62 + bob], fill=(30, 30, 40, 255))
    d.rectangle([c - r * 0.5, c - r * 0.66 + bob, c + r * 0.5, c - r * 0.58 + bob], fill=(30, 30, 40, 255))
    d.rectangle([c - r * 0.32, c - r * 0.72 + bob, c + r * 0.32, c - r * 0.66 + bob], fill=ACC + (255,))
    img.alpha_composite(layer, dest=(int(cx - c), int(cy - c)))

# ---------------------------------------------------------------- frame renderer
class Renderer:
    def __init__(self, clips: ClipSource, mock: bool):
        self.page = build_page_bg()
        self.game = build_game_bg().convert("RGBA")
        self.clips = clips
        self.mock = mock

    def title_card(self, t, fade_in=True):
        img = Image.new("RGBA", (W, H), BG + (255,))
        d = ImageDraw.Draw(img)
        a = ease(t / 0.6)
        col = mix(BG, INK, a)
        f = F("disp", 96)
        s = "castconjure"
        d.text(((W - text_w(f, s)) / 2, 230 + (1 - a) * 14), s, font=f, fill=col)
        f2 = F("jpb", 30)
        s2 = "コメントを唱えると、映像が現れる"
        a2 = ease((t - 0.35) / 0.6)
        d.text(((W - text_w(f2, s2)) / 2, 360), s2, font=f2, fill=mix(BG, ACC, a2))
        f3 = F("jp", 18)
        s3 = "Your live chat becomes 5-second video clips — on the stream you already have."
        a3 = ease((t - 0.7) / 0.6)
        d.text(((W - text_w(f3, s3)) / 2, 420), s3, font=f3, fill=mix(BG, MUT, a3))
        return img

    def end_card(self, t):
        img = Image.new("RGBA", (W, H), BG + (255,))
        d = ImageDraw.Draw(img)
        a = ease(t / 0.5)
        f = F("disp", 72)
        s = "castconjure"
        d.text(((W - text_w(f, s)) / 2, 170), s, font=f, fill=mix(BG, INK, a))
        f2 = F("jpb", 24)
        s2 = "いまの配信画面はそのまま。コメントが 5 秒の映像になって差し込まれる。"
        d.text(((W - text_w(f2, s2)) / 2, 280), s2, font=f2, fill=mix(BG, INK, ease((t - 0.2) / 0.5)))
        pills = ["OSS · MIT", "BYOK（fal / YouTube のキーは自分のもの）", "YouTube Live 対応", "OBS ブラウザソース 1 枚", "1 クリップ ≈ $0.25"]
        pf = F("jp", 15)
        total = sum(text_w(pf, p) + 28 for p in pills) + 10 * (len(pills) - 1)
        x = (W - total) / 2
        for i, p in enumerate(pills):
            ai = ease((t - 0.4 - i * 0.08) / 0.4)
            w_, _ = pill(d, (x, 350), p, pf, mix(BG, PANEL, ai), mix(BG, INK, ai), pad=(14, 6))
            x += w_ + 10
        f3 = F("mono", 22)
        s3 = "github.com/purankuton2001/castconjure"
        d.text(((W - text_w(f3, s3)) / 2, 450), s3, font=f3, fill=mix(BG, ACC, ease((t - 0.8) / 0.5)))
        return img

    def scene(self, t):
        img = self.page.copy()
        # --- the stream video box
        vx0, vy0, vx1, vy1 = VID
        vw, vh = vx1 - vx0, vy1 - vy0
        game = self.game.copy()
        draw_grid(ImageDraw.Draw(game), 0, 0, vw, vh, t)
        mask = Image.new("L", (vw, vh), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, vw - 1, vh - 1], radius=10, fill=255)
        game.putalpha(mask)
        img.alpha_composite(game, dest=(vx0, vy0))
        draw_mascot(img, vx0 + 78, vy0 + 78, 44, t)
        d = ImageDraw.Draw(img)
        d.text((vx0 + 148, vy0 + 62), "your stream as-is", font=F("mono", 12), fill=(200, 200, 230))
        d.text((vx0 + 148, vy0 + 80), "camera · game · VTuber", font=F("mono", 12), fill=(150, 150, 190))

        # --- overlay (bottom-right of the video box), exactly like public/overlay.html
        for gen_from, p_from, p_to, ci, name, text in OVERLAY:
            playing = p_from <= t < p_to
            generating = gen_from <= t < p_from
            # when a clip is still playing, the real overlay keeps it; the placeholder waits
            busy = any(pf <= t < pt for pf, pt, in [(o[1], o[2]) for o in OVERLAY if o is not (gen_from, p_from, p_to, ci, name, text)])
            if generating and busy:
                continue
            if not (playing or generating):
                continue
            alpha = ease((t - (p_from if playing else gen_from)) / 0.35)
            if playing:
                alpha = min(alpha, ease((p_to - t) / 0.35))
            ox = vx1 - 24 - CLIP_W
            oy = vy1 - 24 - CLIP_H - 44
            layer = Image.new("RGBA", (CLIP_W, CLIP_H + 48), (0, 0, 0, 0))
            ld = ImageDraw.Draw(layer)
            ld.rounded_rectangle([0, 0, CLIP_W - 1, CLIP_H - 1], radius=12, fill=(10, 10, 16, 220))
            if playing:
                fr = self.clips.frame(ci, t - p_from).resize((CLIP_W, CLIP_H))
                m = Image.new("L", (CLIP_W, CLIP_H), 0)
                ImageDraw.Draw(m).rounded_rectangle([0, 0, CLIP_W - 1, CLIP_H - 1], radius=12, fill=255)
                fr = fr.convert("RGBA")
                fr.putalpha(m)
                layer.alpha_composite(fr)
            else:
                ang = (t * 360) % 360
                cx, cy = CLIP_W / 2 - 60, CLIP_H / 2
                ld.arc([cx - 12, cy - 12, cx + 12, cy + 12], ang, ang + 270, fill=ACC + (255,), width=3)
                ld.text((cx + 26, cy - 12), "生成中…", font=F("jpb", 20), fill=(235, 235, 240, 255))
            ld.rounded_rectangle([0, 0, CLIP_W - 1, CLIP_H - 1], radius=12, outline=(255, 255, 255, 30), width=2)
            # author pill + AI badge
            pf = F("jpb", 16)
            label = f"{name} のコメント"
            pw = text_w(pf, label) + 32
            ld.rounded_rectangle([0, CLIP_H + 8, pw, CLIP_H + 40], radius=16, fill=(0, 0, 0, 170))
            ld.rectangle([0, CLIP_H + 8, 6, CLIP_H + 40], fill=ACC + (255,))
            ld.text((18, CLIP_H + 13), label, font=pf, fill=(255, 255, 255, 255))
            bf = F("jp", 11)
            bl = "AI生成 / AI generated"
            bw = text_w(bf, bl) + 16
            ld.rounded_rectangle([CLIP_W - bw, CLIP_H + 12, CLIP_W, CLIP_H + 36], radius=5, fill=(0, 0, 0, 150))
            ld.text((CLIP_W - bw + 8, CLIP_H + 16), bl, font=bf, fill=(220, 220, 225, 255))
            paste_rgba(img, layer, (ox, oy + (1 - alpha) * 10), alpha)
            d = ImageDraw.Draw(img)
            if playing:
                hud = f"comment → screen {p_from - gen_from + 0.3:.1f}s   ·   480p · 5s   ·   $0.25"
                d.text((vx0 + 20, vy1 - 30), hud, font=F("mono", 12), fill=(210, 210, 230))

        # --- chat panel messages (newest at bottom, scroll up)
        rows = [m for m in CHAT if m[0] <= t]
        y = 512
        nf, tf = F("jpb", 13), F("jp", 14)
        for (mt, name, color, text, cast) in reversed(rows):
            a = ease((t - mt) / 0.25)
            lines = wrap(tf, text, 250)
            rh = 22 + 20 * len(lines)
            y -= rh
            if y < 112:
                break
            row = Image.new("RGBA", (292, rh), (0, 0, 0, 0))
            rd = ImageDraw.Draw(row)
            if cast and t >= mt + 0.3:
                glow = ease((t - mt - 0.3) / 0.4)
                rd.rounded_rectangle([0, 0, 291, rh - 4], radius=6, fill=ACC_DEEP + (int(120 * glow),))
                rd.rectangle([0, 2, 3, rh - 6], fill=ACC + (int(255 * glow),))
            rd.ellipse([8, 5, 24, 21], fill=color + (255,))
            rd.text((32, 3), name, font=nf, fill=color + (255,))
            if cast and t >= mt + 0.3:
                rd.text((32 + text_w(nf, name) + 8, 4), "→ casting", font=F("mono", 11), fill=(200, 190, 255, 255))
            for i, ln in enumerate(lines):
                rd.text((32, 22 + 20 * i), ln, font=tf, fill=INK + (255,))
            paste_rgba(img, row, (956, y + (1 - a) * 6), a)
        return img

    def frame(self, t):
        if t < T_TITLE:
            img = self.title_card(t)
            fo = ease((T_TITLE - t) / 0.3)
            return self._fade(img, fo)
        if t < T_END:
            img = self.scene(t - T_SCENE + 2.4)
            fi = ease((t - T_SCENE) / 0.4)
            fo = ease((T_END - t) / 0.4)
            return self._fade(img, min(fi, fo))
        img = self.end_card(t - T_END)
        return self._fade(img, ease((T_TOTAL - t) / 0.4))

    @staticmethod
    def _fade(img, a):
        if a >= 1:
            return img
        black = Image.new("RGBA", img.size, BG + (255,))
        return Image.blend(black, img, a)

# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "docs" / "demo.mp4"))
    ap.add_argument("--gif", default=str(ROOT / "docs" / "demo.gif"))
    ap.add_argument("--hero", default=str(ROOT / "docs" / "hero.png"))
    ap.add_argument("--clips", default="", help="comma-separated real clip mp4s (else procedural mock clips)")
    ap.add_argument("--no-gif", action="store_true")
    args = ap.parse_args()
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg not found on PATH")
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    real = [p for p in args.clips.split(",") if p.strip()] or None
    clips = ClipSource(CLIP_W, CLIP_H, real)
    r = Renderer(clips, mock=real is None)

    n = int(T_TOTAL * FPS)
    ff = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-movflags", "+faststart", args.out],
        stdin=subprocess.PIPE,
    )
    hero_t = 9.6
    for i in range(n):
        t = i / FPS
        img = r.frame(t)
        if abs(t - hero_t) < 1 / FPS / 2:
            img.convert("RGB").save(args.hero)
        ff.stdin.write(img.convert("RGB").tobytes())
        if i % FPS == 0:
            print(f"\r{t:5.1f}s / {T_TOTAL}s", end="", flush=True)
    ff.stdin.close()
    ff.wait()
    print(f"\nwrote {args.out}")
    if not args.no_gif:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "4.2", "-t", "10.4", "-i", args.out,
                        "-vf", "fps=15,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4",
                        args.gif], check=True)
        print(f"wrote {args.gif}")
    print(f"wrote {args.hero}")
    if clips.tmp:
        shutil.rmtree(clips.tmp, ignore_errors=True)

if __name__ == "__main__":
    main()
