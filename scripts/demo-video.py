#!/usr/bin/env python3
"""
Render the castconjure demo video (1280x720, 30 fps, ~28 s) for X / README — v0.7 (persona-first).

  python3 scripts/demo-video.py                                   # mock: procedural illustration of 白詰ゆい
  python3 scripts/demo-video.py --idle i1.mp4,i2.mp4 --clips r1.mp4,r2.mp4,r3.mp4   # real H3 clips
  python3 scripts/demo-video.py --out docs/demo.mp4 --gif docs/demo.gif --hero docs/hero.png

Storyboard: title → the persona idles full-frame on a YouTube-like page with live chat → a viewer casts
"dance!!" → she replies (subtitle) and a reaction clip crossfades in → back to idle → "eat ramen" →
"let's go to the beach" (scene change) → end card. English-first; a little Korean and Japanese in chat. Mock frames are labelled "mock"; real clips replace them 1:1.

Needs: Pillow, ffmpeg on PATH. Fonts from macOS system fonts (Hiragino / Avenir / Menlo), fallback Arial Unicode.
"""
from __future__ import annotations

import argparse
import math
import os
import random
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1280, 720, 30
ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------- fonts
def _font(candidates, size):
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
UNI = [("/Library/Fonts/Arial Unicode.ttf", 0), ("/System/Library/Fonts/Supplemental/Arial Unicode.ttf", 0)]
_cache = {}
def F(kind, size):
    k = (kind, size)
    if k not in _cache:
        _cache[k] = _font({"jpb": JP_BOLD, "jp": JP_REG, "disp": DISPLAY, "mono": MONO, "uni": UNI}[kind], size)
    return _cache[k]

def FT(kind, size, text):
    """Font for text: Hangul needs Arial Unicode (Hiragino has no Korean)."""
    return F("uni", size) if any("\uac00" <= ch <= "\ud7a3" for ch in text) else F(kind, size)

# ---------------------------------------------------------------- palette
BG = (15, 17, 23); PANEL = (23, 26, 35); LINE = (42, 46, 60); INK = (232, 233, 238); MUT = (139, 144, 160)
ACC = (124, 92, 255); ACC_DEEP = (74, 52, 170); RED = (255, 61, 61)
# 白詰ゆい
SKIN = (246, 222, 205); SKIN_SH = (232, 196, 176); HAIR = (58, 40, 34); HAIR_HI = (86, 62, 52); LAV = (196, 180, 240)
CARDI = (206, 192, 240); SHIRT = (250, 249, 252); PANTS = (40, 40, 52); INK_EYE = (40, 30, 40); BLUSH = (250, 170, 160)

# ---------------------------------------------------------------- helpers
def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))
def ease(t): t = clamp(t); return 1 - (1 - t) ** 3
def lerp(a, b, t): return a + (b - a) * t
def mix(c1, c2, t): return tuple(int(lerp(a, b, t)) for a, b in zip(c1, c2))

def gradient(w, h, top, bottom):
    img = Image.new("RGB", (w, h)); d = ImageDraw.Draw(img)
    for i in range(h):
        d.line([(0, i), (w, i)], fill=mix(top, bottom, i / max(1, h - 1)))
    return img

def text_w(font, s): return font.getbbox(s)[2]

def wrap(font, s, max_w):
    lines, cur = [], ""
    for ch in s:
        if text_w(font, cur + ch) > max_w and cur: lines.append(cur); cur = ch
        else: cur += ch
    if cur: lines.append(cur)
    return lines or [""]

def pill(d, xy, text, font, fill, ink, pad=(12, 5)):
    x, y = xy; w = text_w(font, text) + pad[0] * 2; h = font.size + pad[1] * 2 + 2
    d.rounded_rectangle([x, y, x + w, y + h], radius=h // 2, fill=fill)
    d.text((x + pad[0], y + pad[1] - 1), text, font=font, fill=ink)
    return w, h

def paste_rgba(base, layer, xy, opacity=1.0):
    if opacity <= 0: return
    if opacity < 1:
        layer = layer.copy(); layer.putalpha(layer.getchannel("A").point(lambda v: int(v * opacity)))
    base.alpha_composite(layer, dest=(int(xy[0]), int(xy[1])))

def rounded_mask(w, h, r):
    m = Image.new("L", (w, h), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, h - 1], radius=r, fill=255); return m

