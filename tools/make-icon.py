"""
Fi一把 · 小程序图标 v5（200×200）
简化思路：整体渲染 "Fi"（不拆分重组，避免字形位移错乱），
然后在 i 的圆点位置画音符盖住它。艺术化：整体轻微倾斜 + 上挑。
"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import math, os

S = 5
N = 200 * S

def lerp(a, b, t): return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))

# ---------- 底色 ----------
img = Image.new("RGB", (N, N), (7, 7, 15))
px = img.load()
top, mid, bot = (36, 28, 78), (13, 12, 30), (5, 5, 12)
for y in range(N):
    t = y / (N - 1)
    c = lerp(top, mid, t / 0.55) if t < 0.55 else lerp(mid, bot, (t - 0.55) / 0.45)
    for x in range(N):
        d = math.hypot(x - N * 0.27, y - N * 0.20) / N
        boost = max(0.0, 1.0 - d * 1.9) ** 2 * 0.40
        px[x, y] = (min(255, int(c[0] + 54 * boost)),
                    min(255, int(c[1] + 40 * boost)),
                    min(255, int(c[2] + 110 * boost)))

glow = Image.new("RGB", (N, N), (0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse([round(-N*0.36), round(-N*0.32), round(N*0.72), round(N*0.76)], fill=(52, 34, 132))
gd.ellipse([round(N*0.44), round(N*0.46), round(N*1.26), round(N*1.24)], fill=(10, 62, 102))
glow = glow.filter(ImageFilter.GaussianBlur(N * 0.16))
img = Image.blend(img, Image.blend(img, glow, 0.62), 0.55)

# ---------- 字体 ----------
def font(size, kind="bold"):
    paths = {
        "bold": ["C:/Windows/Fonts/NotoSans-Bold.ttf", "C:/Windows/Fonts/segoeuib.ttf"],
        "sym":  ["C:/Windows/Fonts/seguisym.ttf", "C:/Windows/Fonts/arial.ttf"],
    }[kind]
    for p in paths:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size), p
            except Exception:
                pass
    return ImageFont.load_default(), "default"

# ---------- 整体渲染 "Fi" ----------
TEXT = "Fi"
target_w = N * 0.58
size = round(N * 0.92)
for _ in range(14):
    f, fpath = font(size)
    bb = f.getbbox(TEXT)
    w = bb[2] - bb[0]
    if abs(w - target_w) < N * 0.004:
        break
    size = max(10, round(size * target_w / max(1, w)))

f, fpath = font(size)
bb = f.getbbox(TEXT)
tw, th = bb[2] - bb[0], bb[3] - bb[1]
cx, cy = N * 0.500, N * 0.500
tx = cx - tw / 2 - bb[0]
ty = cy - th / 2 - bb[1]

mask = Image.new("L", (N, N), 0)
ImageDraw.Draw(mask).text((round(tx), round(ty)), TEXT, font=f, fill=255)

# ---------- 定位 i 的圆点（在字标右端区域，从上往下第一段墨迹） ----------
mb = mask.getbbox()
i_zone_x0 = int(mb[0] + (mb[2] - mb[0]) * 0.60)

row_ink = []
for y in range(mb[1], mb[3] + 1):
    cnt = sum(1 for x in range(i_zone_x0, mb[2] + 1) if mask.getpixel((x, y)) > 128)
    row_ink.append((y, cnt))

dot_rows = []
seen_gap = False
for y, c in row_ink:
    if c > 0 and not seen_gap:
        dot_rows.append(y)
    elif c == 0 and dot_rows:
        seen_gap = True

if dot_rows:
    dot_top, dot_bot = min(dot_rows), max(dot_rows)
    xs = [x for y in range(dot_top, dot_bot + 1)
            for x in range(i_zone_x0, mb[2] + 1) if mask.getpixel((x, y)) > 128]
    dot_cx = sum(xs) / len(xs) if xs else N * 0.72
    dot_cy = (dot_top + dot_bot) / 2
    dot_d = max(1, dot_bot - dot_top)
else:
    dot_cx, dot_cy, dot_d = N * 0.72, N * 0.30, N * 0.09

# 圆点会被音符符头覆盖 → 从字标蒙版里挖掉它，避免露边形成"双圆"
if dot_rows:
    clear = Image.new("L", (N, N), 0)
    cd = ImageDraw.Draw(clear)
    pad = int(dot_d * 0.34)
    cd.ellipse([int(dot_cx - dot_d / 2 - pad), int(dot_cy - dot_d / 2 - pad),
                int(dot_cx + dot_d / 2 + pad), int(dot_cy + dot_d / 2 + pad)], fill=255)
    mpx, cpx = mask.load(), clear.load()
    for y in range(N):
        for x in range(N):
            if cpx[x, y] > 128:
                mpx[x, y] = 0

# ---------- 艺术化：轻微倾斜 + 上挑 ----------
SKEW = math.tan(math.radians(4.5))
LIFT = N * 0.015

def warp_shift(y):
    t = 1.0 - (y / N)
    return (y - N / 2) * SKEW * -1 + LIFT * (t ** 1.6)

def artistic_warp(src):
    out = Image.new("L", (N, N), 0)
    sp, op = src.load(), out.load()
    for y in range(N):
        sh = int(round(warp_shift(y)))
        for x in range(N):
            sx = x + sh
            if 0 <= sx < N:
                op[x, y] = sp[sx, y]
    return out

mask = artistic_warp(mask)

# ---------- 上色 ----------
mb2 = mask.getbbox()
y0, y1 = mb2[1], mb2[3]
grad = Image.new("RGB", (N, N))
gp = grad.load()
for y in range(N):
    t = max(0.0, min(1.0, (y - y0) / max(1, (y1 - y0))))
    if t < 0.42:
        c = lerp((150, 238, 255), (54, 160, 255), t / 0.42)
    else:
        c = lerp((54, 160, 255), (18, 84, 226), (t - 0.42) / 0.58)
    for x in range(N):
        gp[x, y] = tuple(int(round(v)) for v in c)

GLYPH = Image.new("RGBA", (N, N), (0, 0, 0, 0))
GLYPH.paste(grad, (0, 0), mask)

# ---------- 音符：盖在 i 的圆点上，符杆向上 ----------
NOTE_LAYER = Image.new("RGBA", (N, N), (0, 0, 0, 0))
NOTE_CHAR, NOTE_FONT = None, None
for path_ in ("C:/Windows/Fonts/seguisym.ttf", "C:/Windows/Fonts/arial.ttf"):
    if not os.path.exists(path_):
        continue
    try:
        nf = ImageFont.truetype(path_, round(N * 0.32))
    except Exception:
        continue
    for ch in ("\u266A", "\u266B"):
        probe = Image.new("L", (round(N*0.40), round(N*0.40)), 0)
        ImageDraw.Draw(probe).text((N*0.02, N*0.02), ch, font=nf, fill=255)
        pbb = probe.getbbox()
        if not pbb:
            continue
        ink = sum(probe.histogram()[1:]) / 255
        if ink / max(1, (pbb[2]-pbb[0]) * (pbb[3]-pbb[1])) < 0.55:
            NOTE_CHAR, NOTE_FONT = ch, nf
            break
    if NOTE_CHAR:
        break

note_info = "none"
if NOTE_CHAR:
    nbb = NOTE_FONT.getbbox(NOTE_CHAR)
    nw, nh = nbb[2]-nbb[0], nbb[3]-nbb[1]
    # 实测（seguisym ♪）：符头中心在 bbox 内 水平 29%、垂直 83% 处
    head_x = nbb[0] + nw * 0.29
    head_y = nbb[1] + nh * 0.83
    # 让符头中心 = 圆点中心（变形后）
    dot_cx_w = dot_cx + warp_shift(dot_cy)
    draw_x = dot_cx_w - head_x
    draw_y = dot_cy - head_y + N * 0.042
    nmask = Image.new("L", (N, N), 0)
    ImageDraw.Draw(nmask).text((round(draw_x), round(draw_y)), NOTE_CHAR, font=NOTE_FONT, fill=255)
    NOTE_LAYER.paste((192, 246, 255, 255), (0, 0), nmask)
    note_info = f"{NOTE_CHAR} head→dot({dot_cx_w:.0f},{dot_cy:.0f}) d={dot_d}"

# ---------- 合成 ----------
halo = GLYPH.filter(ImageFilter.GaussianBlur(N * 0.034))
core = GLYPH.filter(ImageFilter.GaussianBlur(N * 0.011))
img = img.convert("RGBA")
img = Image.alpha_composite(img, Image.eval(halo, lambda v: int(v * 0.82)))
img = Image.alpha_composite(img, Image.eval(core, lambda v: int(v * 0.62)))
if NOTE_CHAR:
    nh_img = NOTE_LAYER.filter(ImageFilter.GaussianBlur(N * 0.020))
    img = Image.alpha_composite(img, Image.eval(nh_img, lambda v: int(v * 0.72)))
    img = Image.alpha_composite(img, NOTE_LAYER)
img = Image.alpha_composite(img, GLYPH)

img = img.convert("RGB").resize((200, 200), Image.LANCZOS)
img.save("assets/icon.png", "PNG", optimize=True)
print(f"icon.png font={os.path.basename(fpath)} size={size} note={note_info}")