# ---------------------------------------------------------------- 白詰ゆい (procedural stand-in for the photoreal persona)
def draw_yui(img, cx, cy, s, t, pose="idle", face_dir=0.0):
    """Draw Yui centred at (cx, cy) with head radius s. pose: idle | dance | eat | beach."""
    d = ImageDraw.Draw(img)
    breath = math.sin(t * 1.6) * s * 0.03
    bob = 0.0
    if pose == "dance":
        bob = -abs(math.sin(t * 6.3)) * s * 0.25
    if pose == "eat":
        bob = math.sin(t * 4.4) * s * 0.06 + s * 0.12
    hy = cy + breath + bob                      # head centre y
    torso_top = hy + s * 0.95
    torso_h = s * 2.1 if pose != "beach" else s * 2.3
    tilt = math.sin(t * 6.3) * 0.18 if pose == "dance" else 0.0
    # --- back hair (behind everything)
    d.ellipse([cx - s * 1.18, hy - s * 1.15, cx + s * 1.18, hy + s * 1.35], fill=HAIR)
    d.rectangle([cx - s * 1.18, hy, cx + s * 1.18, hy + s * 1.05], fill=HAIR)
    # inner lavender (visible at the tips)
    d.chord([cx - s * 1.18, hy + s * 0.55, cx + s * 1.18, hy + s * 1.55], 0, 180, fill=LAV)
    d.chord([cx - s * 1.05, hy + s * 0.45, cx + s * 1.05, hy + s * 1.35], 0, 180, fill=HAIR)
    # --- body
    bx = cx + tilt * s
    # cardigan (lavender), shirt (white) inside
    d.rounded_rectangle([bx - s * 1.45, torso_top, bx + s * 1.45, torso_top + torso_h], radius=int(s * 0.5), fill=CARDI)
    d.rounded_rectangle([bx - s * 0.55, torso_top, bx + s * 0.55, torso_top + torso_h * 0.9], radius=int(s * 0.25), fill=SHIRT)
    d.polygon([(bx - s * 0.55, torso_top), (bx, torso_top + s * 0.55), (bx + s * 0.55, torso_top)], fill=SKIN)
    # neck
    d.rectangle([cx - s * 0.28, hy + s * 0.85, cx + s * 0.28, torso_top + s * 0.1], fill=SKIN_SH)
    # arms
    arm_w = int(s * 0.42)
    if pose == "dance":
        for side in (-1, 1):
            ph = t * 6.3 + (0 if side < 0 else math.pi)
            ex = bx + side * (s * 1.6 + s * 0.6 * abs(math.sin(ph)))
            ey = torso_top + s * 0.4 - s * 1.6 * abs(math.sin(ph)) - s * 0.3
            d.line([(bx + side * s * 1.2, torso_top + s * 0.5), (ex, ey)], fill=CARDI, width=arm_w)
            d.ellipse([ex - s * 0.24, ey - s * 0.24, ex + s * 0.24, ey + s * 0.24], fill=SKIN)
    elif pose == "eat":
        # left hand holds the bowl edge, right hand holds chopsticks up to the mouth
        lx, ly = bx - s * 1.0, torso_top + s * 1.55
        d.line([(bx - s * 1.2, torso_top + s * 0.5), (lx, ly)], fill=CARDI, width=arm_w)
        d.ellipse([lx - s * 0.24, ly - s * 0.24, lx + s * 0.24, ly + s * 0.24], fill=SKIN)
        rx, ry = bx + s * 0.55, hy + s * 0.75 + math.sin(t * 4.4) * s * 0.1
        d.line([(bx + s * 1.2, torso_top + s * 0.5), (rx, ry)], fill=CARDI, width=arm_w)
        d.ellipse([rx - s * 0.24, ry - s * 0.24, rx + s * 0.24, ry + s * 0.24], fill=SKIN)
        d.line([(rx, ry), (rx - s * 0.5, ry + s * 1.2)], fill=(170, 120, 70), width=max(2, int(s * 0.06)))
        d.line([(rx + s * 0.12, ry), (rx - s * 0.35, ry + s * 1.2)], fill=(170, 120, 70), width=max(2, int(s * 0.06)))
        d.line([(rx - s * 0.42, ry + s * 1.1), (rx - s * 0.2, ry + s * 0.3), (cx + s * 0.05, hy + s * 0.55)], fill=(250, 225, 150), width=max(2, int(s * 0.07)))
    elif pose == "beach":
        for side in (-1, 1):
            ex = bx + side * s * 1.55; ey = torso_top + torso_h * 0.85 + math.sin(t * 2 + side) * s * 0.05
            d.line([(bx + side * s * 1.2, torso_top + s * 0.5), (ex, ey)], fill=CARDI, width=arm_w)
            d.ellipse([ex - s * 0.24, ey - s * 0.24, ex + s * 0.24, ey + s * 0.24], fill=SKIN)
    else:  # idle: hands in lap, one hand lifts a mug now and then
        mug = (t % 9.0) > 6.0
        lx, ly = bx - s * 0.9, torso_top + torso_h * 0.85
        d.line([(bx - s * 1.2, torso_top + s * 0.5), (lx, ly)], fill=CARDI, width=arm_w)
        d.ellipse([lx - s * 0.24, ly - s * 0.24, lx + s * 0.24, ly + s * 0.24], fill=SKIN)
        if mug:
            k = ease(((t % 9.0) - 6.0) / 0.6) * (1 - ease(((t % 9.0) - 8.2) / 0.6))
            rx, ry = bx + s * 0.75, torso_top + torso_h * 0.85 - k * s * 1.6
        else:
            rx, ry = bx + s * 0.9, torso_top + torso_h * 0.85
        d.line([(bx + s * 1.2, torso_top + s * 0.5), (rx, ry)], fill=CARDI, width=arm_w)
        d.ellipse([rx - s * 0.24, ry - s * 0.24, rx + s * 0.24, ry + s * 0.24], fill=SKIN)
        d.rounded_rectangle([rx - s * 0.32, ry - s * 0.5, rx + s * 0.32, ry + s * 0.1], radius=int(s * 0.1), fill=(250, 250, 250), outline=(200, 200, 210))
    # --- head
    d.ellipse([cx - s, hy - s, cx + s, hy + s * 1.02], fill=SKIN)
    # bangs (dark bob front)
    d.chord([cx - s * 1.05, hy - s * 1.12, cx + s * 1.05, hy + s * 0.5], 190, 350, fill=HAIR)
    d.polygon([(cx - s * 1.03, hy - s * 0.3), (cx - s * 0.6, hy - s * 0.55), (cx - s * 0.75, hy + s * 0.35)], fill=HAIR)
    d.polygon([(cx + s * 1.03, hy - s * 0.3), (cx + s * 0.6, hy - s * 0.55), (cx + s * 0.75, hy + s * 0.35)], fill=HAIR)
    d.arc([cx - s * 0.7, hy - s * 1.0, cx + s * 0.2, hy - s * 0.2], 200, 300, fill=HAIR_HI, width=max(2, int(s * 0.05)))
    # clover hair pin (left side of her face = viewer's left)
    px, py = cx - s * 0.72, hy - s * 0.62
    for ang in (0, 90, 180, 270):
        ox, oy = math.cos(math.radians(ang)) * s * 0.09, math.sin(math.radians(ang)) * s * 0.09
        d.ellipse([px + ox - s * 0.08, py + oy - s * 0.08, px + ox + s * 0.08, py + oy + s * 0.08], fill=(255, 255, 255))
    d.ellipse([px - s * 0.03, py - s * 0.03, px + s * 0.03, py + s * 0.03], fill=(220, 220, 240))
    # eyes: round, slightly downturned, blink
    blink = (t % 4.3) < 0.13
    ex_off = face_dir * s * 0.08
    for side in (-1, 1):
        ex = cx + side * s * 0.38 + ex_off; ey = hy + s * 0.05 + (side * s * 0.02)
        if blink:
            d.line([(ex - s * 0.16, ey), (ex + s * 0.16, ey)], fill=INK_EYE, width=max(2, int(s * 0.05)))
        else:
            d.ellipse([ex - s * 0.15, ey - s * 0.17, ex + s * 0.15, ey + s * 0.17], fill=(255, 255, 255))
            d.ellipse([ex - s * 0.1, ey - s * 0.12, ex + s * 0.1, ey + s * 0.13], fill=INK_EYE)
            d.ellipse([ex - s * 0.05, ey - s * 0.09, ex + s * 0.01, ey - s * 0.03], fill=(255, 255, 255))
        # brows: thick, natural
        d.arc([ex - s * 0.2, ey - s * 0.42, ex + s * 0.2, ey - s * 0.12], 200, 340, fill=HAIR, width=max(2, int(s * 0.06)))
    # freckles + blush
    for i, (fx, fy) in enumerate(((-0.55, 0.32), (-0.45, 0.4), (0.5, 0.33), (0.6, 0.41), (0.42, 0.44))):
        d.ellipse([cx + fx * s - s * 0.02, hy + fy * s - s * 0.02, cx + fx * s + s * 0.02, hy + fy * s + s * 0.02], fill=(214, 170, 150))
    d.ellipse([cx - s * 0.75, hy + s * 0.25, cx - s * 0.35, hy + s * 0.45], fill=BLUSH)
    d.ellipse([cx + s * 0.35, hy + s * 0.25, cx + s * 0.75, hy + s * 0.45], fill=BLUSH)
    # mouth
    if pose == "eat":
        o = 0.5 + 0.5 * math.sin(t * 4.4)
        d.ellipse([cx - s * 0.16, hy + s * 0.5, cx + s * 0.16, hy + s * 0.5 + s * 0.22 * o + s * 0.04], fill=(120, 50, 60))
    elif pose == "dance":
        d.chord([cx - s * 0.28, hy + s * 0.35, cx + s * 0.28, hy + s * 0.75], 0, 180, fill=(120, 50, 60))
        d.rectangle([cx - s * 0.22, hy + s * 0.55, cx + s * 0.22, hy + s * 0.6], fill=(255, 255, 255))
    else:
        d.arc([cx - s * 0.25, hy + s * 0.3, cx + s * 0.25, hy + s * 0.7], 10, 170, fill=(120, 50, 60), width=max(2, int(s * 0.05)))

# ---------------------------------------------------------------- scenes (the "clips")
def room_bg(w, h, t, dusk=0.0):
    img = gradient(w, h, mix((255, 205, 150), (120, 90, 140), dusk), mix((215, 160, 120), (60, 40, 80), dusk))
    d = ImageDraw.Draw(img)
    # window with golden light
    d.rounded_rectangle([w * 0.58, h * 0.08, w * 0.92, h * 0.55], radius=12, fill=mix((255, 236, 190), (150, 110, 160), dusk), outline=(120, 90, 70), width=6)
    d.line([(w * 0.75, h * 0.08), (w * 0.75, h * 0.55)], fill=(120, 90, 70), width=5)
    d.line([(w * 0.58, h * 0.31), (w * 0.92, h * 0.31)], fill=(120, 90, 70), width=5)
    glow = Image.new("RGBA", (int(w * 0.6), int(h * 0.9)), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([0, 0, glow.width - 1, glow.height - 1], fill=(255, 220, 160, 70))
    glow = glow.filter(ImageFilter.GaussianBlur(40))
    img.paste(glow, (int(w * 0.5), int(h * 0.05)), glow)
    d = ImageDraw.Draw(img)
    # floor + rug
    d.rectangle([0, h * 0.68, w, h], fill=mix((176, 132, 96), (70, 50, 60), dusk))
    d.ellipse([w * 0.1, h * 0.72, w * 0.7, h * 1.05], fill=mix((120, 150, 110), (60, 80, 70), dusk))
    # plants
    for i, (px, ph) in enumerate(((0.06, 0.55), (0.16, 0.45), (0.95, 0.5))):
        stem = (60, 100, 60)
        d.line([(w * px, h * 0.72), (w * px, h * (0.72 - ph * 0.6))], fill=stem, width=6)
        for k in range(5):
            ly = h * (0.72 - ph * 0.6) + k * h * ph * 0.11
            sway = math.sin(t * 0.8 + k + i) * 4
            d.ellipse([w * px - 34 + sway, ly - 12, w * px + 34 + sway, ly + 12], fill=(70 + k * 10, 140 + k * 8, 80))
        d.rounded_rectangle([w * px - 26, h * 0.7, w * px + 26, h * 0.8], radius=6, fill=(150, 100, 70))
    # small desk with an empty ramen bowl (her signature set piece)
    d.rectangle([w * 0.62, h * 0.6, w * 0.98, h * 0.64], fill=(140, 100, 70))
    d.rectangle([w * 0.64, h * 0.64, w * 0.66, h * 0.8], fill=(120, 85, 60))
    d.rectangle([w * 0.94, h * 0.64, w * 0.96, h * 0.8], fill=(120, 85, 60))
    d.ellipse([w * 0.7, h * 0.55, w * 0.8, h * 0.61], fill=(245, 235, 220))
    return img

def scene_idle(w, h, t):
    img = room_bg(w, h, t)
    draw_yui(img, w * 0.42, h * 0.42, h * 0.17, t, "idle", face_dir=math.sin(t * 0.5))
    return img

def scene_dance(w, h, t):
    img = room_bg(w, h, t)
    d = ImageDraw.Draw(img)
    for i in range(8):  # music notes
        ph = (t * 0.6 + i * 0.13) % 1.0
        nx = w * 0.15 + i * w * 0.1 + math.sin(ph * 5 + i) * 12; ny = h * 0.75 - ph * h * 0.6
        d.text((nx, ny), "♪", font=F("jp", 26), fill=(255, 255, 255, int(255 * (1 - ph))))
    draw_yui(img, w * 0.45 + math.sin(t * 3.15) * w * 0.05, h * 0.44, h * 0.16, t, "dance")
    return img

def scene_eat(w, h, t):
    img = room_bg(w, h, t)
    d = ImageDraw.Draw(img)
    draw_yui(img, w * 0.45, h * 0.40, h * 0.16, t, "eat")
    # bowl of ramen in front of her (drawn after so it overlaps the lap)
    bx, by, bw = w * 0.45, h * 0.82, w * 0.3
    d.ellipse([bx - bw / 2, by - bw * 0.14, bx + bw / 2, by + bw * 0.14], fill=(245, 235, 220))
    d.chord([bx - bw / 2, by - bw * 0.3, bx + bw / 2, by + bw * 0.42], 0, 180, fill=(40, 40, 60))
    d.ellipse([bx - bw / 2 + 8, by - bw * 0.1, bx + bw / 2 - 8, by + bw * 0.1], fill=(210, 150, 60))
    for k in range(7):
        pts = [(bx - bw * 0.36 + k * bw * 0.11 + 4 * math.sin(x / 9 + t * 3 + k), by - bw * 0.06 + x * 0.35) for x in range(0, 30, 4)]
        d.line(pts, fill=(250, 225, 150), width=3)
    for k in range(5):
        ph = (t * 0.5 + k * 0.23) % 1.0
        sx = bx - bw * 0.25 + k * bw * 0.12 + 10 * math.sin(ph * 6 + k); sy = by - bw * 0.15 - ph * h * 0.3; rr = 8 + ph * 10
        st = Image.new("RGBA", (int(rr * 2), int(rr * 2)), (0, 0, 0, 0))
        ImageDraw.Draw(st).ellipse([0, 0, st.width - 1, st.height - 1], fill=(255, 255, 255, int(110 * (1 - ph))))
        img.paste(st, (int(sx - rr), int(sy - rr)), st)
        d = ImageDraw.Draw(img)
    return img

def scene_beach(w, h, t):
    img = gradient(w, h, (255, 150, 90), (90, 60, 160))
    d = ImageDraw.Draw(img)
    d.ellipse([w * 0.62, h * 0.18, w * 0.62 + h * 0.34, h * 0.18 + h * 0.34], fill=(255, 220, 120))
    sea = Image.new("RGBA", (w, h), (0, 0, 0, 0)); sd = ImageDraw.Draw(sea)
    for k, (col, amp, spd, base) in enumerate([((40, 90, 190, 255), 8, 1.6, 0.56), ((30, 120, 210, 255), 10, 1.2, 0.62), ((20, 150, 230, 255), 12, 0.9, 0.7)]):
        pts = [(x, h * base + amp * math.sin(x / 34 + t * spd + k)) for x in range(0, w + 8, 8)]
        sd.polygon(pts + [(w, h), (0, h)], fill=col)
    img.paste(sea, (0, 0), sea); d = ImageDraw.Draw(img)
    d.chord([-w * 0.3, h * 0.72, w * 1.3, h * 1.5], 180, 360, fill=(240, 220, 180))
    for i in range(5):  # gulls
        gx = (w * 0.1 + i * w * 0.2 + t * 12) % w; gy = h * 0.12 + i * 18 + math.sin(t * 2 + i) * 6
        d.arc([gx - 14, gy - 6, gx, gy + 6], 200, 340, fill=(40, 40, 60), width=2); d.arc([gx, gy - 6, gx + 14, gy + 6], 200, 340, fill=(40, 40, 60), width=2)
    draw_yui(img, w * 0.5, h * 0.36, h * 0.14, t, "beach", face_dir=0.3)
    # hair in the wind: a few strands
    for k in range(3):
        d.line([(w * 0.5 - h * 0.14 * 1.1, h * 0.36 + k * 10), (w * 0.5 - h * 0.14 * 1.6 - math.sin(t * 3 + k) * 10, h * 0.36 + 20 + k * 12)], fill=HAIR, width=5)
    return img

REACTIONS = [scene_dance, scene_eat, scene_beach]

class Source:
    """Frames for the idle layer and reaction clips: real mp4s (pre-extracted) or procedural scenes."""
    def __init__(self, w, h, idle_paths, clip_paths):
        self.w, self.h = w, h
        self.tmp = tempfile.mkdtemp(prefix="cc-demo-") if (idle_paths or clip_paths) else None
        self.idle = [self._extract(p, f"i{i}") for i, p in enumerate(idle_paths or [])]
        self.clips = [self._extract(p, f"r{i}") for i, p in enumerate(clip_paths or [])]
    def _extract(self, p, name):
        out = Path(self.tmp) / name; out.mkdir()
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", p, "-vf", f"fps={FPS},scale={self.w}:{self.h}:force_original_aspect_ratio=increase,crop={self.w}:{self.h}", str(out / "%04d.png")], check=True)
        return sorted(out.glob("*.png"))
    def _real(self, frames, local_t):
        return Image.open(frames[int(local_t * FPS) % len(frames)]).convert("RGB")
    def idle_frame(self, t):
        if self.idle:
            # loop through the idle pool clip by clip
            total = sum(len(f) for f in self.idle); i = int(t * FPS) % total
            for f in self.idle:
                if i < len(f): return Image.open(f[i]).convert("RGB")
                i -= len(f)
        img = scene_idle(self.w, self.h, t)
        ImageDraw.Draw(img).text((12, 12), "mock illustration — real idle clips are photoreal (H3 Max)", font=F("mono", 11), fill=(255, 255, 255))
        return img
    def clip_frame(self, idx, local_t):
        if self.clips:
            return self._real(self.clips[idx % len(self.clips)], local_t)
        img = REACTIONS[idx % len(REACTIONS)](self.w, self.h, local_t)
        ImageDraw.Draw(img).text((12, 12), "mock illustration — real reaction clips are photoreal (H3 Max)", font=F("mono", 11), fill=(255, 255, 255))
        return img
    def is_mock(self): return not self.clips

# ---------------------------------------------------------------- scene data
CHAT = [  # (t, name, color, text, cast)
    (3.0, "mika", (255, 170, 90), "hi yui!!", False),
    (3.8, "taro_k", (90, 200, 255), "back again", False),
    (4.8, "taro_k", (90, 200, 255), "dance!!", True),
    (6.6, "ren", (140, 230, 140), "wait, this is generated??", False),
    (8.8, "mika", (255, 170, 90), "SHE DANCED lol", False),
    (9.8, "sora", (255, 220, 120), "not lip-sync. the whole shot moves", False),
    (10.8, "kazu", (200, 160, 255), "eat ramen", True),
    (12.4, "ren", (140, 230, 140), "same face every clip", False),
    (14.6, "taro_k", (90, 200, 255), "mine got picked!!", False),
    (15.6, "yujin", (255, 120, 170), "언니 최고", False),
    (16.8, "sora", (255, 220, 120), "let's go to the beach", True),
    (19.6, "kazu", (200, 160, 255), "the scene changed?!", False),
    (20.6, "ren", (140, 230, 140), "insane", False),
    (21.6, "ゆき", (255, 170, 90), "ゆいちゃん最高", False),
]
# (generating_from, play_from, play_to, clip_idx, author, comment, reply)
OVERLAY = [
    (5.1, 8.2, 13.2, 0, "taro_k", "dance!!", "taro_k, let's do it!"),
    (11.1, 13.5, 18.5, 1, "kazu", "eat ramen", "kazu, for real?! nice nice"),
    (17.1, 18.8, 23.8, 2, "sora", "let's go to the beach", "sora, wait... the beach?"),
]
T_TITLE, T_SCENE, T_END, T_TOTAL = 2.6, 2.6, 25.0, 28.6
VID = (24, 64, 924, 570)

def build_page_bg():
    img = Image.new("RGBA", (W, H), BG + (255,)); d = ImageDraw.Draw(img)
    d.rounded_rectangle([948, 64, 1256, 570], radius=10, fill=PANEL + (255,), outline=LINE + (255,))
    d.line([(948, 104), (1256, 104)], fill=LINE + (255,))
    d.text((964, 76), "Live chat", font=F("jpb", 15), fill=INK)
    d.rounded_rectangle([964, 526, 1240, 556], radius=8, fill=BG + (255,), outline=LINE + (255,))
    d.text((976, 533), "Say something…", font=F("jp", 13), fill=MUT)
    hdr = "Yui Shirotsume — say it in chat and she does it"
    d.text((24, 26), hdr, font=F("jpb", 18), fill=INK)
    x = 24 + text_w(F("jpb", 18), hdr) + 14
    pill(d, (x, 24), "LIVE", F("disp", 12), RED, (255, 255, 255), pad=(8, 3))
    d.text((24, 586), "castconjure · generative AI VTuber · this face was generated 10 minutes ago", font=F("mono", 13), fill=MUT)
    d.text((24, 606), "An idle loop underneath. A reaction clip is generated only when chat casts one. One OBS browser source · BYOK · MIT", font=F("jp", 14), fill=MUT)
    return img

class Renderer:
    def __init__(self, src):
        self.page = build_page_bg(); self.src = src
        self.vw, self.vh = VID[2] - VID[0], VID[3] - VID[1]
        self.mask = rounded_mask(self.vw, self.vh, 10)

    def title_card(self, t):
        img = Image.new("RGBA", (W, H), BG + (255,)); d = ImageDraw.Draw(img)
        a = ease(t / 0.6); f = F("disp", 96); s = "castconjure"
        d.text(((W - text_w(f, s)) / 2, 210 + (1 - a) * 14), s, font=f, fill=mix(BG, INK, a))
        f2 = F("jpb", 30); s2 = "Photoreal AI VTubers. Generated, not lip-synced."
        d.text(((W - text_w(f2, s2)) / 2, 340), s2, font=f2, fill=mix(BG, ACC, ease((t - 0.35) / 0.6)))
        f3 = F("jp", 18); s3 = "Conjure a face once. Your chat makes her dance, eat, talk and change scenes — live."
        d.text(((W - text_w(f3, s3)) / 2, 400), s3, font=f3, fill=mix(BG, MUT, ease((t - 0.7) / 0.6)))
        f4 = F("jp", 15); s4 = "フォトリアル AI VTuber を、生成する。口パクじゃなく。"
        d.text(((W - text_w(f4, s4)) / 2, 440), s4, font=f4, fill=mix(BG, MUT, ease((t - 0.9) / 0.6)))
        return img

    def end_card(self, t):
        img = Image.new("RGBA", (W, H), BG + (255,)); d = ImageDraw.Draw(img)
        f = F("disp", 72); s = "castconjure"
        d.text(((W - text_w(f, s)) / 2, 150), s, font=f, fill=mix(BG, INK, ease(t / 0.5)))
        f2 = F("jpb", 24); s2 = "Anyone, in 10 minutes. Face gacha → 3 references → voice → personality → live."
        d.text(((W - text_w(f2, s2)) / 2, 262), s2, font=f2, fill=mix(BG, INK, ease((t - 0.2) / 0.5)))
        f2b = F("jp", 17); s2b = "Faces are generated in-app only. Real people can't be used — by design."
        d.text(((W - text_w(f2b, s2b)) / 2, 306), s2b, font=f2b, fill=mix(BG, MUT, ease((t - 0.3) / 0.5)))
        pills = ["dance · eat · talk · change scenes", "idle loop + reaction clips", "≈ $0.46 per clip", "YouTube Live", "OSS · MIT · BYOK"]
        pf = F("jp", 15); total = sum(text_w(pf, p) + 28 for p in pills) + 10 * (len(pills) - 1); x = (W - total) / 2
        for i, p in enumerate(pills):
            ai = ease((t - 0.4 - i * 0.08) / 0.4)
            w_, _ = pill(d, (x, 370), p, pf, mix(BG, PANEL, ai), mix(BG, INK, ai), pad=(14, 6)); x += w_ + 10
        f3 = F("mono", 22); s3 = "github.com/purankuton2001/castconjure"
        d.text(((W - text_w(f3, s3)) / 2, 470), s3, font=f3, fill=mix(BG, ACC, ease((t - 0.8) / 0.5)))
        return img

    def scene(self, t):
        img = self.page.copy()
        vx0, vy0, vx1, vy1 = VID; vw, vh = self.vw, self.vh
        # ---- idle layer (always on)
        frame = self.src.idle_frame(t).convert("RGBA")
        # ---- reaction layer on top, crossfaded
        hud = None; meta = None; generating = None
        for gen_from, p_from, p_to, ci, name, text, reply in OVERLAY:
            playing = p_from <= t < p_to
            if playing:
                a = min(ease((t - p_from) / 0.4), ease((p_to - t) / 0.4))
                clip = self.src.clip_frame(ci, t - p_from).convert("RGBA")
                frame = Image.blend(frame, clip, a)
                meta = (name, text, reply, a); hud = f"comment → screen {p_from - gen_from + 0.3:.1f}s   ·   reference-to-video 480p · 5s   ·   $0.46"
            elif gen_from <= t < p_from and not any(pf <= t < pt for (_, pf, pt, *_r) in OVERLAY):
                generating = (name, text)
        frame.putalpha(self.mask)
        img.alpha_composite(frame, dest=(vx0, vy0))
        d = ImageDraw.Draw(img)
        # AI badge (always, like the real overlay)
        bf = F("jp", 12); bl = "AI generated"; bw = text_w(bf, bl) + 16
        d.rounded_rectangle([vx1 - 14 - bw, vy0 + 12, vx1 - 14, vy0 + 36], radius=5, fill=(0, 0, 0, 150))
        d.text((vx1 - 14 - bw + 8, vy0 + 16), bl, font=bf, fill=(225, 225, 230))
        if generating:
            gl = Image.new("RGBA", (vw, 44), (0, 0, 0, 0)); gd = ImageDraw.Draw(gl)
            gd.rectangle([0, 0, vw, 44], fill=(0, 0, 0, 110))
            ang = (t * 360) % 360; cx = vw / 2 - 90
            gd.arc([cx - 9, 13, cx + 9, 31], ang, ang + 270, fill=ACC + (255,), width=3)
            gd.text((cx + 20, 11), f"generating… {generating[0]}: \"{generating[1]}\"", font=F("jpb", 16), fill=(240, 240, 245, 255))
            img.alpha_composite(gl, dest=(vx0, vy1 - 44))
            d = ImageDraw.Draw(img)
        if meta:
            name, text, reply, a = meta
            layer = Image.new("RGBA", (vw, 150), (0, 0, 0, 0)); ld = ImageDraw.Draw(layer)
            ld.rectangle([0, 0, vw, 150], fill=(0, 0, 0, 0))
            # subtitle
            sf = F("jpb", 30)
            ld.text((22, 20), reply, font=sf, fill=(255, 255, 255, 255), stroke_width=3, stroke_fill=(0, 0, 0, 220))
            # author pill
            pf = F("jpb", 17); label = f"{name}'s comment"; pw = text_w(pf, label) + 34
            ld.rounded_rectangle([22, 78, 22 + pw, 112], radius=17, fill=(0, 0, 0, 175))
            ld.rectangle([22, 78, 28, 112], fill=ACC + (255,))
            ld.text((40, 84), label, font=pf, fill=(255, 255, 255, 255))
            ld.text((22, 118), f"\"{text}\"", font=F("jp", 16), fill=(240, 240, 245, 230), stroke_width=2, stroke_fill=(0, 0, 0, 180))
            paste_rgba(img, layer, (vx0, vy1 - 160), a)
            d = ImageDraw.Draw(img)
            hw = text_w(F("mono", 12), hud) + 16
            hl = Image.new("RGBA", (hw, 24), (0, 0, 0, 0)); hd = ImageDraw.Draw(hl)
            hd.rounded_rectangle([0, 0, hw - 1, 23], radius=6, fill=(0, 0, 0, 150)); hd.text((8, 5), hud, font=F("mono", 12), fill=(225, 225, 235, 255))
            paste_rgba(img, hl, (vx1 - 14 - hw, vy1 - 34), a)
        # ---- chat panel
        rows = [m for m in CHAT if m[0] <= t]; y = 512; nf, tf = F("jpb", 13), F("jp", 14)
        for (mt, name, color, text, cast) in reversed(rows):
            tf = FT("jp", 14, text)
            a = ease((t - mt) / 0.25); lines = wrap(tf, text, 250); rh = 22 + 20 * len(lines); y -= rh
            if y < 112: break
            row = Image.new("RGBA", (292, rh), (0, 0, 0, 0)); rd = ImageDraw.Draw(row)
            if cast and t >= mt + 0.3:
                glow = ease((t - mt - 0.3) / 0.4)
                rd.rounded_rectangle([0, 0, 291, rh - 4], radius=6, fill=ACC_DEEP + (int(120 * glow),))
                rd.rectangle([0, 2, 3, rh - 6], fill=ACC + (int(255 * glow),))
            rd.ellipse([8, 5, 24, 21], fill=color + (255,)); rd.text((32, 3), name, font=nf, fill=color + (255,))
            if cast and t >= mt + 0.3: rd.text((32 + text_w(nf, name) + 8, 4), "→ casting", font=F("mono", 11), fill=(200, 190, 255, 255))
            for i, ln in enumerate(lines): rd.text((32, 22 + 20 * i), ln, font=tf, fill=INK + (255,))
            paste_rgba(img, row, (956, y + (1 - a) * 6), a)
        return img

    def frame(self, t):
        if t < T_TITLE: return self._fade(self.title_card(t), ease((T_TITLE - t) / 0.3))
        if t < T_END: return self._fade(self.scene(t - T_SCENE + 2.6), min(ease((t - T_SCENE) / 0.4), ease((T_END - t) / 0.4)))
        return self._fade(self.end_card(t - T_END), ease((T_TOTAL - t) / 0.4))

    @staticmethod
    def _fade(img, a):
        if a >= 1: return img
        return Image.blend(Image.new("RGBA", img.size, BG + (255,)), img, a)

# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "docs" / "demo.mp4"))
    ap.add_argument("--gif", default=str(ROOT / "docs" / "demo.gif"))
    ap.add_argument("--hero", default=str(ROOT / "docs" / "hero.png"))
    ap.add_argument("--idle", default="", help="comma-separated idle-pool mp4s (e.g. data/personas/<id>/idle/*.mp4)")
    ap.add_argument("--clips", default="", help="comma-separated reaction mp4s in storyboard order: dance, ramen, beach")
    ap.add_argument("--no-gif", action="store_true")
    args = ap.parse_args()
    if not shutil.which("ffmpeg"): sys.exit("ffmpeg not found on PATH")
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    src = Source(VID[2] - VID[0], VID[3] - VID[1], [p for p in args.idle.split(",") if p.strip()], [p for p in args.clips.split(",") if p.strip()])
    r = Renderer(src)
    n = int(T_TOTAL * FPS)
    ff = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                           "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-movflags", "+faststart", args.out], stdin=subprocess.PIPE)
    hero_t = 10.0
    for i in range(n):
        t = i / FPS; img = r.frame(t)
        if abs(t - hero_t) < 1 / FPS / 2: img.convert("RGB").save(args.hero)
        ff.stdin.write(img.convert("RGB").tobytes())
        if i % FPS == 0: print(f"\r{t:5.1f}s / {T_TOTAL}s", end="", flush=True)
    ff.stdin.close(); ff.wait()
    print(f"\nwrote {args.out}")
    if not args.no_gif:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "4.2", "-t", "10.0", "-i", args.out,
                        "-vf", "fps=15,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4", args.gif], check=True)
        print(f"wrote {args.gif}")
    print(f"wrote {args.hero}")
    if src.tmp: shutil.rmtree(src.tmp, ignore_errors=True)

if __name__ == "__main__":
    main()
